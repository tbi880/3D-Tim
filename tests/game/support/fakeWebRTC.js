/**
 * A stand-in for the browser's WebRTC, enough for PeerLink: two FakePeerConnection objects
 * joined by a FakeWire exchange descriptions and candidates as strings through whatever
 * signalling the test provides, and once both have each other's description their data
 * channels open and carry messages (delivered when the test calls `wire.flush()`).
 */
export class FakeWire {
    constructor() {
        this.peers = [];
        this.queue = [];
        this.created = 0;
    }

    /** The class to hand to PeerLink as `RTCPeerConnection`. */
    get RTCPeerConnection() {
        const wire = this;
        return class extends FakePeerConnection {
            constructor(config) {
                super(wire, config);
            }
        };
    }

    /** Runs everything that is waiting to happen (channel openings, messages), like a turn of the event loop. */
    flush() {
        for (let guard = 0; guard < 100 && this.queue.length > 0; guard++) {
            for (const task of this.queue.splice(0)) task();
        }
    }

    /** Lets pending promises settle, then flushes. */
    async settle() {
        for (let i = 0; i < 6; i++) {
            await new Promise((resolve) => { setImmediate(resolve); });
            this.flush();
        }
    }
}

class FakeChannel {
    constructor(wire, label, options) {
        this.wire = wire;
        this.label = label;
        this.options = options;
        this.readyState = 'connecting';
        this.bufferedAmount = 0;
        this.binaryType = 'blob';
        this.other = null;
        this.sent = [];
        this.onopen = null;
        this.onclose = null;
        this.onmessage = null;
    }

    open() {
        if (this.readyState !== 'connecting') return;
        this.readyState = 'open';
        this.onopen?.();
    }

    send(data) {
        if (this.readyState !== 'open') throw new Error('channel is not open');
        this.sent.push(data);
        const { other } = this;
        this.wire.queue.push(() => { if (other.readyState === 'open') other.onmessage?.({ data }); });
    }

    close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        const { other } = this;
        if (other && other.readyState !== 'closed') {
            this.wire.queue.push(() => {
                if (other.readyState === 'closed') return;
                other.readyState = 'closed';
                other.onclose?.();
            });
        }
    }
}

class FakePeerConnection {
    constructor(wire, config) {
        this.wire = wire;
        this.config = config;
        this.id = wire.created++;
        wire.peers.push(this);
        this.channels = [];
        this.localDescription = null;
        this.remoteDescription = null;
        this.candidates = [];
        this.connectionState = 'new';
        this.closed = false;
        this.onicecandidate = null;
        this.ondatachannel = null;
        this.onconnectionstatechange = null;
    }

    createDataChannel(label, options) {
        const channel = new FakeChannel(this.wire, label, options);
        this.channels.push(channel);
        return channel;
    }

    async createOffer() {
        return { type: 'offer', sdp: `offer-from-${this.id}`, from: this.id };
    }

    async createAnswer() {
        return { type: 'answer', sdp: `answer-from-${this.id}`, from: this.id };
    }

    async setLocalDescription(description) {
        this.localDescription = description;
        // Like a browser, candidates trickle out once there is a local description.
        this.wire.queue.push(() => this.onicecandidate?.({ candidate: { candidate: `candidate-of-${this.id}`, sdpMid: '0' } }));
        this.wire.queue.push(() => this.onicecandidate?.({ candidate: null }));
        this.connectIfReady();
    }

    async setRemoteDescription(description) {
        if (description?.type !== 'offer' && description?.type !== 'answer') throw new Error('not a session description');
        this.remoteDescription = description;
        this.connectIfReady();
    }

    async addIceCandidate(candidate) {
        if (!this.remoteDescription) throw new Error('candidate before the remote description');
        this.candidates.push(candidate);
    }

    /** Once both ends have both descriptions, the offering side's channels appear on the answering side and open. */
    connectIfReady() {
        const remote = this.wire.peers[this.remoteDescription?.from];
        if (!remote || !this.localDescription || !remote.localDescription || remote.remoteDescription?.from !== this.id) return;
        if (this.connectionState === 'connected') return;
        const [offerer, answerer] = this.localDescription.type === 'offer' ? [this, remote] : [remote, this];
        this.wire.queue.push(() => {
            if (offerer.closed || answerer.closed) return;
            for (const peer of [offerer, answerer]) {
                peer.connectionState = 'connected';
                peer.onconnectionstatechange?.();
            }
            for (const channel of offerer.channels) {
                const twin = new FakeChannel(this.wire, channel.label, channel.options);
                channel.other = twin;
                twin.other = channel;
                answerer.channels.push(twin);
                answerer.ondatachannel?.({ channel: twin });
                channel.open();
                twin.open();
            }
        });
    }

    /** Makes the connection fail, as when the network between the devices goes away. */
    fail() {
        this.connectionState = 'failed';
        this.onconnectionstatechange?.();
    }

    close() {
        this.closed = true;
        this.connectionState = 'closed';
        for (const channel of this.channels) channel.close();
    }
}
