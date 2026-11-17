import { Quaternion, Vector3 } from 'three';
import { FACTION, HUD_REFRESH_INTERVAL, PLAYER, WORLD } from '../config/gameConfig.js';
import { EventBus, GAME_EVENTS } from '../core/EventBus.js';
import { isTouchDevice } from '../input/device.js';
import { mergeUpgrades } from '../core/refit.js';
import { applyPilotAction } from '../core/systems/pilotActions.js';
import { IDLE_CONTROLS } from '../core/systems/playerFlight.js';
import { World } from '../core/World.js';
import { setLocale, t } from '../i18n/index.js';
import { CAMPAIGN, STARTING_SECTOR } from '../story/campaign.js';
import { resolvePlacement } from '../story/placement.js';
import { StoryDirector } from '../story/StoryDirector.js';
import { CommsQueue, estimateReadingTime } from './CommsQueue.js';
import { computeFinalScore, killPoints } from '../config/scoring.js';
import { CAMERA_MODES, clearSave, loadSave, recordFinalScore, saveSettings, writeSave } from './saveGame.js';
import { Tutorial } from './Tutorial.js';

export const PHASE = Object.freeze({
    TITLE: 'title',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameover',
    ENDING: 'ending',
    /** A multiplayer match has ended and its results are on screen. */
    MATCH_OVER: 'matchover',
});

/** Events the session emits for the presentation layers (sound, screen effects). */
export const SESSION_EVENTS = Object.freeze({
    /** { id } - one-shot audio / visual cue requested by the story */
    CUE: 'cue',
    /** { id } - music track change (null stops music) */
    MUSIC: 'music',
    /** { stage: 'spool' | 'arrive' } */
    WARP: 'warp',
    /** { line } - a comms line appeared (line may be null) */
    COMMS: 'comms',
    /** { phase } */
    PHASE: 'phase',
    /** { checkpointId } */
    CHECKPOINT: 'checkpoint',
    /** { settings } */
    SETTINGS: 'settings',
    /** { points, classId, total } - the player destroyed something worth points */
    SCORE: 'score',
});

/** Seconds between the player's death and the game-over screen, so the wreck can be seen. */
const FAILURE_DELAY = 2.6;
const TITLE_CARD_SECONDS = 4.5;
const TOAST_SECONDS = 3;
const TITLE_DRIFT_RATE = 0.03;

const AXIS_Y = Object.freeze(new Vector3(0, 1, 0));
const scratchSpin = new Quaternion();

const emptyStats = () => ({ time: 0, kills: 0, losses: 0, score: 0 });

function shipStatus(ship) {
    return {
        id: ship.id,
        nameKey: ship.nameKey,
        callsign: ship.callsign,
        hull: ship.hullFraction,
        shield: ship.shieldFraction,
        hasShield: ship.maxShield > 0,
        invulnerable: ship.invulnerable,
        faction: ship.faction,
    };
}

/**
 * A ship's active ability as the HUD shows it, or null for a ship without one:
 * `state` 'ready' | 'active' (its effect is running) | 'armed' (a warhead is in flight: the
 * button sets it off) | 'cooldown'; `charge` 0..1 how full its bar is (time left of the
 * effect, else how far it has recharged); `seconds` left of the effect or of the cooldown.
 */
export function abilityStatus(ship) {
    const ability = ship.ability;
    if (!ability) return null;
    const { def } = ability;
    const active = ability.active > 0;
    return {
        id: def.id,
        state: ability.armed ? 'armed' : active ? 'active' : ability.cooldown > 0 ? 'cooldown' : 'ready',
        charge: active ? ability.active / def.duration : 1 - ability.cooldown / def.cooldown,
        seconds: Math.ceil(active ? ability.active : ability.cooldown),
    };
}

/**
 * One play session: owns the world, the story director and the comms queue, implements the
 * "stage" the story script talks to, and publishes a throttled snapshot for the HUD.
 *
 * It never imports React. The UI passes in `ui.set(partialState)` (the zustand store in the
 * browser, a stub in tests), which keeps the whole session runnable in Node.
 *
 * A multiplayer match (net/match) borrows the session instead of replacing it: while
 * `match` is set, the match drives the world in place of the campaign story, and the scene,
 * HUD, sound and input keep working on the same session and world as in single player.
 */
