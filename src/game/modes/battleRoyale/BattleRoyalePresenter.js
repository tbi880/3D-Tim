import { Vector3 } from 'three';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { SECTORS } from '../../config/sectors.js';
import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { t } from '../../i18n/index.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { sanitizeBattleRoyaleState } from './battleRoyaleState.js';
import { BR_EVENT, BR_REQUEST } from './battleRoyaleProtocol.js';
import { PLANET_STATUS } from './collapse.js';
import { isEquipment } from './equipment.js';
import { GateCeremony } from './gateCeremony.js';
import { STATION_TAG, buildGate, gatePose, stationPose } from './station.js';

/** The mode's own keys and buttons (bound in input/InputController.js, shown by ui/multiplayer). */
export const MATCH_ACTION = Object.freeze({
    MAP: 'match:map', REFIT: 'match:refit', SUMMON: 'match:summon', DOCK: 'match:dock', EQUIPMENT: 'match:equipment',
});
export const MATCH_PANEL = Object.freeze({ MAP: 'map', EQUIPMENT: 'equipment' });

/** Sounds of the match's ceremonies (audio/SoundEngine.js playCue). */
export const CUE = Object.freeze({ INTRO: 'matchIntro', VICTORY: 'victory', DEFEAT: 'defeat' });

/** Names as the player reads them (the ids come from the host: an unknown one is shown as it came). */
export const planetName = (planetId) => t(`mp.planet.${String(planetId)}`);
export const factionName = (faction) => t(`mp.faction.${String(faction)}`);
export const equipmentName = (item) => t(`mp.equipment.${String(item)}.name`);

const scratchOffset = new Vector3();

/** The planet the stargate stands at. */
const GATE_PLANET = STAR_SYSTEM.planets.find((planet) => planet.gate);
/** Most ships shown going through the gate at the end, besides the player's own. */
const MAX_FLYERS = 7;
/** What a pilot whose ship the host never named is shown flying at the end. */
const FALLBACK_SHIP = 'kestrel';
const playerClass = (classId) => (SHIP_CLASSES[classId]?.behavior === 'player' ? classId : FALLBACK_SHIP);

/** Seconds the warp streaks take to fade once the ship has arrived. */
const WARP_EXIT_SECONDS = 1.4;

/**
 * The battle royale on a player's device (the "presenter" half of a game mode, see
 * modes/index.js): turns what the rules announce into what the pilot sees and hears.
 * The map, the scoreboard and the panels read the match state from the game store; this
 * handles the moments - a jump, a planet falling in, a warning.
 */
export class BattleRoyalePresenter {
    /**
     * @param {object} [options]
     * @param {string | null} [options.startingEquipment] the piece the player chose in the lobby (EQUIPMENT), if any
     */
    constructor({ startingEquipment = null } = {}) {
        this.client = null;
        this.session = null;
        /** The lobby's choice of equipment, until the host has been asked for it. */
        this.startingEquipment = isEquipment(startingEquipment) ? startingEquipment : null;
        /** The jump in progress on screen: { phase: 'spool' | 'exit', elapsed, seconds }, or null. */
        this.warp = null;
        /** The mode's window that is open (MATCH_PANEL), or null; and whether the refit window is. */
        this.openPanel = null;
        this.refitOpen = false;
        /** Whether the introduction is on screen (null before the first state has said). */
        this.introShowing = null;
        /** The ending being played: { elapsed, seconds, won, showResults, stage }, or null. */
        this.outro = null;
        /** True from the moment the match is decided: the picture is the ending's from then on. */
        this.decided = false;
    }

    sanitizeState(raw) {
        const state = sanitizeBattleRoyaleState(raw);
        if (!state) return null;
        this.followIntro(state);
        // The host is listening now: ask for what was chosen in the lobby, once.
        if (this.startingEquipment && state.you?.picks > 0) {
            this.pickEquipment(this.startingEquipment);
            this.startingEquipment = null;
        }
        return state;
    }

    begin(client, session) {
        this.client = client;
        this.session = session;
        // Until the introduction is over the player is nowhere: the view is the dying sun, from outside.
        session.world.setSector(BATTLE_ROYALE.intro.sectorId);
    }

    // ---- The introduction and the ending -------------------------------------------------------

    /** Music and a cue as the introduction starts, and again as the ships enter the system. */
    followIntro(state) {
        const showing = state.intro !== null && state.phase === MATCH_PHASE.PLAYING;
        if (showing === this.introShowing) return;
        this.introShowing = showing;
        this.session.playMusic(showing ? 'calm' : 'battle');
        if (showing) this.session.playCue(CUE.INTRO);
    }

