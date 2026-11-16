import { CHANNELS, ICE_SERVERS, NET } from '../netConfig.js';

export const LINK_STATUS = Object.freeze({ CONNECTING: 'connecting', OPEN: 'open', CLOSED: 'closed' });

/** The unreliable channel is for "now": if this much is queued behind it (bytes), a new packet is not worth sending. */
const STATE_BACKLOG_LIMIT = 64 * 1024;
/** Most packets kept for a handler that has not been set yet. */
const BACKLOG_LIMIT = Object.freeze({ state: 8, message: 256 });

/**
 * A link to another player's device over WebRTC (the interface is described in
 * MemoryLink.js). On one Wi-Fi the two browsers talk to each other directly, without
 * anything in between, which is what keeps the delay to a few milliseconds. Across the
 * internet they still do where their networks allow it; where they do not, the traffic goes
 * through a TURN relay, if the lobby server has one to offer (`iceServers`).
 *
 * Two data channels: "state" (unordered, never retransmitted) for snapshots and inputs, and
 * "events" (ordered, reliable) for everything that must arrive.
 *
 * The devices find each other through the lobby server: each side hands its offer / answer
 * / ICE candidates to `sendSignal`, and the other side's arrive through `handleSignal`.
 * The player who joins a room is the initiator; the host answers.
 */
export class PeerLink {
    /**
     * @param {object} params
     * @param {boolean} params.initiator true on the joining player's device
     * @param {(type: 'offer' | 'answer' | 'ice', payload: string) => void} params.sendSignal
     * @param {(status: string) => void} [params.onStatus] told when the link opens or closes (for the lobby)
     * @param {object[]} [params.iceServers] STUN / TURN servers from the lobby server (default: netConfig's STUN servers)
     * @param {typeof RTCPeerConnection} [params.RTCPeerConnection] replaceable in tests
     * @param {object} [params.timers] { setTimeout, clearTimeout }, replaceable in tests
     */
    constructor({ initiator, sendSignal, onStatus = null, iceServers = ICE_SERVERS, RTCPeerConnection: Peer = globalThis.RTCPeerConnection, timers = globalThis }) {
        this.initiator = initiator;
        this.sendSignal = sendSignal;
        this.onStatus = onStatus;
        this.timers = timers;
        this.status = LINK_STATUS.CONNECTING;
        this.onClose = null;
        this.handlers = { state: null, message: null };
        this.backlog = { state: [], message: [] };
        this.channels = { state: null, events: null };
        /** Candidates that arrived before the other side's description; added once it is in. */
        this.pendingCandidates = [];
        this.hasRemoteDescription = false;

        this.peer = new Peer({ iceServers });
        this.peer.onicecandidate = (event) => {
            if (event.candidate) this.sendSignal('ice', JSON.stringify(event.candidate));
        };
        this.peer.onconnectionstatechange = () => {
            if (this.peer.connectionState === 'failed' || this.peer.connectionState === 'closed') this.close();
        };
        this.peer.ondatachannel = (event) => this.adopt(event.channel);
        this.connectTimer = timers.setTimeout(() => {
            if (this.status === LINK_STATUS.CONNECTING) this.close();
        }, NET.connectTimeout * 1000);

        if (initiator) {
            this.adopt(this.peer.createDataChannel(CHANNELS.STATE, { ordered: false, maxRetransmits: 0 }));
            this.adopt(this.peer.createDataChannel(CHANNELS.EVENTS, { ordered: true }));
            this.negotiate(async () => {
                await this.peer.setLocalDescription(await this.peer.createOffer());
                this.sendSignal('offer', JSON.stringify(this.peer.localDescription));
            });
        }
    }

    get isOpen() {
        return this.status === LINK_STATUS.OPEN;
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

    deliver(kind, payload) {
        const handler = this.handlers[kind];
        if (handler) {
            handler(payload);
            return;
        }
        // Nobody is listening (between matches): keep a little for whoever listens next, not everything for ever.
        const backlog = this.backlog[kind];
        backlog.push(payload);
        if (backlog.length > BACKLOG_LIMIT[kind]) backlog.shift();
    }

    /** Takes a data channel (made here or by the other side) into service. Channels with any other name are refused. */
    adopt(channel) {
        if (channel.label === CHANNELS.STATE) {
            channel.binaryType = 'arraybuffer';
            channel.onmessage = (event) => { if (event.data instanceof ArrayBuffer) this.deliver('state', event.data); };
            this.channels.state = channel;
        } else if (channel.label === CHANNELS.EVENTS) {
            channel.onmessage = (event) => { if (typeof event.data === 'string') this.deliver('message', event.data); };
            this.channels.events = channel;
        } else {
            channel.close();
            return;
        }
        channel.onopen = () => this.checkOpen();
        channel.onclose = () => this.close();
        this.checkOpen();
    }

    checkOpen() {
        const { state, events } = this.channels;
        if (this.status !== LINK_STATUS.CONNECTING || state?.readyState !== 'open' || events?.readyState !== 'open') return;
        this.timers.clearTimeout(this.connectTimer);
        this.setStatus(LINK_STATUS.OPEN);
    }

    setStatus(status) {
        this.status = status;
        this.onStatus?.(status);
    }

    /** Runs a step of the WebRTC handshake; if it fails the link is no use. */
    negotiate(step) {
        step().catch((error) => {
            console.warn('[Echoes of Dawn] Could not set up the link:', error);
            this.close();
        });
    }

    /** A signalling message from the other side, as relayed by the lobby server. */
    handleSignal(type, payload) {
        if (this.status === LINK_STATUS.CLOSED) return;
        let data;
        try {
            data = JSON.parse(payload);
        } catch {
            return;
        }
        if (type === 'ice') {
            if (this.hasRemoteDescription) this.peer.addIceCandidate(data).catch(() => {});
            else this.pendingCandidates.push(data);
            return;
        }
        // Only the handshake this side is waiting for: an offer for the host, an answer for the joiner.
        if ((type === 'offer') === this.initiator || this.hasRemoteDescription) return;
        this.negotiate(async () => {
            await this.peer.setRemoteDescription(data);
            this.hasRemoteDescription = true;
            for (const candidate of this.pendingCandidates.splice(0)) this.peer.addIceCandidate(candidate).catch(() => {});
            if (type === 'offer') {
                await this.peer.setLocalDescription(await this.peer.createAnswer());
                this.sendSignal('answer', JSON.stringify(this.peer.localDescription));
            }
        });
    }

    sendState(buffer) {
        const channel = this.channels.state;
        if (this.status !== LINK_STATUS.OPEN || channel.bufferedAmount > STATE_BACKLOG_LIMIT) return;
        try {
            channel.send(buffer);
        } catch {
            // The channel closed under us: its onclose will follow.
        }
    }

    sendMessage(text) {
        if (this.status !== LINK_STATUS.OPEN) return;
        try {
            this.channels.events.send(text);
        } catch {
            // As above.
        }
    }

    close() {
        if (this.status === LINK_STATUS.CLOSED) return;
        this.timers.clearTimeout(this.connectTimer);
        this.setStatus(LINK_STATUS.CLOSED);
        for (const channel of Object.values(this.channels)) {
            if (!channel) continue;
            channel.onopen = null;
            channel.onclose = null;
            channel.onmessage = null;
            channel.close();
        }
        this.peer.onicecandidate = null;
        this.peer.onconnectionstatechange = null;
        this.peer.ondatachannel = null;
        this.peer.close();
        this.onClose?.();
    }
}