export class GameSession {
    /**
     * @param {object} params
     * @param {{ set: (partial: object) => void }} params.ui sink for HUD / menu state
     * @param {object} params.settings see defaultSettings() in saveGame.js
     */
    constructor({ ui, settings }) {
        this.ui = ui;
        this.settings = { ...settings };
        setLocale(this.settings.locale);
        this.events = new EventBus();
        this.world = new World({ difficultyId: settings.difficulty });
        this.comms = new CommsQueue({
            getDuration: (line) => estimateReadingTime(t(line.textKey)),
            onChange: (line) => {
                this.ui.set({ comms: line ? { id: line.id, speakerId: line.speakerId, textKey: line.textKey, duration: line.duration } : null });
                this.events.emit(SESSION_EVENTS.COMMS, { line });
            },
        });
        this.director = new StoryDirector({ world: this.world, stage: this, beats: CAMPAIGN });
        /** The multiplayer match being played (see beginMatch), or null in single player. */
        this.match = null;
        /** The first-flight tutorial: it can stop the game until the pilot has tried a control (state/Tutorial.js). */
        this.tutorial = new Tutorial(this);

        this.phase = PHASE.TITLE;
        this.stats = emptyStats();
        /** Navigation marker: `{ placement, labelKey, position }` or null. */
        this.waypoint = null;
        this.failureReason = null;
        this.failureTimer = 0;
        this.hudTimer = 0;
        this.titleCardTimer = 0;
        this.toastTimer = 0;
        this.publishedSectorId = null;
        /** Seconds the visual effects should advance this frame (0 while paused). */
        this.effectsDelta = 0;
        /** Counts calls of `update`, so a watchdog can tell whether frames are still being drawn. */
        this.updates = 0;

        this.unsubscribe = [
            this.world.events.on(GAME_EVENTS.SHIP_SPAWNED, () => this.publishRoster()),
            this.world.events.on(GAME_EVENTS.SHIP_REMOVED, () => this.publishRoster()),
            this.world.events.on(GAME_EVENTS.SHIP_DESTROYED, ({ ship, killer }) => {
                this.publishRoster();
                // A match keeps its own score, per player.
                if (!this.match && killer?.isPlayer && ship.faction === FACTION.UMBRA) this.recordKill(ship);
            }),
        ];

        this.enterTitle();
    }

    /** Counts a kill by the player and announces the points it was worth. */
    recordKill(ship) {
        this.stats.kills += 1;
        const points = killPoints(ship);
        if (points <= 0) return;
        this.stats.score += points;
        this.events.emit(SESSION_EVENTS.SCORE, { points, classId: ship.classId, total: this.stats.score });
    }

    dispose() {
        this.dropMatch();
        for (const unsubscribe of this.unsubscribe) unsubscribe();
        this.world.events.clear();
        this.events.clear();
    }

    // ---- Phase changes ------------------------------------------------------------------

    setPhase(phase) {
        this.phase = phase;
        this.ui.set({ phase });
        this.events.emit(SESSION_EVENTS.PHASE, { phase });
    }

    /** Title screen: an empty sector with the camera drifting, no story running. */
    enterTitle() {
        this.dropMatch();
        this.resetPresentation();
        this.world.clear();
        this.world.setSector(STARTING_SECTOR);
        this.world.spawnShip(this.settings.playerShip, { position: [0, 0, 600], facing: [0, 0, -1] });
        this.world.controlsLocked = true;
        this.world.playerUpgrades = {};
        this.director.startFromBeginning();
        const save = loadSave();
        this.ui.set({ hasSave: Boolean(save), saveCheckpointId: save?.checkpointId ?? null });
        this.playMusic('calm');
        this.setPhase(PHASE.TITLE);
    }

    newGame() {
        clearSave();
        this.dropMatch();
        this.resetPresentation();
        this.stats = emptyStats();
        this.world.clear();
        this.world.setDifficulty(this.settings.difficulty);
        const sector = this.world.setSector(STARTING_SECTOR);
        this.world.playerClassId = this.settings.playerShip;
        this.world.playerUpgrades = {};
        this.world.spawnShip(this.world.playerClassId, sector.playerStart);
        this.director.startFromBeginning();
        this.ui.set({ hasSave: false, saveCheckpointId: null });
        this.setPhase(PHASE.PLAYING);
    }