    /**
     * The match is decided. Plays the ending at the stargate - the winners go through it,
     * everybody else watches it close - and only then lets the result screen up.
     */
    onMatchOver(state, showResults) {
        if (this.outro) return true;
        const { session } = this;
        const won = Boolean(state.winner) && state.you?.faction === state.winner;
        this.setPanel(null);
        this.refitOpen = false;
        this.decided = true;
        session.setWaypoint(null);
        session.ui.set({ refit: null, matchOutro: { winner: state.winner, won } });
        this.warp = null;
        this.outro = { elapsed: 0, seconds: BATTLE_ROYALE.outro.seconds, won, showResults, stage: this.stageEnding(state, won) };
        session.playCue(won ? CUE.VICTORY : CUE.DEFEAT);
        if (won) session.playMusic('finale');
        return true;
    }

    /**
     * Sets the ending's stage: wherever the player was (or was not: they may be dead), this
     * device now shows the stargate, the station it stands off, the player's own ship and
     * the rest of the winning side's. The ceremony says where each of them goes.
     * @returns {{ ceremony: GateCeremony, own: object, flyers: object[] }}
     */
    stageEnding(state, won) {
        const { client, session } = this;
        const { world } = session;
        const { sectorId } = GATE_PLANET;
        const start = SECTORS[sectorId].playerStart;
        client.takeStage(sectorId);

        const station = stationPose(start, BATTLE_ROYALE.station);
        world.spawnShip(BATTLE_ROYALE.station.classId, {
            faction: FACTION.NEUTRAL, position: station.position, quaternion: station.quaternion.toArray(),
            tags: [STATION_TAG], invulnerable: true, targetable: false,
        });
        buildGate(world, sectorId, BATTLE_ROYALE.station, BATTLE_ROYALE.gate);
        world.gateField.faction = state.winner;

        const me = state.players.find((player) => player.id === client.localPlayerId);
        const others = state.winner
            ? state.players.filter((player) => player.faction === state.winner && player !== me).slice(0, MAX_FLYERS)
            : [];
        const ceremony = new GateCeremony({
            gate: gatePose(start, BATTLE_ROYALE.station, BATTLE_ROYALE.gate), timing: BATTLE_ROYALE.outro,
            won, opens: Boolean(state.winner), others: others.length,
        });
        // Whoever goes through is under full burn; a watcher's engines idle.
        const fly = (ship, burning) => {
            ship.speed = burning ? ship.cls.maxSpeed : 0;
            ship.boosting = burning;
            return ship;
        };
        const own = fly(world.spawnShip(playerClass(me?.classId), {
            faction: me?.faction ?? state.you?.faction ?? FACTION.NEUTRAL, pilotId: client.localPlayerId,
        }), won);
        const flyers = others.map((player) => fly(world.spawnShip(playerClass(player.classId), {
            faction: player.faction, pilotId: player.id, callsign: player.name, local: false,
        }), true));
        const stage = { ceremony, own, flyers };
        this.playEnding(stage, 0);
        return stage;
    }

    /** Puts everything on the ending's stage where it belongs `elapsed` seconds in. */
    playEnding({ ceremony, own, flyers }, elapsed) {
        const { world } = this.session;
        ceremony.placeViewer(elapsed, own.position, own.quaternion);
        flyers.forEach((ship, index) => {
            // Through the gate: gone.
            if (ship.alive && ceremony.placeFlyer(index, elapsed, ship.position, ship.quaternion)) world.removeShip(ship);
        });
        ceremony.field(elapsed, world.gateField);
        world.warpFactor = ceremony.warp(elapsed);
        world.screenFade = ceremony.fade(elapsed);
    }

    updateOutro(dt) {
        const { outro, session } = this;
        outro.elapsed += dt;
        this.playEnding(outro.stage, Math.min(outro.elapsed, outro.seconds));
        if (outro.elapsed < outro.seconds) return;
        this.outro = null;
        if (outro.won) {
            // Through the gate: the flash of arrival, and the streaks let go behind the result.
            session.onWarp('arrive');
            this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        }
        session.ui.set({ matchOutro: null });
        outro.showResults();
    }

