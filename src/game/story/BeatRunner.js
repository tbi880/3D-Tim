/** Hard cap on beats started in one frame, so a scripting mistake can never freeze the game. */
const MAX_BEATS_PER_UPDATE = 64;

/**
 * Plays a list of beats one after another.
 *
 * A beat is a plain object: `{ type, begin?(ctx, state), tick?(ctx, dt, state) }`.
 * `begin` runs once; `tick` runs every frame and returns true when the beat is over.
 * A beat without `tick` finishes immediately. `state` is a scratch object owned by this
 * run of the beat, because beat definitions are shared, immutable script data.
 */
export class BeatRunner {
    constructor(beats, startIndex = 0) {
        this.beats = beats;
        this.index = startIndex;
        this.state = null;
    }

    get finished() {
        return this.index >= this.beats.length;
    }

    /** @returns {boolean} true once every beat has finished */
    update(ctx, dt) {
        for (let guard = 0; guard < MAX_BEATS_PER_UPDATE && !this.finished; guard++) {
            const beat = this.beats[this.index];
            if (this.state === null) {
                this.state = {};
                beat.begin?.(ctx, this.state);
            }
            if (beat.tick && !beat.tick(ctx, dt, this.state)) return false;
            this.index += 1;
            this.state = null;
        }
        return this.finished;
    }
}
