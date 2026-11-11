let nextLineId = 1;

/** Reading speed used to decide how long a comms line stays on screen. */
const BASE_SECONDS = 2.2;
const SECONDS_PER_LATIN_CHARACTER = 0.052;
const SECONDS_PER_CJK_CHARACTER = 0.17;
const CJK_PATTERN = /[㐀-鿿]/g;

export function estimateReadingTime(text) {
    const cjkCount = (text.match(CJK_PATTERN) ?? []).length;
    return BASE_SECONDS + cjkCount * SECONDS_PER_CJK_CHARACTER + (text.length - cjkCount) * SECONDS_PER_LATIN_CHARACTER;
}

/**
 * Plays comms lines one at a time. The story enqueues lines and can wait on `line.finished`;
 * the HUD shows whatever `onChange` last reported.
 */
export class CommsQueue {
    /**
     * @param {object} params
     * @param {(line: object) => number} params.getDuration seconds a line should stay up
     * @param {(line: object | null) => void} params.onChange called when the visible line changes
     */
    constructor({ getDuration, onChange }) {
        this.getDuration = getDuration;
        this.onChange = onChange;
        this.pending = [];
        this.current = null;
    }

    enqueue(speakerId, textKey) {
        const line = { id: nextLineId++, speakerId, textKey, elapsed: 0, duration: 0, finished: false };
        this.pending.push(line);
        return line;
    }

    update(dt) {
        if (!this.current) {
            if (this.pending.length === 0) return;
            this.current = this.pending.shift();
            this.current.duration = this.getDuration(this.current);
            this.onChange(this.current);
        }
        this.current.elapsed += dt;
        if (this.current.elapsed >= this.current.duration) this.finishCurrent();
    }

    /** Ends the visible line early (player pressed "skip"). */
    skip() {
        if (this.current) this.finishCurrent();
    }

    finishCurrent() {
        this.current.finished = true;
        this.current = null;
        if (this.pending.length === 0) this.onChange(null);
    }

    clear() {
        for (const line of this.pending) line.finished = true;
        if (this.current) this.current.finished = true;
        this.pending = [];
        this.current = null;
        this.onChange(null);
    }
}