    onEvent(name, data) {
        const { session } = this;
        const here = this.client.state?.you?.planet;
        switch (name) {
            case BR_EVENT.JUMP_SPOOL:
                this.warp = { phase: 'spool', elapsed: 0, seconds: Number.isFinite(data?.seconds) ? Math.max(0.1, data.seconds) : 1 };
                session.onWarp('spool');
                break;
            case BR_EVENT.JUMP_REFUSED:
                session.showToast(`mp.jump.refused.${String(data?.reason)}`);
                break;
            case BR_EVENT.COLLAPSE:
                if (data?.status === PLANET_STATUS.SAFE) break;
                session.showToast(`mp.collapse.${String(data?.status)}`, { planet: planetName(data?.planet) });
                // The alarm is for whoever is on that planet; the rest only read about it.
                if (data?.planet === here) session.playCue('alarm');
                break;
            case BR_EVENT.CAPTURED:
                session.showToast('mp.captured', { planet: planetName(data?.planet), faction: factionName(data?.faction) });
                session.playCue('power');
                break;
            case BR_EVENT.REWARD:
                session.showToast('mp.reward', { points: Number(data?.points) || 0, summons: Number(data?.summons) || 0 });
                break;
            case BR_EVENT.REVIVED:
                session.showToast('mp.revived', { planet: planetName(data?.planet) });
                break;
            case BR_EVENT.WARNING:
                session.showToast('mp.loyalty.warning');
                session.playCue('alarm');
                break;
            case BR_EVENT.BRANDED:
                session.showToast('mp.loyalty.branded');
                session.playCue('alarm');
                break;
            case BR_EVENT.DOCKED:
                session.showToast('mp.dock.docked', { seconds: Number(data?.seconds) || 0 });
                session.playCue('power');
                break;
            case BR_EVENT.UNDOCKED:
                session.showToast(`mp.dock.ended.${String(data?.reason)}`);
                break;
            case BR_EVENT.DOCK_REFUSED:
                session.showToast(`mp.dock.refused.${String(data?.reason)}`);
                break;
            case BR_EVENT.STATION_ALARM:
                session.showToast('mp.station.alarm', { planet: planetName(data?.planet), faction: factionName(data?.faction) });
                session.playCue('alarm');
                break;
            case BR_EVENT.STATION_LOST:
                session.showToast('mp.station.lost', { planet: planetName(data?.planet), faction: factionName(data?.faction) });
                session.playCue('alarm');
                break;
            case BR_EVENT.PICKS:
                session.showToast('mp.equipment.earned');
                break;
            case BR_EVENT.EQUIPMENT_USED:
                session.showToast(`mp.equipment.${String(data?.item)}.used`);
                session.playCue('power');
                break;
            case BR_EVENT.BEACON_SET:
                session.showToast('mp.equipment.beaconSet', { planet: planetName(data?.planet) });
                break;
            default:
        }
    }

    // ---- The pilot's own keys and windows -----------------------------------------------------

    /** Keys and buttons that belong to this mode (input/InputController.js MATCH_KEYS). */
    handleAction(action) {
        const state = this.client.state;
        // Nothing to open while the story is being told.
        if (this.outro || state?.intro != null) return Object.values(MATCH_ACTION).includes(action);
        switch (action) {
            case MATCH_ACTION.MAP:
                this.setPanel(this.panel === MATCH_PANEL.MAP ? null : MATCH_PANEL.MAP);
                return true;
            case MATCH_ACTION.REFIT:
                if (state?.you?.alive && state.you.points > 0) this.openRefit();
                return true;
            case MATCH_ACTION.SUMMON:
                if (state?.you?.alive && state.you.summons > 0) this.client.request(BR_REQUEST.SUMMON);
                return true;
            case MATCH_ACTION.DOCK:
                // One key clamps on and lets go; if the ship cannot dock here the host says why.
                if (state?.you?.alive) this.client.request(this.docked ? BR_REQUEST.UNDOCK : BR_REQUEST.DOCK);
                return true;
            case MATCH_ACTION.EQUIPMENT:
                this.setPanel(this.panel === MATCH_PANEL.EQUIPMENT ? null : MATCH_PANEL.EQUIPMENT);
                return true;
            default:
                return false;
        }
    }

    get panel() {
        return this.openPanel;
    }

    /** Opens one of the mode's windows (MATCH_PANEL), or closes whichever is open (null). */
    setPanel(panel) {
        this.openPanel = panel;
        this.session.ui.set({ matchPanel: panel });
    }

    /** The refit window of the campaign, here for spending the points a captured planet pays. */
    openRefit() {
        const { you } = this.client.state;
        const ship = this.session.world.player;
        if (!ship) return;
        this.refitOpen = true;
        this.session.ui.set({ refit: { points: you.points, classId: ship.classId, upgrades: you.upgrades, inFlight: true } });
    }

    applyRefit(added) {
        this.refitOpen = false;
        if (added && Object.values(added).some((levels) => levels > 0)) this.client.request(BR_REQUEST.REFIT, { added });
    }

    /** True while the player's ship is clamped on to a station. */
    get docked() {
        return this.client?.state?.you?.dock?.left != null;
    }

    /**
     * With a window of the mode's open the pilot is not flying: the ship holds its course. Nor
     * are they while the ship is docked: the station has it.
     */
    holdsAttention() {
        return this.openPanel !== null || this.refitOpen || this.outro !== null || this.docked;
    }

