import { createControls, decodeInput } from './codec/inputPacket.js';
import { NET } from './netConfig.js';
import { parseClientMessage } from './protocol.js';

/** Counts events inside one-second windows of a clock that only moves forward. */
class PerSecondBudget {
    constructor(limit) {
        this.limit = limit;
        this.windowStart = -Infinity;
        this.used = 0;
    }

    take(now) {
        if (now - this.windowStart >= 1) {
            this.windowStart = now;
            this.used = 0;
        }
        if (this.used >= this.limit) return false;
        this.used += 1;
        return true;
    }
}

/**
 * The host's gatekeeper for one client. Every packet from that client goes through here
 * before it can touch the simulation:
 *  - inputs must be exactly an input packet, newer than the last one, and within the rate budget;
 *  - reliable messages must be one of the three kinds a client may send, well formed, within budget.
 * Anything else is dropped and counted as a strike; a client that keeps it up is `banned`
 * and the host disconnects it.
 */
export class ClientGuard {
    /** @param {() => number} now clock in seconds */
    constructor(now) {
        this.now = now;
        this.inputBudget = new PerSecondBudget(NET.maxInputsPerSecond);
        this.eventBudget = new PerSecondBudget(NET.maxEventsPerSecond);
        this.lastSeq = 0;
        this.strikes = 0;
        this.scratchControls = createControls();
    }

    get banned() {
        return this.strikes >= NET.maxStrikes;
    }

    strike() {
        this.strikes += 1;
        return null;
    }

    /**
     * @param {ArrayBuffer | ArrayBufferView} data
     * @returns {{ seq: number, controls: object, autoFire: boolean } | null} the input, or null if the packet was dropped.
     *          `controls` is reused by the next call: copy what you keep.
     */
    acceptInput(data) {
        // Too many is not a strike by itself (a fast display sends fast); the extra ones are just not flown.
        if (!this.inputBudget.take(this.now())) return null;
        let input;
        try {
            input = decodeInput(data, this.scratchControls);
        } catch {
            return this.strike();
        }
        // Unreliable packets can overtake each other: an older one is stale, not an attack.
        if (input.seq <= this.lastSeq) return null;
        this.lastSeq = input.seq;
        return input;
    }

    /**
     * @param {unknown} raw text from the reliable channel
     * @returns {object | null} the validated message (protocol.js), or null if it was dropped
     */
    acceptMessage(raw) {
        if (!this.eventBudget.take(this.now())) return this.strike();
        try {
            return parseClientMessage(raw);
        } catch {
            return this.strike();
        }
    }
}