    /** Loads the last checkpoint. Falls back to a new game if the save cannot be used. */
    continueGame() {
        const save = loadSave();
        if (!save) {
            this.newGame();
            return;
        }
        this.dropMatch();
        this.resetPresentation();
        this.world.setDifficulty(this.settings.difficulty);
        this.world.restore(save.world);
        if (!this.director.startFromCheckpoint(save.checkpointId, save.vars, save.scene)) {
            this.newGame();
            return;
        }
        this.stats = { ...emptyStats(), ...save.stats };
        // Re-apply the parts of the scene the HUD and audio show.
        this.setObjective(this.director.scene.objectiveKey);
        if (this.director.scene.musicId) this.playMusic(this.director.scene.musicId);
        this.setPhase(PHASE.PLAYING);
    }

    /** After a failure: try again from the last save, remembering the loss. */
    retry() {
        const losses = this.stats.losses + 1;
        const save = loadSave();
        // Losses are stored in the save so the count survives the reload below.
        if (save) writeSave({ ...save, stats: { ...save.stats, losses } });
        this.continueGame();
        this.stats.losses = losses;
    }

    pause() {
        if (this.phase === PHASE.PLAYING) this.setPhase(PHASE.PAUSED);
    }

    resume() {
        if (this.phase === PHASE.PAUSED) this.setPhase(PHASE.PLAYING);
    }

    togglePause() {
        if (this.phase === PHASE.PLAYING) this.pause();
        else if (this.phase === PHASE.PAUSED) this.resume();
    }

    // ---- Multiplayer --------------------------------------------------------------------

    /**
     * Hands the world to a multiplayer match and starts flying. The match is an object with
     * `begin(session)`, `update(dt, controls)`, `handleAction(action, params)`, `missionHud()`
     * and `dispose()` (net/match/HostMatch.js on the host's device, ClientMatch.js elsewhere).
     */
    beginMatch(match) {
        this.dropMatch();
        this.resetPresentation();
        this.stats = emptyStats();
        this.world.clear();
        this.world.playerUpgrades = {};
        this.match = match;
        match.begin(this);
        this.setPhase(PHASE.PLAYING);
    }

    /**
     * Swaps the object that carries the match for another that carries the same one: a device
     * that takes a match over as host, or hands it back, goes on playing without a break.
     */
    replaceMatch(match) {
        if (this.match) this.match = match;
    }

    /** The match is over: its results stay on screen until the player leaves (enterTitle). */
    showMatchResults() {
        if (!this.match) return;
        this.world.controlsLocked = true;
        this.setPhase(PHASE.MATCH_OVER);
    }

    /** Lets go of the match, if there is one, and puts back what it changed. */
    dropMatch() {
        const match = this.match;
        if (!match) return;
        this.match = null;
        match.dispose();
        this.world.setDifficulty(this.settings.difficulty);
        this.ui.set({ match: null, matchPanel: null, matchOutro: null, refit: null });
    }

    resetPresentation() {
        this.comms.clear();
        this.waypoint = null;
        this.failureReason = null;
        this.failureTimer = 0;
        this.titleCardTimer = 0;
        this.toastTimer = 0;
        this.pendingRefit = null;
        this.tutorial.cancel();
        this.ui.set({
            refit: null,
            objective: null, hint: null, titleCard: null, toast: null, progress: null,
            escort: null, boss: null, target: null, gameOverReason: null, stats: null, finalScore: null,
        });
    }

    // ---- Settings and player actions ----------------------------------------------------

    updateSettings(partial) {
        Object.assign(this.settings, partial);
        // A match flies at the difficulty its host chose; the setting applies again afterwards.
        if (partial.difficulty && !this.match) this.world.setDifficulty(partial.difficulty);
        if (partial.locale) setLocale(partial.locale);
        saveSettings(this.settings);
        this.ui.set({ settings: { ...this.settings } });
        this.events.emit(SESSION_EVENTS.SETTINGS, { settings: this.settings });
        // Switched off, the tutorial lets go of the game at once; switched on, it starts over.
        if ('tutorial' in partial) this.tutorial.settingChanged(Boolean(partial.tutorial));
    }

