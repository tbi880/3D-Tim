import { Vector3 } from 'three';
import { SECTORS } from '../../config/sectors.js';
import { PLANET_STATUS } from './collapse.js';

/**
 * A planet's fall into the black hole, as it looks: on the star map, and at the planet itself.
 *
 * The rules of it are CollapseClock's and BattleRoyaleMode's (who bleeds, who can still jump).
 * This is only the choreography, and all of it is a function of one number - the host's
 * collapse clock - and the planet's two times on it (when it starts to fall in, when it is
 * swallowed). So every device shows the same moment of the same fall, and one that gets to
 * the planet late (or opens the map late) shows what is left of it, not the beginning.
 *
 * `fallMoment` says how things stand at a time; `FallClock` is how a device keeps the host's
 * time between the match states it is sent; the last two say where the hole is in a planet's
 * sky and how fast it drags what it has swallowed.
 */

export const FALL_PHASE = Object.freeze({
    /** Nothing to see yet. */
    SAFE: 'safe',
    /** Falling in: the hole grows in the sky, the planet is drawn out towards it, hulls shudder. */
    FALLING: 'falling',
    /** Swallowed: the planet is torn away, and what is left there is dragged in. */
    GONE: 'gone',
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (value) => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};

/** How fast the hole grows while the planet falls in: 1 would be steadily, more is slow at first. */
const GROWTH = 1.5;
/** The map's warning ring closes on the planet this many times a second at first, and this many more by the end. */
const BEAT = 0.7;
const BEAT_GAIN = 1.5;

/**
 * How a planet's fall stands at `time` on the collapse clock.
 * @param {number} time seconds on the host's collapse clock
 * @param {{ fallsAt: number, goneAt: number } | null} timetable the planet's two times; null for one that never falls in
 * @param {object} show BATTLE_ROYALE.collapse.show
 * @param {object} [out] written into and returned
 * @returns {{
 *   phase: string,      FALL_PHASE
 *   falling: number,    0..1 how far through falling in it is (1 once swallowed)
 *   gone: number,       seconds since it was swallowed (0 before)
 *   size: number,       0..1 how much of its sky the black hole has
 *   strain: number,     0..1 how hard the pull shows on hulls there
 *   ripped: number,     0..1 how far the planet itself has been torn away
 *   flash: number,      1 -> 0 the flash of the moment it is swallowed
 *   beat: number,       0..1 round and round: the map's warning ring closing on it, faster as the end comes
 * }}
 */
export function fallMoment(time, timetable, show, out = {}) {
    const started = timetable && Number.isFinite(time) ? time - timetable.fallsAt : -1;
    if (started < 0) {
        return Object.assign(out, { phase: FALL_PHASE.SAFE, falling: 0, gone: 0, size: 0, strain: 0, ripped: 0, flash: 0, beat: 0 });
    }
    const [first, swallowed, full] = show.size;
    const falling = clamp01(started / Math.max(1e-6, timetable.goneAt - timetable.fallsAt));
    const gone = Math.max(0, time - timetable.goneAt);
    const isGone = time >= timetable.goneAt;
    out.phase = isGone ? FALL_PHASE.GONE : FALL_PHASE.FALLING;
    out.falling = falling;
    out.gone = gone;
    out.size = isGone ? swallowed + (full - swallowed) * smooth(gone / show.fills) : first + (swallowed - first) * falling ** GROWTH;
    out.strain = isGone ? show.strain + (1 - show.strain) * clamp01(gone / show.grip) : show.strain * falling;
    out.ripped = isGone ? clamp01(gone / show.rip) : 0;
    out.flash = isGone ? (1 - clamp01(gone / show.flash)) ** 2 : 0;
    const beats = Math.min(started, timetable.goneAt - timetable.fallsAt) * BEAT + falling * falling * BEAT_GAIN * 4;
    out.beat = isGone ? 0 : beats - Math.floor(beats);
    return out;
}

/** True while a fall is at a point where the picture changes from frame to frame (so the map must be redrawn). */
export function isFallMoving(moment, show) {
    return moment.phase === FALL_PHASE.FALLING || (moment.phase === FALL_PHASE.GONE && moment.gone < Math.max(show.rip, show.flash));
}

/**
 * Where the black hole stands in a planet's sky: where its sun was (unit vector, the sector's axes).
 * @param {string} sectorId the sector the planet is fought over in
 */
export function holeDirection(sectorId, out = new Vector3()) {
    const sun = SECTORS[sectorId]?.light.sunDirection;
    return sun ? out.fromArray(sun).normalize() : out.set(0, 0, -1);
}

/** Metres per second per second a hull is dragged towards the hole at a swallowed planet (`drag` of the show's tuning). */
export function dragOf(ship, drag) {
    return drag[ship.cls.kind] ?? drag.other;
}

/** How far the device's idea of the host's clock may be off before it is simply set right (seconds), and how fast it is eased otherwise. */
const SNAP = 1;
const EASE = 0.2;
/** The clock is not run on by more than this without word from the host: a host that has stalled has stopped the fall too. */
const MOST_SILENCE = 1.5;

/** A timetable for a planet whose real one is not known, and a time on it long after it was swallowed. */
const STAND_IN = Object.freeze({ fallsAt: 0, goneAt: 1 });
const LONG_GONE = 1e6;

/**
 * The host's collapse clock as a device follows it: set by every match state (`clock`, and each
 * planet's `fallsAt` / `goneAt`), and run on by the device's own clock in between, so the
 * picture moves every frame and not four times a second.
 */
export class FallClock {
    /** @param {() => number} [now] the device's own clock, in seconds */
    constructor(now = () => performance.now() / 1000) {
        this.now = now;
        /** The host's time when last heard (eased), and the device's own time then; null before any word. */
        this.heard = null;
        this.heardAt = 0;
        /** @type {Map<string, { fallsAt: number, goneAt: number }>} by planet id: only the planets that fall in */
        this.timetables = new Map();
    }

    /** A match state has come (battleRoyaleState.js): `clock` is null while nothing is counting. */
    hear(state) {
        this.timetables.clear();
        for (const planet of state.planets) {
            if (planet.fallsAt !== null && planet.goneAt !== null) this.timetables.set(planet.id, { fallsAt: planet.fallsAt, goneAt: planet.goneAt });
        }
        if (state.clock === null) {
            this.heard = null;
            return;
        }
        const at = this.now();
        const guess = this.heard === null ? null : this.heard + Math.min(MOST_SILENCE, at - this.heardAt);
        this.heard = guess === null || Math.abs(state.clock - guess) > SNAP ? state.clock : guess + (state.clock - guess) * EASE;
        this.heardAt = at;
    }

    /** Seconds on the host's collapse clock, now; null before the host has said. */
    get time() {
        return this.heard === null ? null : this.heard + Math.min(MOST_SILENCE, Math.max(0, this.now() - this.heardAt));
    }

    /**
     * How a planet's fall stands now (fallMoment). Without the host's clock (a host that does not
     * send one) it is read off the planet's `status` alone: a still picture, but the right one.
     * @param {{ id: string, status?: string }} planet a planet of the match state
     */
    momentOf(planet, show, out = {}) {
        const { time } = this;
        if (time !== null) return fallMoment(time, this.timetables.get(planet.id) ?? null, show, out);
        const stands = planet.status === PLANET_STATUS.SWALLOWED ? LONG_GONE : planet.status === PLANET_STATUS.COLLAPSING ? 0.5 : -1;
        return fallMoment(stands, STAND_IN, show, out);
    }

    /** True while any planet's fall is changing from frame to frame. */
    isMoving(show) {
        const { time } = this;
        if (time === null) return false;
        const moment = {};
        for (const timetable of this.timetables.values()) {
            if (isFallMoving(fallMoment(time, timetable, show, moment), show)) return true;
        }
        return false;
    }
}
