import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PILOT_ACTIONS } from '../../src/game/core/systems/pilotActions.js';
import { ClientGuard } from '../../src/game/net/ClientGuard.js';
import { PacketError } from '../../src/game/net/codec/binary.js';
import { createControls, encodeInput } from '../../src/game/net/codec/inputPacket.js';
import { NET } from '../../src/game/net/netConfig.js';
import { MSG, parseClientMessage } from '../../src/game/net/protocol.js';

const parse = (message) => parseClientMessage(typeof message === 'string' ? message : JSON.stringify(message));
const refused = (message) => assert.throws(() => parse(message), PacketError, JSON.stringify(message));

// ---- parseClientMessage ----------------------------------------------------------------------

test('hello carries a version and a match id', () => {
    assert.deepEqual(parse({ t: 'hello', v: 1, m: 'abc' }), { t: MSG.HELLO, v: 1, m: 'abc' });
    refused({ t: 'hello', v: '1', m: 'abc' });
    refused({ t: 'hello', v: 1.5, m: 'abc' });
    refused({ t: 'hello', v: 1 });
    refused({ t: 'hello', v: 1, m: '' });
    refused({ t: 'hello', v: 1, m: 'x'.repeat(65) });
});

test('every pilot action is accepted, nothing else is', () => {
    for (const action of PILOT_ACTIONS) assert.deepEqual(parse({ t: 'action', a: action }), { t: MSG.ACTION, a: action, f: null });
    for (const action of ['pause', 'skip', 'toggleMute', 'destroyShip', '', null, 5, '__proto__', 'constructor']) refused({ t: 'action', a: action });
});

test('a line of sight is only for targetCrosshair, and is made a unit vector', () => {
    const { f } = parse({ t: 'action', a: 'targetCrosshair', f: [0, 0, -1.2] });
    assert.deepEqual(f, [0, 0, -1]);
    assert.ok(Math.abs(Math.hypot(...parse({ t: 'action', a: 'targetCrosshair', f: [0.6, 0.6, 0.6] }).f) - 1) < 1e-9);

    refused({ t: 'action', a: 'cycleTarget', f: [0, 0, -1] });
    refused({ t: 'action', a: 'targetCrosshair', f: [0, 0] });
    refused({ t: 'action', a: 'targetCrosshair', f: [0, 0, -1, 0] });
    refused({ t: 'action', a: 'targetCrosshair', f: [0, 0, 0] });
    refused({ t: 'action', a: 'targetCrosshair', f: [1e9, 0, 0] });
    refused({ t: 'action', a: 'targetCrosshair', f: ['0', 0, -1] });
    refused({ t: 'action', a: 'targetCrosshair', f: [null, 0, -1] });
    refused({ t: 'action', a: 'targetCrosshair', f: 'forward' });
});

test('ping carries a number', () => {
    assert.deepEqual(parse({ t: 'ping', n: 12.5 }), { t: MSG.PING, n: 12.5 });
    refused({ t: 'ping' });
    refused({ t: 'ping', n: '1' });
});

test('messages only a host may send are refused from a client', () => {
    for (const type of [MSG.WELCOME, MSG.BATCH, MSG.PONG, MSG.REFUSED, MSG.SUCCESSION, MSG.CHECKPOINT, 'spawn', 'match', undefined]) refused({ t: type });
});

test('a report of fitness to host is a step cost and round trips, each within bounds', () => {
    assert.deepEqual(parse({ t: 'links', c: 0.4, r: { p2: 31, p3: 120.5 } }), { t: MSG.LINKS, stepCost: 0.4, rtt: { p2: 31, p3: 120.5 } });
    assert.deepEqual(parse({ t: 'links', c: 1e9, r: { p2: 1e9 } }), { t: MSG.LINKS, stepCost: 1000, rtt: { p2: 10000 } }, 'absurd numbers are capped');
    assert.deepEqual(parse({ t: 'links', c: 0, r: {} }).rtt, {});
    for (const bad of [
        { t: 'links' }, { t: 'links', c: -1, r: {} }, { t: 'links', c: '1', r: {} }, { t: 'links', c: 1 }, { t: 'links', c: 1, r: [] },
        { t: 'links', c: 1, r: { p2: -4 } }, { t: 'links', c: 1, r: { p2: 'near' } }, { t: 'links', c: 1, r: { ['x'.repeat(65)]: 1 } },
        { t: 'links', c: 1, r: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, 1])) },
    ]) refused(bad);
});