    /**
     * One-shot player actions (key presses, buttons). Held controls go through `update`.
     * `params` carries what a few actions need (see applyPilotAction).
     */
    handleAction(action, params) {
        if (action === 'pause') {
            this.togglePause();
            return;
        }
        if (action === 'toggleMute') {
            this.updateSettings({ muted: !this.settings.muted });
            return;
        }
        if (action === 'toggleView') {
            // Phones stay in chase view (saveGame.js loadSettings).
            if (isTouchDevice()) return;
            const next = (CAMERA_MODES.indexOf(this.settings.cameraMode) + 1) % CAMERA_MODES.length;
            this.updateSettings({ cameraMode: CAMERA_MODES[next] });
            if (this.phase === PHASE.PLAYING) this.tutorial.noteAction(action);
            return;
        }
        if (this.phase !== PHASE.PLAYING) return;
        // While a tutorial card has the game stopped, only what it asks for goes through.
        if (!this.match && this.tutorial.intercept(action)) return;
        if (action === 'skip') {
            this.comms.skip();
            return;
        }
        // In a match the host decides what the action does, so it goes through the match.
        if (this.match) {
            this.match.handleAction(action, params);
            return;
        }
        const cue = applyPilotAction(this.world, this.world.player, action, params);
        if (cue) this.playCue(cue);
    }

    // ---- Stage API used by the story script (story/beats.js) ----------------------------

    say(speakerId, textKey) {
        return this.comms.enqueue(speakerId, textKey);
    }

    showTitleCard(chapterId) {
        this.titleCardTimer = TITLE_CARD_SECONDS;
        this.ui.set({ titleCard: { chapterId } });
    }

    setObjective(textKey) {
        this.ui.set({ objective: textKey ? { key: textKey, params: this.director.objectiveParams?.(this.director.context) ?? null } : null });
    }

    /**
     * Opens the refit window (ui/RefitPanel.jsx): the player spends `points` on their ship.
     * `onDone` runs once the choice has been installed (see applyRefit).
     */
    openRefit(points, onDone) {
        const classId = this.world.playerClassId;
        this.pendingRefit = { points, classId, onDone };
        this.ui.set({ refit: { points, classId, upgrades: { ...this.world.playerUpgrades } } });
    }

    /**
     * Installs the levels chosen in the refit window ({ rating: levels }, at most the points
     * offered; anything over a rating's cap is dropped) and closes it.
     */
    applyRefit(added) {
        // In a match the points are the server's to spend: the match asks it.
        if (this.match) {
            this.ui.set({ refit: null });
            this.match.applyRefit?.(added);
            return;
        }
        const pending = this.pendingRefit;
        if (!pending) return;
        let spent = 0;
        const allowed = {};
        for (const [rating, levels] of Object.entries(added ?? {})) {
            const take = Math.max(0, Math.min(Math.floor(levels), pending.points - spent));
            if (take > 0) allowed[rating] = take;
            spent += take;
        }
        this.world.setPlayerUpgrades(mergeUpgrades(pending.classId, this.world.playerUpgrades, allowed));
        this.pendingRefit = null;
        this.ui.set({ refit: null });
        pending.onDone();
    }

    setHint(textKey) {
        this.ui.set({ hint: textKey });
    }

    /**
     * Walks a new pilot through the given tutorial steps (config/tutorial.js). The story waits
     * on the returned object's `finished`: true at once when the tutorial is off or done.
     */
    beginTutorial(stepIds) {
        return this.tutorial.begin(stepIds);
    }

    /** A short notice that fades by itself (`params` fill the text's placeholders). */
    showToast(textKey, params = null) {
        this.toastTimer = TOAST_SECONDS;
        this.ui.set({ toast: { key: textKey, params } });
    }

    setWaypoint(waypoint) {
        this.waypoint = waypoint ? { ...waypoint, position: new Vector3() } : null;
        this.updateWaypoint();
    }