    /** Spends one of the player's choices of equipment (EQUIPMENT). */
    pickEquipment(item) {
        this.client.request(BR_REQUEST.PICK, { item });
    }

    /** Sends a beacon to a planet next to the player's. */
    launchBeacon(planetId) {
        this.client.request(BR_REQUEST.BEACON, { to: planetId });
    }

    jumpTo(planetId) {
        this.client.request(BR_REQUEST.JUMP, { to: planetId });
        this.setPanel(null);
    }

    vote(choice) {
        this.client.request(BR_REQUEST.VOTE, { choice });
    }

    /** The player is somewhere new (a jump, a revival, or the start): the streaks let go. */
    onZoneEntered() {
        if (this.warp?.phase !== 'spool') return;
        this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        this.session.onWarp('arrive');
    }

    /**
     * Keeps the marker on the dock of the station here for as long as it is worth flying
     * to: until the player's own side holds it.
     */
    markDock() {
        const { session } = this;
        const state = this.client?.state;
        const here = state?.planets?.find((planet) => planet.id === state.you?.planet);
        const station = state?.you?.alive && here && here.owner !== state.you.faction && !this.docked
            ? session.world.findByTag(STATION_TAG) : null;
        if (!station) {
            if (session.waypoint?.placement.anchor === STATION_TAG) session.setWaypoint(null);
        } else if (!session.waypoint) {
            const offset = scratchOffset.fromArray(BATTLE_ROYALE.station.mouth).applyQuaternion(station.quaternion).toArray();
            session.setWaypoint({ placement: { anchor: STATION_TAG, offset }, labelKey: 'mp.waypoint.dock' });
        }
    }

    /**
     * How the stargate shows while the match is still being fought: asleep until the last
     * stand, then charging as the countdown runs out, in the colour of whoever holds its station
     * (as far as this player knows).
     */
    followGate() {
        const state = this.client?.state;
        const field = this.session.world.gateField;
        const { charge } = BATTLE_ROYALE.gate;
        const left = state?.finalStand;
        field.open = 0;
        field.shut = 0;
        field.pulse = 0;
        field.faction = state?.planets?.find((planet) => planet.id === GATE_PLANET.id)?.owner ?? null;
        field.charge = left == null ? charge.asleep
            : charge.lastStand + (charge.ready - charge.lastStand) * (1 - Math.min(1, left / BATTLE_ROYALE.collapse.finalStand));
    }

    update(dt) {
        if (this.outro) {
            this.updateOutro(dt);
            return;
        }
        // Once the match is decided the picture is the ending's stage, and stays as it left it.
        if (this.session && !this.decided) {
            this.markDock();
            this.followGate();
        }
        const { warp } = this;
        const world = this.session?.world;
        if (!warp || !world) return;
        warp.elapsed += dt;
        const progress = Math.min(1, warp.elapsed / warp.seconds);
        world.warpFactor = warp.phase === 'spool' ? progress : 1 - progress;
        // A spool whose jump never came (the ship was shot down first) fades by itself.
        if (warp.phase === 'spool' && warp.elapsed > warp.seconds + 1) this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        else if (warp.phase === 'exit' && progress >= 1) this.warp = null;
    }

    /** The objective line: where the player stands with the collapse. */
    missionHud() {
        const state = this.client?.state;
        const here = state?.planets?.find((planet) => planet.id === state.you?.planet);
        let objective = null;
        if (state?.you?.alive && here) {
            const mine = here.owner === state.you.faction;
            if (this.docked) objective = { key: 'mp.objective.docking', params: { seconds: Math.ceil(state.you.dock.left) } };
            else if (state.finalStand !== null && here.status === PLANET_STATUS.SAFE) objective = { key: 'mp.objective.gate', params: { seconds: state.finalStand } };
            else if (here.status === PLANET_STATUS.COLLAPSING) objective = { key: 'mp.objective.flee', params: { seconds: here.changesIn ?? 0 } };
            else if (here.status === PLANET_STATUS.SWALLOWED) objective = { key: mine ? 'mp.objective.sheltered' : 'mp.objective.doomed', params: null };
            else objective = { key: mine ? 'mp.objective.outward' : 'mp.objective.station', params: null };
        }
        return { escort: null, boss: null, progress: null, objective };
    }

    dispose() {
        if (this.session) {
            this.session.world.warpFactor = 0;
            this.session.world.screenFade = 0;
            Object.assign(this.session.world.gateField, { charge: 0, open: 0, shut: 0, pulse: 0, faction: null });
            this.session.setWaypoint(null);
        }
        this.warp = null;
        this.outro = null;
        this.decided = false;
        this.openPanel = null;
        this.refitOpen = false;
    }
}
