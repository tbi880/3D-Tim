/**
 * The message feed's tuning: how long a line stays up and how many are kept. How many a
 * device SHOWS is its own business - a desktop has room for more than a phone (`rows` below).
 */
export const MESSAGE_FEED = Object.freeze({
    /** Seconds a line stays up, and one about the player themself (weight 2 and over). */
    seconds: 6,
    ownSeconds: 9,
    /** The last of those seconds it spends fading out; and those it takes to come in. */
    fadeOut: 0.6,
    fadeIn: 0.2,
    /** Lines kept at most: more than any device shows, so that one pushed off a small screen can come back. */
    capacity: 8,
    /** Lines shown at most, by the kind of screen. */
    rows: Object.freeze({ desktop: 5, touch: 3, vr: 4 }),
    /** A line weighing this much or more is about the player themself. */
    ownWeight: 2,
});

/**
 * The `rows` lines a device with room for no more shows of `lines` (oldest first, as they
 * are kept): the weightier ones, and among equals the newer - in the order they came. So a
 * line about a pilot is not pushed off a phone's three rows by garrisons shooting each other.
 */
export function shownLines(lines, rows) {
    if (lines.length <= rows) return lines;
    const kept = new Set([...lines].sort((a, b) => b.weight - a.weight || b.id - a.id).slice(0, Math.max(0, rows)));
    return lines.filter((line) => kept.has(line));
}

/** How solid a line is drawn at `time` on the feed's clock (0..1): it comes in quickly, and fades out at the end. */
export function lineOpacity(line, time, { fadeIn, fadeOut } = MESSAGE_FEED) {
    const age = time - line.at;
    const left = line.until - time;
    if (age < 0 || left <= 0) return 0;
    return Math.min(1, age / fadeIn, left / fadeOut);
}

/**
 * The lines at the side of the screen during a match: each is posted, stays up for some
 * seconds and goes. With nothing new the feed is empty, and whatever draws it draws nothing.
 *
 * It knows nothing of what a line says: a line is `{ type, weight, ... }` (net/match/feed.js),
 * and gets an `id`, the time it was posted (`at`) and the time it goes (`until`), both on the
 * feed's own clock (`time`, seconds, advanced by `update`). `onChange` is given the new list -
 * a new array each time, oldest line first - whenever a line comes or goes.
 */
export class MessageFeed {
    /**
     * @param {object} params
     * @param {(lines: object[]) => void} params.onChange
     * @param {object} [params.config] MESSAGE_FEED's `seconds`, `ownSeconds`, `ownWeight` and `capacity`
     */
    constructor({ onChange, config = MESSAGE_FEED }) {
        this.onChange = onChange;
        this.config = config;
        this.time = 0;
        this.lines = [];
        this.nextId = 1;
    }

    /** Puts a line up. Returns it as it is kept. */
    post(message) {
        const weight = Number.isFinite(message.weight) ? message.weight : 0;
        const { seconds, ownSeconds, ownWeight, capacity } = this.config;
        const line = { ...message, weight, id: this.nextId++, at: this.time, until: this.time + (weight >= ownWeight ? ownSeconds : seconds) };
        this.lines = shownLines([...this.lines, line], capacity);
        this.onChange(this.lines);
        return line;
    }

    /** Advances the feed's clock, and takes down the lines whose time is up. */
    update(dt) {
        this.time += dt;
        if (!this.lines.some((line) => line.until <= this.time)) return;
        this.lines = this.lines.filter((line) => line.until > this.time);
        this.onChange(this.lines);
    }

    clear() {
        if (this.lines.length === 0) return;
        this.lines = [];
        this.onChange(this.lines);
    }
}