    saveCheckpoint(checkpointId) {
        const player = this.world.player;
        if (player?.alive) {
            // A checkpoint is also a breather: patch the hull and refill the torpedo tubes.
            player.hull = Math.max(player.hull, player.maxHull * PLAYER.checkpointMinHull);
            for (const weapon of player.weapons) {
                if (weapon.def.capacity) weapon.ammo = weapon.def.capacity;
            }
        }
        // The same breather for the big ships being protected: a checkpoint must never lock in
        // a flagship that is one hit from destruction.
        for (const ship of this.world.ships) {
            if (ship.alive && !ship.isPlayer && ship.faction === FACTION.DAWN && ship.cls.kind === 'capital') {
                ship.hull = Math.max(ship.hull, ship.maxHull * PLAYER.checkpointMinAllyHull);
            }
        }
        const saved = writeSave({
            checkpointId,
            world: this.world.serialize(),
            vars: { ...this.director.vars },
            scene: { ...this.director.scene },
            stats: { ...this.stats },
        });
        if (!saved) return;
        this.toastTimer = TOAST_SECONDS;
        this.ui.set({ hasSave: true, saveCheckpointId: checkpointId, toast: { key: 'ui.checkpointSaved', checkpointId } });
        this.events.emit(SESSION_EVENTS.CHECKPOINT, { checkpointId });
    }

    playMusic(trackId) {
        this.events.emit(SESSION_EVENTS.MUSIC, { id: trackId });
    }

    playCue(cueId) {
        this.events.emit(SESSION_EVENTS.CUE, { id: cueId });
    }

    onWarp(stage) {
        this.events.emit(SESSION_EVENTS.WARP, { stage });
    }

    endGame() {
        this.world.controlsLocked = true;
        const result = computeFinalScore(this.stats, this.settings.difficulty);
        const { isRecord, previous } = recordFinalScore(result, this.world.playerClassId ?? this.settings.playerShip);
        this.finalScore = { ...result, isRecord, previousBest: previous?.total ?? null };
        this.ui.set({ stats: { ...this.stats }, finalScore: this.finalScore });
        this.setPhase(PHASE.ENDING);
    }

    // ---- Per-frame update ---------------------------------------------------------------

    /**
     * @param {number} dt seconds since the last frame
     * @param {object} controls held controls from the input layer
     */
    update(dt, controls) {
        this.updates += 1;
        // A tutorial card stops the story's world until the pilot has done what it asks; the
        // controls still reach it, so it can tell when they have.
        const tutorialHold = this.phase === PHASE.PLAYING && !this.match && this.tutorial.update(dt, controls);
        // A match cannot be frozen: "paused" there only means this player has the menu open.
        const frozen = (this.phase === PHASE.PAUSED && !this.match) || tutorialHold;
        this.effectsDelta = frozen ? 0 : Math.min(dt, WORLD.maxStep);
        if (this.phase === PHASE.TITLE) {
            this.updateTitleDrift(dt);
            return;
        }
        if (this.match) {
            // With a menu open the ship flies on with its controls released.
            this.match.update(dt, this.phase === PHASE.PLAYING ? controls : IDLE_CONTROLS);
            this.updateWaypoint();
            this.updateTimers(dt);
            this.publishHud(dt);
            return;
        }
        if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.ENDING) return;
        if (tutorialHold) {
            // Nothing moves, but the HUD still follows what the pilot does (a lock made on the card's asking).
            this.publishHud(dt);
            return;
        }