test('pings between two devices pass without a word, and a takeover names its term and its host', () => {
    assert.deepEqual(parse({ t: 'lp', n: 5, extra: 'dropped' }), { t: MSG.LINK_PING });
    assert.deepEqual(parse({ t: 'lq', n: 5 }), { t: MSG.LINK_PONG });
    assert.deepEqual(parse({ t: 'to', n: 2, h: 'p3', more: true }), { t: MSG.TAKEOVER, n: 2, h: 'p3' });
    for (const bad of [{ t: 'to' }, { t: 'to', n: 0, h: 'p3' }, { t: 'to', n: 1.5, h: 'p3' }, { t: 'to', n: 1 }, { t: 'to', n: 1, h: '' }, { t: 'to', n: 1, h: 'x'.repeat(65) }]) refused(bad);
});

test('only the fields the host uses come through', () => {
    const parsed = parse({ t: 'action', a: 'cycleTarget', ship: 12, damage: 9999, __proto__: { admin: true } });
    assert.deepEqual(Object.keys(parsed).sort(), ['a', 'f', 't']);
});

test('anything that is not a JSON object of sensible size is refused', () => {
    refused('not json');
    refused('null');
    refused('[]');
    refused('"hello"');
    refused('42');
    refused(`{"t":"ping","n":1,"pad":"${'x'.repeat(NET.maxEventLength)}"}`);
    assert.throws(() => parseClientMessage(new ArrayBuffer(4)), PacketError);
    assert.throws(() => parseClientMessage(undefined), PacketError);
});

// ---- ClientGuard -----------------------------------------------------------------------------

function guardAt() {
    const clock = { now: 0 };
    return { guard: new ClientGuard(() => clock.now), clock };
}

const input = (seq, overrides = {}) => encodeInput(seq, { ...createControls(), ...overrides });

test('inputs are accepted in order', () => {
    const { guard } = guardAt();
    assert.equal(guard.acceptInput(input(1, { yaw: 1 })).controls.yaw, 1);
    assert.equal(guard.acceptInput(input(2)).seq, 2);
    assert.equal(guard.lastSeq, 2);
    assert.equal(guard.strikes, 0);
});

test('an input that arrives late or twice is dropped without blame', () => {
    const { guard } = guardAt();
    guard.acceptInput(input(5));

    assert.equal(guard.acceptInput(input(5)), null, 'duplicate');
    assert.equal(guard.acceptInput(input(3)), null, 'overtaken');
    assert.equal(guard.lastSeq, 5);
    assert.equal(guard.strikes, 0);
});

test('a malformed input is dropped and counted', () => {
    const { guard } = guardAt();

    assert.equal(guard.acceptInput(new ArrayBuffer(3)), null);
    assert.equal(guard.acceptInput('text'), null);
    assert.equal(guard.strikes, 2);
    assert.equal(guard.lastSeq, 0);
});

test('inputs beyond the rate budget are not flown', () => {
    const { guard, clock } = guardAt();
    let accepted = 0;
    for (let seq = 1; seq <= NET.maxInputsPerSecond + 50; seq++) if (guard.acceptInput(input(seq))) accepted += 1;
    assert.equal(accepted, NET.maxInputsPerSecond);
    assert.equal(guard.strikes, 0, 'a fast sender is throttled, not punished');

    clock.now += 1;
    assert.ok(guard.acceptInput(input(100000)), 'the budget refills every second');
});

test('messages are validated and rate limited', () => {
    const { guard, clock } = guardAt();
    assert.deepEqual(guard.acceptMessage('{"t":"ping","n":1}'), { t: MSG.PING, n: 1 });
    assert.equal(guard.acceptMessage('{"t":"spawn"}'), null);
    assert.equal(guard.strikes, 1);

    for (let i = 0; i < NET.maxEventsPerSecond; i++) guard.acceptMessage('{"t":"ping","n":1}');
    assert.equal(guard.acceptMessage('{"t":"ping","n":1}'), null, 'over budget');
    assert.ok(guard.strikes > 1, 'flooding the reliable channel counts against the client');

    clock.now += 1;
    assert.ok(guard.acceptMessage('{"t":"ping","n":1}'));
});

test('a burst of messages is one strike a second, not one a message; a flood that goes on is still banned', () => {
    const { guard, clock } = guardAt();
    // A link back after a silence delivers all that waited at once.
    for (let i = 0; i < 10 * NET.maxEventsPerSecond; i++) guard.acceptMessage('{"t":"ping","n":1}');
    assert.equal(guard.strikes, 1);
    assert.equal(guard.banned, false);

    for (let second = 1; second < NET.maxStrikes; second++) {
        clock.now += 1;
        for (let i = 0; i < 2 * NET.maxEventsPerSecond; i++) guard.acceptMessage('{"t":"ping","n":1}');
    }
    assert.equal(guard.banned, true);
});

test('a client that keeps sending rubbish is banned', () => {
    const { guard } = guardAt();
    for (let i = 0; i < NET.maxStrikes - 1; i++) guard.acceptInput(new ArrayBuffer(1));
    assert.equal(guard.banned, false);
    guard.acceptInput(new ArrayBuffer(1));
    assert.equal(guard.banned, true);
});
