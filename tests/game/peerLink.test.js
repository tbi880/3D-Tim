import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNELS, NET } from '../../src/game/net/netConfig.js';
import { LINK_STATUS, PeerLink } from '../../src/game/net/transport/PeerLink.js';
import { FakeWire } from './support/fakeWebRTC.js';

/** Timers the test fires by hand. */
function manualTimers() {
    const pending = new Map();
    let next = 1;
    return {
        setTimeout: (callback, ms) => { pending.set(next, { callback, ms }); return next++; },
        clearTimeout: (id) => { pending.delete(id); },
        fire: () => { for (const [id, { callback }] of [...pending]) { pending.delete(id); callback(); } },
        get delays() { return [...pending.values()].map(({ ms }) => ms); },
    };
}

/**
 * A joiner and a host, each with a PeerLink, signalling to each other through `relay`
 * (which a test can replace to drop, reorder or forge messages).
 */
function pair({ relay = null } = {}) {
    const wire = new FakeWire();
    const timers = manualTimers();
    const statuses = { joiner: [], host: [] };
    const signals = [];
    const links = {};
    const deliver = (to, type, payload) => links[to]?.handleSignal(type, payload);
    const send = (from, to) => (type, payload) => {
        signals.push({ from, type });
        (relay ?? deliver)(to, type, payload, deliver);
    };
    links.host = new PeerLink({ initiator: false, sendSignal: send('host', 'joiner'), onStatus: (status) => statuses.host.push(status), RTCPeerConnection: wire.RTCPeerConnection, timers });
    links.joiner = new PeerLink({ initiator: true, sendSignal: send('joiner', 'host'), onStatus: (status) => statuses.joiner.push(status), RTCPeerConnection: wire.RTCPeerConnection, timers });
    return { wire, timers, statuses, signals, ...links };
}

test('the joiner offers, the host answers, and both ends open', async () => {
    const { wire, joiner, host, statuses, signals } = pair();
    assert.equal(joiner.status, LINK_STATUS.CONNECTING);
    await wire.settle();

    assert.deepEqual(signals.filter((signal) => signal.type !== 'ice'), [{ from: 'joiner', type: 'offer' }, { from: 'host', type: 'answer' }]);
    assert.ok(signals.some((signal) => signal.type === 'ice' && signal.from === 'joiner'));
    assert.ok(signals.some((signal) => signal.type === 'ice' && signal.from === 'host'));
    assert.equal(joiner.isOpen, true);
    assert.equal(host.isOpen, true);
    assert.deepEqual(statuses, { joiner: [LINK_STATUS.OPEN], host: [LINK_STATUS.OPEN] });
});

test('snapshots and inputs go on an unreliable channel, everything else on a reliable one', async () => {
    const { wire, joiner } = pair();
    await wire.settle();

    assert.deepEqual(joiner.channels.state.options, { ordered: false, maxRetransmits: 0 });
    assert.equal(joiner.channels.state.label, CHANNELS.STATE);
    assert.deepEqual(joiner.channels.events.options, { ordered: true });
    assert.equal(joiner.channels.state.binaryType, 'arraybuffer');
});

test('each kind of packet arrives at its own handler on the other side', async () => {
    const { wire, joiner, host } = pair();
    await wire.settle();
    const got = { states: [], messages: [] };
    host.onState = (data) => got.states.push(new Uint8Array(data)[0]);
    host.onMessage = (text) => got.messages.push(text);

    joiner.sendState(new Uint8Array([7]).buffer);
    joiner.sendMessage('{"t":"hello"}');
    wire.flush();

    assert.deepEqual(got, { states: [7], messages: ['{"t":"hello"}'] });
});

test('packets that arrive before anybody listens are kept for whoever does', async () => {
    const { wire, joiner, host } = pair();
    await wire.settle();
    joiner.sendMessage('first');
    joiner.sendMessage('second');
    wire.flush();

    const got = [];
    host.onMessage = (text) => got.push(text);

    assert.deepEqual(got, ['first', 'second']);
});

test('only a little is kept for a listener that never comes', async () => {
    const { wire, joiner, host } = pair();
    await wire.settle();
    for (let i = 0; i < 50; i++) joiner.sendState(new Uint8Array([i]).buffer);
    wire.flush();

    const got = [];
    host.onState = (data) => got.push(new Uint8Array(data)[0]);

    assert.ok(got.length <= 8, `${got.length} kept`);
    assert.equal(got.at(-1), 49, 'the newest ones');
});

test('data of the wrong kind on a channel is ignored', async () => {
    const { wire, joiner, host } = pair();
    await wire.settle();
    const got = [];
    host.onState = (data) => got.push(data);
    host.onMessage = (text) => got.push(text);

    joiner.channels.state.send('text on the binary channel');
    joiner.channels.events.send(new ArrayBuffer(4));
    wire.flush();

    assert.deepEqual(got, []);
});