        this.world.update(dt, controls);
        if (this.phase === PHASE.PLAYING) {
            this.director.update(dt);
            this.comms.update(dt);
            this.stats.time += dt;
            this.checkFailure(dt);
        }
        this.updateWaypoint();
        this.updateTimers(dt);
        this.publishHud(dt);
    }

    updateTitleDrift(dt) {
        const player = this.world.player;
        if (!player) return;
        this.world.update(dt);
        player.quaternion.multiply(scratchSpin.setFromAxisAngle(AXIS_Y, TITLE_DRIFT_RATE * dt));
        this.publishSector();
    }

    checkFailure(dt) {
        if (!this.failureReason) {
            const escortTag = this.director.scene.escortTag;
            if (!this.world.player?.alive) this.failureReason = 'player';
            // The reason names the ship that was lost, so the game-over screen can say which.
            else if (escortTag && !this.world.findByTag(escortTag)) this.failureReason = `escort.${escortTag}`;
            if (!this.failureReason) return;
            this.failureTimer = FAILURE_DELAY;
            this.world.controlsLocked = true;
            this.comms.clear();
        }
        this.failureTimer -= dt;
        if (this.failureTimer <= 0) {
            this.ui.set({ gameOverReason: this.failureReason });
            this.setPhase(PHASE.GAME_OVER);
        }
    }

    updateWaypoint() {
        if (!this.waypoint) return;
        const anchor = this.waypoint.placement.anchor;
        // A waypoint pinned to a ship disappears with that ship.
        if (anchor && anchor !== 'player' && anchor !== 'origin' && !this.world.findByTag(anchor)) {
            this.waypoint = null;
            return;
        }
        resolvePlacement(this.world, this.waypoint.placement, this.waypoint.position);
    }

    updateTimers(dt) {
        if (this.titleCardTimer > 0) {
            this.titleCardTimer -= dt;
            if (this.titleCardTimer <= 0) this.ui.set({ titleCard: null });
        }
        if (this.toastTimer > 0) {
            this.toastTimer -= dt;
            if (this.toastTimer <= 0) this.ui.set({ toast: null });
        }
    }

    /** Publishes a fresh, immutable list of the ships the 3D scene should draw. */
    publishRoster() {
        // Everything but the ship flown on this device (other players' ships in multiplayer are drawn like any other).
        const own = this.world.player;
        this.ui.set({ roster: this.world.ships.filter((ship) => ship.alive && ship !== own), playerShip: own ?? null });
    }

    publishSector() {
        if (this.publishedSectorId === this.world.sectorId) return;
        this.publishedSectorId = this.world.sectorId;
        this.ui.set({ sectorId: this.world.sectorId });
    }

    /** Pushes a snapshot of everything the React HUD shows, a few times per second. */
    publishHud(dt) {
        this.publishSector();
        this.hudTimer -= dt;
        if (this.hudTimer > 0) return;
        this.hudTimer = HUD_REFRESH_INTERVAL;

        const { world } = this;
        const player = world.player;
        if (!player) return;
        const torpedoes = player.weapons.find((weapon) => weapon.def.type === 'torpedo');
        const beam = player.weapons.find((weapon) => weapon.def.type === 'beam');
        const target = player.target?.alive ? player.target : null;
        const mission = this.missionHud();

        this.ui.set({
            hud: {
                alive: player.alive,
                hull: player.hullFraction,
                shield: player.shieldFraction,
                energy: player.energy / PLAYER.energyMax,
                beamDepleted: Boolean(beam?.depleted),
                boost: player.boost,
                boosting: player.boosting,
                speed: Math.round(player.velocity.length()),
                throttle: player.throttle,
                torpedoes: torpedoes?.ammo ?? 0,
                torpedoCapacity: torpedoes?.def.capacity ?? 0,
                torpedoReload: torpedoes ? torpedoes.reloadTimer / torpedoes.def.reloadTime : 0,
                powerMode: player.powerMode,
                outOfBounds: world.outOfBounds,
                cannonLock: world.playerCannonLock,
                ability: abilityStatus(player),
                /** The id of the ship's passive ability (config/abilities.js PASSIVES), or null. */
                passive: player.passive?.id ?? null,
                /** Seconds the shield is still held down by a breach blast (0: it is its own again). */
                shieldDown: Math.ceil(player.shieldDown),
                cloaked: player.cloaked,
            },
            target: target ? { ...shipStatus(target), distance: Math.round(Math.max(0, target.distanceToPoint(player.position))) } : null,
            escort: mission.escort ? shipStatus(mission.escort) : null,
            boss: mission.boss ? shipStatus(mission.boss) : null,
            progress: mission.progress,
            objective: mission.objective,
        });
    }

    /**
     * What the mission wants on the HUD right now: `{ escort, boss, progress, objective }`
     * (ships, `{ labelKey, value }`, `{ key, params }`; null for anything not shown).
     * It comes from the campaign story, or from the match while one is being played.
     */
    missionHud() {
        return this.match ? this.match.missionHud() : this.director.missionHud();
    }
}
