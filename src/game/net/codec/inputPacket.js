import { ByteReader, ByteWriter, PacketError } from './binary.js';

/**
 * The packet a client sends the host every frame: what its pilot is holding right now.
 * Twelve bytes. It carries no position, speed or damage - the host works those out itself -
 * so there is nothing in it to lie about except the stick, and the stick cannot leave -1..1
 * because of how it is stored.
 *
 *   u8  type (PACKET.INPUT)
 *   u32 seq             counts up; the host ignores anything not newer than what it has
 *   i8  yaw, pitch, roll, throttle     -127..127 = -1..1
 *   u8  throttleTarget  0..254 = 0..1, 255 = none (keyboard throttle)
 *   u8  buttons         BUTTON bits
 */

export const PACKET = Object.freeze({ SNAPSHOT: 1, INPUT: 2 });

export const INPUT_PACKET_SIZE = 11;

const BUTTON = Object.freeze({ BOOST: 1, FIRE_PRIMARY: 2, FIRE_SECONDARY: 4 });
const BUTTON_MASK = BUTTON.BOOST | BUTTON.FIRE_PRIMARY | BUTTON.FIRE_SECONDARY;
const NO_THROTTLE_TARGET = 255;

const toAxis = (value) => Math.round(Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)) * 127);
const fromAxis = (value) => Math.max(-127, value) / 127;

const writer = new ByteWriter(INPUT_PACKET_SIZE);

/** A fresh held-controls object (the shape of IDLE_CONTROLS in core/systems/playerFlight.js). */
export function createControls() {
    return { yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false };
}

/**
 * @param {number} seq
 * @param {object} controls held controls
 * @returns {ArrayBuffer}
 */
export function encodeInput(seq, controls) {
    const target = controls.throttleTarget;
    let buttons = 0;
    if (controls.boost) buttons |= BUTTON.BOOST;
    if (controls.firePrimary) buttons |= BUTTON.FIRE_PRIMARY;
    if (controls.fireSecondary) buttons |= BUTTON.FIRE_SECONDARY;
    return writer.reset()
        .u8(PACKET.INPUT)
        .u32(seq >>> 0)
        .i8(toAxis(controls.yaw)).i8(toAxis(controls.pitch)).i8(toAxis(controls.roll)).i8(toAxis(controls.throttle))
        .u8(target == null || !Number.isFinite(target) ? NO_THROTTLE_TARGET : Math.round(Math.max(0, Math.min(1, target)) * 254))
        .u8(buttons)
        .toArrayBuffer();
}

/**
 * @param {ArrayBuffer | ArrayBufferView} data
 * @param {object} [out] controls object to fill (see createControls)
 * @returns {{ seq: number, controls: object }}
 * @throws {PacketError} if the packet is not exactly a well-formed input packet
 */
export function decodeInput(data, out = createControls()) {
    const reader = new ByteReader(data);
    if (reader.remaining !== INPUT_PACKET_SIZE) throw new PacketError('wrong input packet size');
    if (reader.u8() !== PACKET.INPUT) throw new PacketError('not an input packet');
    const seq = reader.u32();
    out.yaw = fromAxis(reader.i8());
    out.pitch = fromAxis(reader.i8());
    out.roll = fromAxis(reader.i8());
    out.throttle = fromAxis(reader.i8());
    const target = reader.u8();
    out.throttleTarget = target === NO_THROTTLE_TARGET ? null : target / 254;
    const buttons = reader.u8();
    if (buttons & ~BUTTON_MASK) throw new PacketError('unknown button bits');
    out.boost = Boolean(buttons & BUTTON.BOOST);
    out.firePrimary = Boolean(buttons & BUTTON.FIRE_PRIMARY);
    out.fireSecondary = Boolean(buttons & BUTTON.FIRE_SECONDARY);
    return { seq, controls: out };
}

/**
 * Rounds controls to exactly what the host will read out of the packet, so a client that
 * predicts its own ship flies it with the same numbers as the host.
 */
export function quantizeControls(controls, out = createControls()) {
    out.yaw = fromAxis(toAxis(controls.yaw));
    out.pitch = fromAxis(toAxis(controls.pitch));
    out.roll = fromAxis(toAxis(controls.roll));
    out.throttle = fromAxis(toAxis(controls.throttle));
    const target = controls.throttleTarget;
    out.throttleTarget = target == null || !Number.isFinite(target) ? null : Math.round(Math.max(0, Math.min(1, target)) * 254) / 254;
    out.boost = Boolean(controls.boost);
    out.firePrimary = Boolean(controls.firePrimary);
    out.fireSecondary = Boolean(controls.fireSecondary);
    return out;
}
