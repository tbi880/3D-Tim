import { Quaternion, Vector3 } from 'three';
import { FACTION, HUD_REFRESH_INTERVAL, PLAYER, POWER_MODES, WORLD } from '../config/gameConfig.js';
import { EventBus, GAME_EVENTS } from '../core/EventBus.js';
import { World } from '../core/World.js';
import { setLocale, t } from '../i18n/index.js';
import { CAMPAIGN, STARTING_SECTOR } from '../story/campaign.js';
import { resolvePlacement } from '../story/placement.js';
import { StoryDirector } from '../story/StoryDirector.js';
import { CommsQueue, estimateReadingTime } from './CommsQueue.js';
import { CAMERA_MODES, clearSave, loadSave, saveSettings, writeSave } from './saveGame.js';

export const PHASE = Object.freeze({
    TITLE: 'title',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameover',
    ENDING: 'ending',
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
});

/** Seconds between the player's death and the game-over screen, so the wreck can be seen. */
const FAILURE_DELAY = 2.6;
const TITLE_CARD_SECONDS = 4.5;
const TOAST_SECONDS = 3;
const TITLE_DRIFT_RATE = 0.03;

const AXIS_Y = Object.freeze(new Vector3(0, 1, 0));
const scratchSpin = new Quaternion();

