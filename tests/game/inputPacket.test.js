import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter, PacketError } from '../../src/game/net/codec/binary.js';
import { INPUT_PACKET_SIZE, PACKET, createControls, decodeInput, encodeInput, quantizeControls } from '../../src/game/net/codec/inputPacket.js';

const held = (overrides = {}) => ({ ...createControls(), ...overrides });

test('an input packet is eleven bytes', () => {
    assert.equal(encodeInput(1, held()).byteLength, INPUT_PACKET_SIZE);
    assert.equal(INPUT_PACKET_SIZE, 11);
});

test('controls come back as sent, to within the stick precision', () => {
    const controls = held({ yaw: 0.5, pitch: -1, roll: 0.25, throttle: 1, boost: true, firePrimary: false, fireSecondary: true });
    const decoded = decodeInput(encodeInput(42, controls, true));

    assert.equal(decoded.seq, 42);
    assert.equal(decoded.autoFire, true);
    assert.ok(Math.abs(decoded.controls.yaw - 0.5) < 1 / 127);
    assert.equal(decoded.controls.pitch, -1);
    assert.ok(Math.abs(decoded.controls.roll - 0.25) < 1 / 127);
    assert.equal(decoded.controls.throttle, 1);
    assert.equal(decoded.controls.throttleTarget, null);
    assert.deepEqual([decoded.controls.boost, decoded.controls.firePrimary, decoded.controls.fireSecondary], [true, false, true]);
});

test('the touch throttle travels as a 0..1 setting, the keyboard as none', () => {
    assert.equal(decodeInput(encodeInput(1, held({ throttleTarget: 0 }))).controls.throttleTarget, 0);
    assert.equal(decodeInput(encodeInput(1, held({ throttleTarget: 1 }))).controls.throttleTarget, 1);
    assert.ok(Math.abs(decodeInput(encodeInput(1, held({ throttleTarget: 0.4 }))).controls.throttleTarget - 0.4) < 1 / 254);
    assert.equal(decodeInput(encodeInput(1, held({ throttleTarget: null }))).controls.throttleTarget, null);
});

test('whatever a client puts in, the stick stays inside -1..1', () => {
    const wild = held({ yaw: 50, pitch: -50, roll: NaN, throttle: Infinity, throttleTarget: 9 });
    const { controls } = decodeInput(encodeInput(1, wild));

    assert.equal(controls.yaw, 1);
    assert.equal(controls.pitch, -1);
    assert.equal(controls.roll, 0);
    assert.equal(controls.throttle, 0);
    assert.equal(controls.throttleTarget, 1);
});

test('even a hand-made packet cannot push an axis past full deflection', () => {
    const packet = new ByteWriter().u8(PACKET.INPUT).u32(1).i8(-128).i8(127).i8(0).i8(0).u8(255).u8(0).toArrayBuffer();
    const { controls } = decodeInput(packet);

    assert.equal(controls.yaw, -1);
    assert.equal(controls.pitch, 1);
});

test('sequence numbers use the full 32 bits', () => {
    assert.equal(decodeInput(encodeInput(4294967295, held())).seq, 4294967295);
});

test('packets of the wrong size, type or with unknown buttons are refused', () => {
    const good = new Uint8Array(encodeInput(1, held()));
    assert.throws(() => decodeInput(good.slice(0, 10).buffer), PacketError, 'too short');
    assert.throws(() => decodeInput(new Uint8Array([...good, 0]).buffer), PacketError, 'too long');
    assert.throws(() => decodeInput(new ArrayBuffer(0)), PacketError, 'empty');

    const wrongType = good.slice();
    wrongType[0] = PACKET.SNAPSHOT;
    assert.throws(() => decodeInput(wrongType.buffer), PacketError, 'wrong type');

    const unknownButton = good.slice();
    unknownButton[10] = 0x80;
    assert.throws(() => decodeInput(unknownButton.buffer), PacketError, 'unknown button');
});

test('decoding fills the controls object it is given', () => {
    const out = createControls();
    const result = decodeInput(encodeInput(3, held({ yaw: 1 })), out);
    assert.equal(result.controls, out);
    assert.equal(out.yaw, 1);
});

test('quantizeControls gives exactly what the host will decode', () => {
    const controls = held({ yaw: 0.123456, pitch: -0.98765, roll: 0.5, throttle: -0.3333, throttleTarget: 0.777, boost: 1, firePrimary: 0, fireSecondary: 'yes' });
    const quantized = quantizeControls(controls);
    const decoded = decodeInput(encodeInput(1, controls)).controls;

    assert.deepEqual(quantized, decoded);
});
