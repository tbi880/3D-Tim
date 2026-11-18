/**
 * The sun's collapse: planets fall into it one at a time, innermost first, until only the
 * outermost is left.
 *
 * Each planet but the last goes through three states. The whole timetable is fixed when the
 * match starts (from its seed), so it can be shown on the map from the first second.
 */
export const PLANET_STATUS = Object.freeze({
    /** Nothing wrong here yet. */
    SAFE: 'safe',
    /** Falling in: ships bleed, but can still jump away. */
    COLLAPSING: 'collapsing',
    /** Gone: nothing jumps out (but under a gravity shield), and nothing lives long - whoever held its station included. */
    SWALLOWED: 'swallowed',
});

const between = (rng, [least, most]) => least + (most - least) * rng();

export class CollapseClock {
    /**
     * @param {object} params
     * @param {number} params.planets how many planets the system has; the last never falls in
     * @param {() => number} params.rng 0..1
     * @param {object} params.timing BATTLE_ROYALE.collapse
     * @param {number} [params.timeScale] multiplies every waiting time (a match's pace)
     */
    constructor({ planets, rng, timing, timeScale = 1 }) {
        this.collapsing = timing.collapsing;
        /** For each planet that falls in: when it starts to, and when it is gone. */
        this.schedule = [];
        let time = 0;
        for (let orbit = 0; orbit < planets - 1; orbit++) {
            const startsAt = time + between(rng, orbit === 0 ? timing.firstAfter : timing.interval) * timeScale;
            const goneAt = startsAt + timing.collapsing;
            this.schedule.push({ startsAt, goneAt });
            time = goneAt;
        }
        /** When the last planet's stand ends (see BATTLE_ROYALE.collapse.finalStand). */
        this.finalStandEndsAt = time + timing.finalStand * timeScale;
        this.time = 0;
    }

    /** The timetable, to be handed to another device (see `resume`). */
    capture() {
        return { schedule: this.schedule.map(({ startsAt, goneAt }) => [startsAt, goneAt]), finalStandEndsAt: this.finalStandEndsAt };
    }

    /**
     * A clock that goes on from a captured timetable. Returns null if `data` is not one for
     * `planets` planets.
     */
    static resume(data, planets, timing) {
        const entries = data?.schedule;
        if (!Array.isArray(entries) || entries.length !== planets - 1 || !Number.isFinite(data.finalStandEndsAt)) return null;
        if (!entries.every((entry) => Array.isArray(entry) && Number.isFinite(entry[0]) && Number.isFinite(entry[1]) && entry[1] >= entry[0])) return null;
        const clock = new CollapseClock({ planets, rng: () => 0, timing });
        clock.schedule = entries.map(([startsAt, goneAt]) => ({ startsAt, goneAt }));
        clock.finalStandEndsAt = data.finalStandEndsAt;
        return clock;
    }

    /** Moves the clock to `time` (seconds since the match started). */
    advanceTo(time) {
        this.time = time;
    }

    statusOf(orbit) {
        const entry = this.schedule[orbit];
        if (!entry || this.time < entry.startsAt) return PLANET_STATUS.SAFE;
        return this.time < entry.goneAt ? PLANET_STATUS.COLLAPSING : PLANET_STATUS.SWALLOWED;
    }

    /** Seconds until the planet's state next changes, or null if it never will again. */
    secondsToChange(orbit) {
        const entry = this.schedule[orbit];
        if (!entry || this.time >= entry.goneAt) return null;
        return (this.time < entry.startsAt ? entry.startsAt : entry.goneAt) - this.time;
    }

    /** Seconds until the planet is swallowed (0 once it has been), or null if it never will be. */
    secondsToSwallowed(orbit) {
        const entry = this.schedule[orbit];
        return entry ? Math.max(0, entry.goneAt - this.time) : null;
    }

    /** True once every planet but the last has been swallowed. */
    get finalStand() {
        const last = this.schedule[this.schedule.length - 1];
        return !last || this.time >= last.goneAt;
    }

    /** Seconds left of the final stand (0 once it is over; null before it has begun). */
    get finalStandLeft() {
        return this.finalStand ? Math.max(0, this.finalStandEndsAt - this.time) : null;
    }
}
