import { BATTLE_ROYALE, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { SECTORS } from '../../config/sectors.js';
import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { destroyShip } from '../../core/systems/damage.js';
import { BR_REQUEST } from './battleRoyaleProtocol.js';
import { Exodus, GateVigil, INTRO_ACT, IntroClock, introMoment } from './introShow.js';
import { STATION_TAG, buildGate, gatePose, stationPose } from './station.js';

/** The planet the stargate stands at. */
const GATE_PLANET = STAR_SYSTEM.planets.find((planet) => planet.gate);
/** What the eye is hung on when the host never named the player's ship. */
const FALLBACK_SHIP = 'kestrel';
/** Seconds between two requests to skip, while the host has not counted this player's (a host that took the match over may not know of it). */
const ASK_AGAIN_SECONDS = 1.5;
/** A key, click or button this soon after the story starts on this device is the one that started the match, not a wish to skip it (seconds). */
const SKIP_GUARD_SECONDS = 0.7;

/**
 * The story before a battle royale on one device's stage (the choreography is introShow.js).
 *
 * From the host's first word that the story is on until its word that it is over, this
 * device's picture is the story's: the dying sun, then the stargate. Nothing here decides
 * anything - the host counts the seconds and lets every ship into the system at once - so a
 * device that is slow to set its stage, or shows none of it, enters with everybody else.
 *
 * A player who asks to skip it goes on looking at it under the list of the sides (the page's
 * and the headset's menus show that); the host ends the story early once everybody has asked.
 */
export class IntroStage {
    /**
     * @param {object} options
     * @param {import('../../net/match/ClientMatch.js').ClientMatch} options.client
     * @param {import('../../state/GameSession.js').GameSession} options.session
     * @param {object} [options.timing] BATTLE_ROYALE.intro
     */
    constructor({ client, session, timing = BATTLE_ROYALE.intro }) {
        this.client = client;
        this.session = session;
        this.timing = timing;
        this.clock = new IntroClock(timing.seconds);
        /** Seconds this device has been showing the story (the clock is the host's, and may start well in). */
        this.age = 0;
        /** The act whose stage is set (INTRO_ACT), or null before the first frame; and what stands on it. */
        this.act = null;
        this.stage = null;
        /** True once the player has asked to skip the story; and when the host was last asked (the clock's seconds). */
        this.skipped = false;
        this.askedAt = -Infinity;
        /** True once the jump's streaks have started (their sound is played once). */
        this.spooling = false;
        /** What the page and the headset were last told (`matchIntro` of the game store), as text, to tell them only of changes. */
        this.published = null;
        this.publish();
    }

    /** The host's word (a match state with the story still on): sets the clock, and makes sure a wish to skip was heard. */
    hear(state) {
        this.clock.hear(state.intro);
        if (this.skipped && state.skip && !state.skip.you && this.clock.elapsed - this.askedAt >= ASK_AGAIN_SECONDS) this.ask();
    }

    /** The player would rather not watch: the host is told (it ends the story when everybody has said so). */
    skip() {
        if (this.skipped || this.age < SKIP_GUARD_SECONDS) return;
        this.skipped = true;
        this.ask();
        this.publish();
    }

    ask() {
        this.askedAt = this.clock.elapsed;
        this.client.request(BR_REQUEST.SKIP_INTRO);
    }

    update(dt) {
        this.age += dt;
        this.clock.advance(dt);
        const moment = introMoment(this.clock.elapsed, this.timing);
        if (moment.act !== this.act) this.setStage(moment.act);
        if (this.act === INTRO_ACT.FALL) this.playFall(moment.at);
        else this.playGate(moment.at);
        this.publish(moment);
    }

    /** Tells the page and the headset where the story stands, when that has changed. */
    publish(moment = introMoment(this.clock.elapsed, this.timing)) {
        const told = { act: moment.act, line: moment.line, sides: moment.sides, skipped: this.skipped };
        const text = JSON.stringify(told);
        if (text === this.published) return;
        this.published = text;
        this.session.ui.set({ matchIntro: told });
    }

    // ---- The stage ---------------------------------------------------------------------------

    setStage(act) {
        this.act = act;
        this.stage = act === INTRO_ACT.FALL ? this.stageFall() : this.stageGate();
    }

    /**
     * The eye: the player's own ship, which is not there - nothing of it is drawn and no cockpit
     * is round it - so that the picture has a place to be seen from (scene/PlayerCamera.jsx).
     */
    spawnEye() {
        const { client, session } = this;
        const { world } = session;
        const me = client.state?.players.find((player) => player.id === client.localPlayerId);
        const classId = SHIP_CLASSES[me?.classId]?.behavior === 'player' ? me.classId : FALLBACK_SHIP;
        const eye = world.spawnShip(classId, { faction: me?.faction ?? FACTION.NEUTRAL, pilotId: client.localPlayerId });
        eye.alive = false;
        eye.speed = 0;
        session.publishRoster();
        return eye;
    }

    /** Act one's stage: the dying sun's sky, the ships that run from it and the one that did not get away. */
    stageFall() {
        const { client, session, timing } = this;
        const { world } = session;
        client.takeStage(timing.fall.sectorId);
        const show = new Exodus(timing.fall);
        // Whoever runs is under full burn.
        const burning = (ship) => {
            ship.speed = ship.cls.maxSpeed;
            ship.boosting = ship.isPlayer;
            return ship;
        };
        const runners = timing.fall.cast.map(([classId, faction]) => burning(world.spawnShip(classId, { faction, local: false })));
        const { classId, faction } = timing.fall.straggler;
        const straggler = burning(world.spawnShip(classId, { faction, local: false }));
        return { show, eye: this.spawnEye(), runners, straggler };
    }

    playFall(elapsed) {
        const { world } = this.session;
        const { show, eye, runners, straggler } = this.stage;
        show.placeViewer(elapsed, eye.position, eye.quaternion);
        runners.forEach((ship, index) => {
            // Past the eye and away: gone.
            if (ship.alive && show.placeShip(index, elapsed, ship.position, ship.quaternion)) world.removeShip(ship);
        });
        if (straggler.alive) {
            const { tidal, torn } = show.placeStraggler(elapsed, straggler.position, straggler.quaternion);
            straggler.tidal = tidal;
            if (torn) {
                // The wreck keeps falling the way it was going.
                straggler.velocity.copy(show.hole).multiplyScalar(show.fallSpeed(elapsed));
                destroyShip(world, straggler, null, { shown: true });
            }
        }
        world.screenFade = show.fade(elapsed);
    }

    /** Act two's stage: the stargate, the station it stands off, and the fleets that wait at it. */
    stageGate() {
        const { client, session, timing } = this;
        const { world } = session;
        const { sectorId } = GATE_PLANET;
        const start = SECTORS[sectorId].playerStart;
        client.takeStage(sectorId);

        const stationAt = stationPose(start, BATTLE_ROYALE.station);
        world.spawnShip(BATTLE_ROYALE.station.classId, {
            faction: FACTION.NEUTRAL, position: stationAt.position, quaternion: stationAt.quaternion.toArray(),
            tags: [STATION_TAG], invulnerable: true, targetable: false,
        });
        buildGate(world, sectorId, BATTLE_ROYALE.station, BATTLE_ROYALE.gate);
        const show = new GateVigil({ gate: gatePose(start, BATTLE_ROYALE.station, BATTLE_ROYALE.gate), timing: timing.gate, charge: BATTLE_ROYALE.gate.charge });
        const ships = show.ships.map(({ classId, faction }) => {
            const ship = world.spawnShip(classId, { faction, local: false });
            // Holding station: engines idling.
            ship.speed = 0;
            return ship;
        });
        world.singularity.direction.copy(show.hole);
        world.singularity.size = timing.gate.holeSize;
        return { show, eye: this.spawnEye(), ships };
    }

    playGate(elapsed) {
        const { session } = this;
        const { world } = session;
        const { show, eye, ships } = this.stage;
        show.placeViewer(elapsed, eye.position, eye.quaternion);
        ships.forEach((ship, index) => show.placeShip(index, elapsed, ship.position, ship.quaternion));
        show.field(elapsed, world.gateField);
        world.warpFactor = show.warp(elapsed);
        world.screenFade = show.fade(elapsed);
        if (world.warpFactor > 0 && !this.spooling) {
            this.spooling = true;
            session.onWarp('spool');
        }
    }

    /**
     * The story is over (or the match is): the picture is the host's again. Whatever it was
     * showing is dropped; the place the player's ship arrives at comes whole from the host.
     */
    end() {
        this.act = null;
        this.stage = null;
        this.client.leaveStage();
        this.session.ui.set({ matchIntro: null });
    }
}