const emptyStats = () => ({ time: 0, kills: 0, losses: 0 });

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
 * One play session: owns the world, the story director and the comms queue, implements the
 * "stage" the story script talks to, and publishes a throttled snapshot for the HUD.
 *
 * It never imports React. The UI passes in `ui.set(partialState)` (the zustand store in the
 * browser, a stub in tests), which keeps the whole session runnable in Node.
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
        this.world.autoFire = Boolean(settings.autoFire);
        this.comms = new CommsQueue({
            getDuration: (line) => estimateReadingTime(t(line.textKey)),
            onChange: (line) => {
                this.ui.set({ comms: line ? { id: line.id, speakerId: line.speakerId, textKey: line.textKey, duration: line.duration } : null });
                this.events.emit(SESSION_EVENTS.COMMS, { line });
            },
        });
        this.director = new StoryDirector({ world: this.world, stage: this, beats: CAMPAIGN });

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

        this.unsubscribe = [
            this.world.events.on(GAME_EVENTS.SHIP_SPAWNED, () => this.publishRoster()),
            this.world.events.on(GAME_EVENTS.SHIP_REMOVED, () => this.publishRoster()),
            this.world.events.on(GAME_EVENTS.SHIP_DESTROYED, ({ ship, killer }) => {
                this.publishRoster();
                if (killer?.isPlayer && ship.faction === FACTION.UMBRA) this.stats.kills += 1;
            }),
        ];

        this.enterTitle();
    }

    dispose() {
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
        this.resetPresentation();
        this.world.clear();
        this.world.setSector(STARTING_SECTOR);
        this.world.spawnShip(PLAYER.classId, { position: [0, 0, 600], facing: [0, 0, -1] });
        this.world.controlsLocked = true;
        this.director.startFromBeginning();
        const save = loadSave();
        this.ui.set({ hasSave: Boolean(save), saveCheckpointId: save?.checkpointId ?? null });
        this.playMusic('calm');
        this.setPhase(PHASE.TITLE);
    }

    newGame() {
        clearSave();
        this.resetPresentation();
        this.stats = emptyStats();
        this.world.clear();
        this.world.setDifficulty(this.settings.difficulty);
        const sector = this.world.setSector(STARTING_SECTOR);
        this.world.spawnShip(PLAYER.classId, sector.playerStart);
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

    resetPresentation() {
        this.comms.clear();
        this.waypoint = null;
        this.failureReason = null;
        this.failureTimer = 0;
        this.titleCardTimer = 0;
        this.toastTimer = 0;
        this.ui.set({
            objective: null, hint: null, titleCard: null, toast: null, progress: null,
            escort: null, boss: null, target: null, gameOverReason: null, stats: null,
        });
    }

    // ---- Settings and player actions ----------------------------------------------------

    updateSettings(partial) {
        Object.assign(this.settings, partial);
        if (partial.difficulty) this.world.setDifficulty(partial.difficulty);
        if (partial.locale) setLocale(partial.locale);
        if ('autoFire' in partial) this.world.autoFire = Boolean(partial.autoFire);
        saveSettings(this.settings);
        this.ui.set({ settings: { ...this.settings } });
        this.events.emit(SESSION_EVENTS.SETTINGS, { settings: this.settings });
    }

    /** One-shot player actions (key presses, buttons). Held controls go through `update`. */
    handleAction(action) {
        if (action === 'pause') {
            this.togglePause();
            return;
        }
        if (action === 'toggleMute') {
            this.updateSettings({ muted: !this.settings.muted });
            return;
        }
        if (action === 'toggleView') {
            const next = (CAMERA_MODES.indexOf(this.settings.cameraMode) + 1) % CAMERA_MODES.length;
            this.updateSettings({ cameraMode: CAMERA_MODES[next] });
            return;
        }
        if (this.phase !== PHASE.PLAYING) return;
        const player = this.world.player;
        switch (action) {
            case 'skip': this.comms.skip(); break;
            case 'cycleTarget': this.world.cycleTarget(1); break;
            case 'targetCrosshair': this.world.targetNearestToCrosshair(); break;
            case 'power:balanced':
            case 'power:attack':
            case 'power:defense': {
                const mode = action.split(':')[1];
                if (player?.alive && POWER_MODES[mode] && player.powerMode !== mode) {
                    player.powerMode = mode;
                    this.playCue('power');
                }
                break;
            }
            // One button that steps through the modes, for touch screens.
            case 'power:cycle': {
                const modes = Object.keys(POWER_MODES);
                const next = modes[(modes.indexOf(player?.powerMode) + 1) % modes.length];
                this.handleAction(`power:${next}`);
                break;
            }
            default: break;
        }
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

    setHint(textKey) {
        this.ui.set({ hint: textKey });
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
        this.ui.set({ stats: { ...this.stats } });
        this.setPhase(PHASE.ENDING);
    }

    // ---- Per-frame update ---------------------------------------------------------------

    /**
     * @param {number} dt seconds since the last frame
     * @param {object} controls held controls from the input layer
     */
    update(dt, controls) {
        this.effectsDelta = this.phase === PHASE.PAUSED ? 0 : Math.min(dt, WORLD.maxStep);
        if (this.phase === PHASE.TITLE) {
            this.updateTitleDrift(dt);
            return;
        }
        if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.ENDING) return;

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
        this.ui.set({ roster: this.world.ships.filter((ship) => ship.alive && !ship.isPlayer) });
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

        const { world, director } = this;
        const player = world.player;
        if (!player) return;
        const torpedoes = player.weapons.find((weapon) => weapon.def.type === 'torpedo');
        const beam = player.weapons.find((weapon) => weapon.def.type === 'beam');
        const target = player.target?.alive ? player.target : null;
        const escortShip = director.scene.escortTag ? world.findByTag(director.scene.escortTag) : null;
        const bossShip = director.scene.bossTag ? world.findByTag(director.scene.bossTag) : null;
        const objectiveKey = director.scene.objectiveKey;

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
            },
            target: target ? { ...shipStatus(target), distance: Math.round(Math.max(0, target.distanceToPoint(player.position))) } : null,
            escort: escortShip ? shipStatus(escortShip) : null,
            boss: bossShip ? shipStatus(bossShip) : null,
            progress: director.progress ? { labelKey: director.progress.labelKey, value: director.progress.getValue(director.context) } : null,
            objective: objectiveKey ? { key: objectiveKey, params: director.objectiveParams?.(director.context) ?? null } : null,
        });
    }
}
