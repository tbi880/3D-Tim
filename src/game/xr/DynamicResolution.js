/**
 * Keeps a headset at its display's frame rate by trading resolution for it.
 *
 * In VR a frame that comes late is far worse than a soft one: the picture stutters against
 * the head's own movement. And nearly all of a frame's cost on a headset's GPU grows with
 * the number of pixels drawn. So this watches how long frames take and, when too many miss
 * the display's beat, asks for each eye to be drawn into a smaller part of its buffer
 * (WebXR's viewport scaling: it takes effect on the next frame, with no reallocation); when
 * frames have been on time for a while it tries a step sharper again, and waits longer before
 * the next try each time a try fails.
 *
 * No three.js and no browser here: `update` takes frame times and returns the scale, so it
 * can be tested on its own. xr/vrPerformance.js applies the scale to the session.
 */

/** Frames are judged in batches this long (seconds). */
const WINDOW = 0.5;
/** A frame is late when it took this many times the display's interval. */
const LATE_FACTOR = 1.2;
/** More than this share of late frames in a window: drop the resolution. Under CALM_SHARE: the window was clean. */
const LATE_SHARE = 0.25;
const CALM_SHARE = 0.04;
/** One step of the scale (it scales width and height, so 0.05 is about 10 % of the pixels), and a big one when nearly every frame is late. */
const STEP = 0.05;
const BIG_STEP = 0.1;
const NEARLY_ALL = 0.75;
/** Clean windows before trying a step sharper: at first, and at most (it doubles after each failed try). */
const FIRST_PATIENCE = 8;
const MOST_PATIENCE = 120;
/** A try has failed if frames go late within this many windows of it. */
const TRY_WINDOWS = 4;
/** Longer than this is not a slow frame but a pause (the headset taken off, a model loading): ignored. */
const HITCH = 0.25;
/** Refresh rates headsets run at; the rate is recognised from frame times when the session does not tell it. */
const DISPLAY_RATES = [60, 72, 80, 90, 120];
const RATE_TOLERANCE = 0.06;
const ASSUMED_RATE = 72;

export class DynamicResolution {
    /** @param {{ min?: number }} [options] `min`: the smallest scale (of width and height) it will go to */
    constructor({ min = 0.65 } = {}) {
        this.min = min;
        this.reset();
    }

    /** Back to full resolution (a new session). */
    reset() {
        /** Width and height of each eye's picture, as a fraction of its buffer (min..1). */
        this.scale = 1;
        /** Frames per second over the last window. */
        this.fps = 0;
        this.intervals = [];
        this.elapsed = 0;
        this.calmWindows = 0;
        this.patience = FIRST_PATIENCE;
        this.windowsSinceTry = Infinity;
        this.seenRate = null;
    }

    /**
     * Call once a frame.
     * @param {number} interval seconds since the previous frame
     * @param {number} [displayRate] the display's refresh rate (Hz) when the session knows it
     * @param {boolean} [adapt] false only measures the frame rate: the scale stays at 1
     * @returns {number} the scale to draw the next frame at
     */
    update(interval, displayRate, adapt = true) {
        if (!(interval > 0) || interval > HITCH) return this.scale;
        this.intervals.push(interval);
        this.elapsed += interval;
        if (this.elapsed < WINDOW) return this.scale;

        const intervals = this.intervals;
        this.fps = intervals.length / this.elapsed;
        if (!adapt) {
            const { fps } = this;
            this.reset();
            this.fps = fps;
            return this.scale;
        }
        const rate = displayRate > 0 ? displayRate : this.#recogniseRate(intervals);
        const late = intervals.filter((value) => value > LATE_FACTOR / rate).length / intervals.length;
        this.intervals = [];
        this.elapsed = 0;
        this.windowsSinceTry += 1;

        if (late > LATE_SHARE) {
            // A step sharper that did not hold: be slower to try again.
            if (this.windowsSinceTry <= TRY_WINDOWS) this.patience = Math.min(MOST_PATIENCE, this.patience * 2);
            this.windowsSinceTry = Infinity;
            this.calmWindows = 0;
            this.scale = Math.max(this.min, this.scale - (late > NEARLY_ALL ? BIG_STEP : STEP));
        } else if (late < CALM_SHARE) {
            this.calmWindows += 1;
            if (this.calmWindows >= this.patience && this.scale < 1) {
                this.calmWindows = 0;
                this.windowsSinceTry = 0;
                this.scale = Math.min(1, this.scale + STEP);
            }
        } else {
            this.calmWindows = 0;
        }
        // Whole steps only: 0.7000000000000001 is not a new scale.
        this.scale = Math.round(this.scale * 100) / 100;
        return this.scale;
    }

    /** The display's rate, from the fastest steady pace seen so far (frames cannot come faster than the display). */
    #recogniseRate(intervals) {
        const median = [...intervals].sort((a, b) => a - b)[intervals.length >> 1];
        const match = DISPLAY_RATES.find((rate) => Math.abs(median * rate - 1) < RATE_TOLERANCE);
        if (match && !(this.seenRate >= match)) this.seenRate = match;
        return this.seenRate ?? ASSUMED_RATE;
    }
}