test('a channel with any other name is refused', async () => {
    const { wire, joiner, host } = pair();
    const stray = joiner.peer.createDataChannel('backdoor', {});
    await wire.settle();

    assert.equal(host.isOpen, true, 'the link itself still opens');
    assert.equal(stray.readyState, 'closed');
    assert.deepEqual(Object.keys(host.channels).sort(), ['events', 'state']);
});

test('candidates that arrive before the description wait for it', async () => {
    const held = [];
    // The lobby delivers the joiner's candidates before its offer.
    const relay = (to, type, payload, deliver) => {
        if (to === 'host' && type === 'offer') {
            held.push(() => deliver(to, type, payload));
            return;
        }
        deliver(to, type, payload);
    };
    const { wire, joiner, host } = pair({ relay });
    await wire.settle();
    assert.equal(host.isOpen, false);
    assert.ok(host.pendingCandidates.length > 0, 'candidates are waiting');

    held.forEach((release) => release());
    await wire.settle();

    assert.equal(host.isOpen, true);
    assert.equal(joiner.isOpen, true);
    assert.equal(host.pendingCandidates.length, 0);
    assert.ok(host.peer.candidates.length > 0, 'and were added once the offer was in');
});

test('signals that do not belong to the handshake are ignored', async () => {
    const { wire, joiner, host } = pair();
    await wire.settle();
    const hostDescription = host.peer.remoteDescription;

    // A second offer to the host, an offer to the joiner, an answer to the host, rubbish.
    host.handleSignal('offer', JSON.stringify({ type: 'offer', sdp: 'again', from: 99 }));
    joiner.handleSignal('offer', JSON.stringify({ type: 'offer', sdp: 'wrong way', from: 99 }));
    host.handleSignal('answer', JSON.stringify({ type: 'answer', sdp: 'wrong way', from: 99 }));
    host.handleSignal('offer', 'not json');
    host.handleSignal('ice', '{broken');
    await wire.settle();

    assert.equal(host.peer.remoteDescription, hostDescription);
    assert.equal(host.isOpen, true);
    assert.equal(joiner.isOpen, true);
});

test('a description the browser rejects closes the link instead of leaving it hanging', async () => {
    const { wire, host, statuses } = pair({ relay: () => {} });
    host.handleSignal('offer', JSON.stringify({ type: 'nonsense' }));
    await wire.settle();

    assert.equal(host.status, LINK_STATUS.CLOSED);
    assert.deepEqual(statuses.host, [LINK_STATUS.CLOSED]);
});

test('closing one end closes the other, and each is told once', async () => {
    const { wire, joiner, host, statuses } = pair();
    await wire.settle();
    let closed = 0;
    host.onClose = () => { closed += 1; };

    joiner.close();
    joiner.close();
    wire.flush();

    assert.equal(host.status, LINK_STATUS.CLOSED);
    assert.equal(closed, 1);
    assert.deepEqual(statuses.host, [LINK_STATUS.OPEN, LINK_STATUS.CLOSED]);
    assert.deepEqual(statuses.joiner, [LINK_STATUS.OPEN, LINK_STATUS.CLOSED]);
    // Sending on a closed link is harmless.
    joiner.sendState(new ArrayBuffer(1));
    joiner.sendMessage('x');
    host.handleSignal('ice', '{}');
});

test('a connection that fails closes the link', async () => {
    const { wire, joiner } = pair();
    await wire.settle();

    joiner.peer.fail();

    assert.equal(joiner.status, LINK_STATUS.CLOSED);
});

test('a link that does not open in time gives up', async () => {
    const { wire, joiner, timers, statuses } = pair({ relay: () => {} });
    await wire.settle();
    assert.equal(joiner.status, LINK_STATUS.CONNECTING);
    assert.ok(timers.delays.includes(NET.connectTimeout * 1000));

    timers.fire();

    assert.equal(joiner.status, LINK_STATUS.CLOSED);
    assert.deepEqual(statuses.joiner, [LINK_STATUS.CLOSED]);
});

test('an open link is not closed by the connect timer', async () => {
    const { wire, joiner, timers } = pair();
    await wire.settle();

    timers.fire();

    assert.equal(joiner.isOpen, true);
    assert.deepEqual(timers.delays, []);
});

test('a snapshot is not queued behind a backlog', async () => {
    const { wire, joiner } = pair();
    await wire.settle();
    joiner.channels.state.bufferedAmount = 10_000_000;

    joiner.sendState(new ArrayBuffer(8));

    assert.equal(joiner.channels.state.sent.length, 0, 'dropped: a late snapshot is worth nothing');
    joiner.channels.state.bufferedAmount = 0;
    joiner.sendState(new ArrayBuffer(8));
    assert.equal(joiner.channels.state.sent.length, 1);
});
