/**
 * The throttle on a phone or tablet: one finger slid up or down anywhere on the open view.
 *
 * The view itself is free for this: on a touch screen the ship is steered with the on-screen
 * stick, never by dragging the picture, and the stick, the buttons and the comms line take
 * their own touches before the view under them sees any. So a finger that lands on the view
 * (input/InputController.js listens there) and moves up or down is setting the throttle.
 *
 * The swipe is relative: it starts from the throttle the ship has and adds what the finger
 * travels, so it does not matter where on the screen the finger lands, and lifting it leaves
 * the throttle where it is. A finger that only taps, or wanders sideways, changes nothing.
 * One finger sets the throttle at a time; another one landing on the view meanwhile is ignored.
 */

export const THROTTLE_SWIPE = Object.freeze({
    /** Up-and-down travel (px) before a touch counts as a swipe: a tap or a resting thumb sets nothing. */
    slop: 10,
    /** Finger travel for idle to full throttle, as a fraction of the screen height... */
    span: 0.5,
    /** ...but never less or more than this many pixels (a small phone, a large tablet). */
    minSpanPx: 140,
    maxSpanPx: 320,
});

/** How far (px) a finger travels between idle and full throttle on a screen this tall. */
export function swipeSpan(viewportHeight) {
    const span = (Number.isFinite(viewportHeight) ? viewportHeight : 0) * THROTTLE_SWIPE.span;
    return Math.max(THROTTLE_SWIPE.minSpanPx, Math.min(THROTTLE_SWIPE.maxSpanPx, span));
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Follows the one finger that is setting the throttle. No DOM in here: it is fed positions. */
export class ThrottleSwipe {
    constructor() {
        this.pointerId = null;
        this.startY = 0;
        /** Where the finger was when the throttle was `base` (set once the swipe is under way). */
        this.anchorY = 0;
        this.base = 0;
        this.swiping = false;
    }

    /** True while a finger that came down on the view is being followed (swiping yet or not). */
    get active() {
        return this.pointerId !== null;
    }

    /** A finger came down on the view. Returns false when another one already has the throttle. */
    begin(pointerId, y) {
        if (this.active) return false;
        this.pointerId = pointerId;
        this.startY = y;
        this.swiping = false;
        return true;
    }

    /**
     * The finger moved. Returns the throttle it now asks for (0..1), or null when this is not
     * the throttle finger or it has not travelled far enough to be a swipe yet.
     *
     * @param {() => number} getBase the throttle to start from, asked once, when the swipe begins
     * @param {number} viewportHeight screen height in px
     */
    move(pointerId, y, getBase, viewportHeight) {
        if (pointerId !== this.pointerId) return null;
        if (!this.swiping) {
            if (Math.abs(y - this.startY) < THROTTLE_SWIPE.slop) return null;
            // Count from the edge of the slop: the throttle does not jump by it, and a fast flick
            // that crosses it in one move loses nothing.
            this.swiping = true;
            this.anchorY = this.startY + Math.sign(y - this.startY) * THROTTLE_SWIPE.slop;
            this.base = clamp01(getBase() ?? 0);
        }
        const span = swipeSpan(viewportHeight);
        const wanted = this.base + (this.anchorY - y) / span;
        const value = clamp01(wanted);
        // Past either end the anchor follows the finger: turning back takes effect at once
        // instead of first undoing the overshoot.
        if (value !== wanted) this.anchorY = y + (value - this.base) * span;
        return value;
    }

    /** The finger lifted (or the touch was cancelled). Returns true if it was the throttle finger. */
    end(pointerId) {
        if (pointerId !== this.pointerId) return false;
        this.reset();
        return true;
    }

    reset() {
        this.pointerId = null;
        this.swiping = false;
    }
}
