/**
 * The two ends of a link, as the matches see them (WebRTC in the browser: PeerLink.js; in
 * memory for tests: here). A link joins one player to the host.
 *
 *   isOpen                    false once either side has closed it
 *   sendState(ArrayBuffer)    unreliable, unordered: snapshots and inputs. May never arrive.
 *   sendMessage(string)       reliable, ordered: JSON text
 *   onState, onMessage, onClose   assign handlers; messages that arrive before a handler is
 *                             set are kept and delivered when it is
 *   close()
 */

class MemoryEnd {
    constructor(options) {
        this.options = options;
        this.isOpen = true;
        this.peer = null;
        this.onClose = null;
        this.inbox = [];
        this.handlers = { state: null, message: null };
        this.backlog = { state: [], message: [] };
        this.sent = { state: 0, message: 0, stateBytes: 0 };
    }

    set onState(handler) { this.setHandler('state', handler); }
    get onState() { return this.handlers.state; }
    set onMessage(handler) { this.setHandler('message', handler); }
    get onMessage() { return this.handlers.message; }

    setHandler(kind, handler) {
        this.handlers[kind] = handler;
        if (!handler) return;
        for (const payload of this.backlog[kind].splice(0)) handler(payload);
    }

    sendState(buffer) {
        if (!this.isOpen) return;
        this.sent.state += 1;
        this.sent.stateBytes += buffer.byteLength;
        if (this.options.loss > 0 && this.options.random() < this.options.loss) return;
        // A copy, as a real link would make: the sender may reuse its buffer.
        this.peer.inbox.push({ kind: 'state', payload: buffer.slice(0), due: this.options.clock() + this.options.latency });
    }

    sendMessage(text) {
        if (!this.isOpen) return;
        this.sent.message += 1;
        this.peer.inbox.push({ kind: 'message', payload: String(text), due: this.options.clock() + this.options.latency });
    }

    /** Delivers everything that is due. Tests call this where a browser would run its event loop. */
    deliver() {
        const now = this.options.clock();
        while (this.isOpen && this.inbox.length > 0 && this.inbox[0].due <= now) {
            const { kind, payload } = this.inbox.shift();
            const handler = this.handlers[kind];
            if (handler) handler(payload);
            else this.backlog[kind].push(payload);
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.onClose?.();
        this.peer.close();
    }
}

/**
 * Two connected link ends.
 * @param {object} [options]
 * @param {number} [options.latency] seconds a packet takes, by `clock`
 * @param {number} [options.loss] chance (0..1) that an unreliable packet is lost
 * @param {() => number} [options.clock] time in seconds
 * @param {() => number} [options.random] 0..1, for `loss`
 * @returns {[MemoryEnd, MemoryEnd]}
 */
export function createMemoryLinkPair({ latency = 0, loss = 0, clock = () => 0, random = Math.random } = {}) {
    const options = { latency, loss, clock, random };
    const a = new MemoryEnd(options);
    const b = new MemoryEnd(options);
    a.peer = b;
    b.peer = a;
    return [a, b];
}
