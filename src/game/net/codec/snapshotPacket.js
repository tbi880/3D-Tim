import { Quaternion, Vector3 } from 'three';
import { POWER_MODE_ORDER } from '../../config/gameConfig.js';
import { ByteReader, ByteWriter, PacketError } from './binary.js';
import { PACKET } from './inputPacket.js';

/**
 * The packet the host sends each client many times a second: where everything is right now.
 *
 *   u8  type (PACKET.SNAPSHOT)
 *   u8  epoch           which "welcome" this belongs to: a snapshot of the place the player
 *                       has just left may still be in the air when the next place arrives
 *   u32 seq
 *   f64 time            world time of the place
 *   u32 ack             sequence number of the newest input of this client the host has flown
 *   u8  world flags     WORLD_FLAG bits
 *   u8  has own ship    0 | 1, then the client's own ship in full (OWN SHIP below)
 *   -- the rest is the same for every client --
 *   u16 ship count, then per ship:  u32 id, u8 SHIP_FLAG bits, u16 hull, u16 shield,
 *                                   and if SHIP_FLAG.POSE: vec3 position, quat16 orientation
 *   u8  beam count, then per beam:  u8 kind, u8 r, g, b, f32 width,
 *                                   u32 from id, vec3 start, u32 to id, vec3 end
 *
 * Ships that ride on another ship (turrets, generators) are sent without a pose: they sit
 * where their parent is. A beam's ends are in the axes of the ships it joins (ids not 0), so
 * a client can redraw it between the hulls as *it* shows them, a few milliseconds in the past.
 *
 * OWN SHIP is everything the client needs to correct its prediction and fill its HUD:
 *   u32 id, vec3 position, 4 x f32 orientation, vec3 velocity, vec3 angular velocity,
 *   f32 speed, throttle, boost, energy, u8 OWN_FLAG bits, u8 cannon lock, u8 power mode,
 *   u8 torpedoes, f32 torpedo reload timer, u32 target id
 */

export const SHIP_FLAG = Object.freeze({ POSE: 1, BOOSTING: 2, INVULNERABLE: 4, TARGETABLE: 8 });
const OWN_FLAG = Object.freeze({ BOOSTING: 1, BOOST_LOCKOUT: 2, BEAM_DEPLETED: 4, OUT_OF_BOUNDS: 8, BEAM_FIRING: 16 });
const WORLD_FLAG = Object.freeze({ CONTROLS_LOCKED: 1 });

export const BEAM_KINDS = Object.freeze(['beam', 'lanceCharge', 'lance', 'cannon', 'tractor']);

/** Upper bounds a decoder accepts, so a broken packet cannot ask for absurd amounts of memory. */
export const SNAPSHOT_LIMITS = Object.freeze({ ships: 1024, beams: 255 });

const scratchLocal = new Vector3();

// ---- Colours: '#rrggbb' on both ends, three bytes on the wire --------------------------------

const colorBytes = new Map();
const colorNames = new Map();

function toColorBytes(hex) {
    let bytes = colorBytes.get(hex);
    if (bytes === undefined) {
        const match = /^#([0-9a-f]{6})$/i.exec(hex);
        bytes = match ? parseInt(match[1], 16) : 0xffffff;
        colorBytes.set(hex, bytes);
    }
    return bytes;
}

function toColorName(bytes) {
    let name = colorNames.get(bytes);
    if (name === undefined) {
        name = `#${bytes.toString(16).padStart(6, '0')}`;
        colorNames.set(bytes, name);
    }
    return name;
}

// ---- Encoding (host) -------------------------------------------------------------------------

function shipFlags(ship) {
    let flags = 0;
    if (!ship.parent) flags |= SHIP_FLAG.POSE;
    if (ship.boosting) flags |= SHIP_FLAG.BOOSTING;
    if (ship.invulnerable) flags |= SHIP_FLAG.INVULNERABLE;
    if (ship.targetable) flags |= SHIP_FLAG.TARGETABLE;
    return flags;
}

function writeBeamEnd(writer, ship, point) {
    if (ship?.alive) writer.u32(ship.id).vec3(ship.worldToLocal(point, scratchLocal));
    else writer.u32(0).vec3(point);
}

/**
 * Builds snapshot packets from a World. The part that is the same for everybody is encoded
 * once per tick (`captureWorld`), then each client gets it behind its own header (`packetFor`).
 */
export class SnapshotEncoder {
    constructor() {
        this.body = new ByteWriter(4096);
        this.packet = new ByteWriter(4096);
        this.time = 0;
        this.controlsLocked = false;
    }

    /** @param {import('../../core/World.js').World} world */
    captureWorld(world) {
        const body = this.body.reset();
        this.time = world.time;
        this.controlsLocked = world.controlsLocked;

        const ships = world.ships;
        const shipCount = Math.min(ships.length, SNAPSHOT_LIMITS.ships);
        body.u16(shipCount);
        for (let i = 0; i < shipCount; i++) {
            const ship = ships[i];
            const flags = shipFlags(ship);
            body.u32(ship.id).u8(flags).unit16(ship.hullFraction).unit16(ship.shieldFraction);
            if (flags & SHIP_FLAG.POSE) body.vec3(ship.position).quat16(ship.quaternion);
        }

        const beams = world.beams;
        const beamCount = Math.min(beams.length, SNAPSHOT_LIMITS.beams);
        body.u8(beamCount);
        for (let i = 0; i < beamCount; i++) {
            const beam = beams[i];
            const color = toColorBytes(beam.color);
            body.u8(Math.max(0, BEAM_KINDS.indexOf(beam.kind)))
                .u8(color >> 16).u8((color >> 8) & 0xff).u8(color & 0xff)
                .f32(beam.width);
            writeBeamEnd(body, beam.from, beam.start);
            writeBeamEnd(body, beam.to, beam.end);
        }
    }

    /**
     * @param {number} epoch the client's current welcome number (0..255)
     * @param {number} seq
     * @param {number} ack newest input sequence number flown for this client
     * @param {import('../../core/Ship.js').Ship | null} ownShip the client's ship, if it has one
     * @returns {ArrayBuffer}
     */
    packetFor(epoch, seq, ack, ownShip) {
        const packet = this.packet.reset();
        packet.u8(PACKET.SNAPSHOT).u8(epoch & 0xff).u32(seq >>> 0).f64(this.time).u32(ack >>> 0)
            .u8(this.controlsLocked ? WORLD_FLAG.CONTROLS_LOCKED : 0);
        if (ownShip) {
            packet.u8(1);
            writeOwnShip(packet, ownShip);
        } else {
            packet.u8(0);
        }
        packet.ensure(this.body.offset);
        new Uint8Array(packet.buffer, packet.offset, this.body.offset).set(new Uint8Array(this.body.buffer, 0, this.body.offset));
        packet.offset += this.body.offset;
        return packet.toArrayBuffer();
    }
}

function writeOwnShip(writer, ship) {
    const beam = ship.weapons.find((weapon) => weapon.def.type === 'beam');
    const torpedoes = ship.weapons.find((weapon) => weapon.def.type === 'torpedo');
    let flags = 0;
    if (ship.boosting) flags |= OWN_FLAG.BOOSTING;
    if (ship.boostLockout) flags |= OWN_FLAG.BOOST_LOCKOUT;
    if (beam?.depleted) flags |= OWN_FLAG.BEAM_DEPLETED;
    if (ship.outOfBounds) flags |= OWN_FLAG.OUT_OF_BOUNDS;
    if (ship.beamFiring) flags |= OWN_FLAG.BEAM_FIRING;
    const { quaternion } = ship;
    writer.u32(ship.id)
        .vec3(ship.position)
        .f32(quaternion.x).f32(quaternion.y).f32(quaternion.z).f32(quaternion.w)
        .vec3(ship.velocity)
        .vec3(ship.angularVelocity)
        .f32(ship.speed).f32(ship.throttle).f32(ship.boost).f32(ship.energy)
        .u8(flags)
        .u8(ship.cannonLock)
        .u8(Math.max(0, POWER_MODE_ORDER.indexOf(ship.powerMode)))
        .u8(Math.max(0, Math.min(255, torpedoes?.ammo ?? 0)))
        .f32(torpedoes?.reloadTimer ?? 0)
        .u32(ship.target?.alive && !ship.target.isProjectile ? ship.target.id : 0);
}

// ---- Decoding (client) -----------------------------------------------------------------------

/** Floats per ship pose in `Snapshot.poses`: x, y, z, then the quaternion x, y, z, w. */
export const POSE_STRIDE = 7;

const scratchQuaternion = new Quaternion();

function readOwnShip(reader) {
    const own = {
        id: reader.u32(),
        position: reader.vec3(new Vector3()),
        quaternion: new Quaternion(reader.f32(), reader.f32(), reader.f32(), reader.f32()),
        velocity: reader.vec3(new Vector3()),
        angularVelocity: reader.vec3(new Vector3()),
        speed: reader.f32(),
        throttle: reader.f32(),
        boost: reader.f32(),
        energy: reader.f32(),
    };
    if (own.quaternion.lengthSq() < 1e-6) throw new PacketError('invalid rotation');
    own.quaternion.normalize();
    const flags = reader.u8();
    own.boosting = Boolean(flags & OWN_FLAG.BOOSTING);
    own.boostLockout = Boolean(flags & OWN_FLAG.BOOST_LOCKOUT);
    own.beamDepleted = Boolean(flags & OWN_FLAG.BEAM_DEPLETED);
    own.outOfBounds = Boolean(flags & OWN_FLAG.OUT_OF_BOUNDS);
    own.beamFiring = Boolean(flags & OWN_FLAG.BEAM_FIRING);
    own.cannonLock = Math.min(2, reader.u8());
    own.powerMode = POWER_MODE_ORDER[reader.u8()] ?? POWER_MODE_ORDER[0];
    own.torpedoes = reader.u8();
    own.torpedoReload = reader.f32();
    own.targetId = reader.u32();
    return own;
}

function readBeamEnd(reader) {
    return { shipId: reader.u32(), point: reader.vec3(new Vector3()) };
}

/**
 * @param {ArrayBuffer | ArrayBufferView} data
 * @returns {{
 *   epoch: number, seq: number, time: number, ack: number, controlsLocked: boolean, own: object | null,
 *   count: number, ids: Uint32Array, flags: Uint8Array, hull: Float32Array, shield: Float32Array,
 *   poses: Float32Array, indexOf: Map<number, number>,
 *   beams: { kind: string, color: string, width: number, from: { shipId: number, point: Vector3 }, to: { shipId: number, point: Vector3 } }[],
 * }}
 * @throws {PacketError} if the packet is malformed
 */
export function decodeSnapshot(data) {
    const reader = new ByteReader(data);
    if (reader.u8() !== PACKET.SNAPSHOT) throw new PacketError('not a snapshot');
    const epoch = reader.u8();
    const seq = reader.u32();
    const time = reader.f64();
    const ack = reader.u32();
    const worldFlags = reader.u8();
    const own = reader.u8() ? readOwnShip(reader) : null;

    const count = reader.u16();
    if (count > SNAPSHOT_LIMITS.ships) throw new PacketError('too many ships');
    const ids = new Uint32Array(count);
    const flags = new Uint8Array(count);
    const hull = new Float32Array(count);
    const shield = new Float32Array(count);
    const poses = new Float32Array(count * POSE_STRIDE);
    const indexOf = new Map();
    for (let i = 0; i < count; i++) {
        ids[i] = reader.u32();
        flags[i] = reader.u8();
        hull[i] = reader.unit16();
        shield[i] = reader.unit16();
        indexOf.set(ids[i], i);
        if (!(flags[i] & SHIP_FLAG.POSE)) continue;
        const at = i * POSE_STRIDE;
        poses[at] = reader.f32();
        poses[at + 1] = reader.f32();
        poses[at + 2] = reader.f32();
        reader.quat16(scratchQuaternion);
        poses[at + 3] = scratchQuaternion.x;
        poses[at + 4] = scratchQuaternion.y;
        poses[at + 5] = scratchQuaternion.z;
        poses[at + 6] = scratchQuaternion.w;
    }

    const beamCount = reader.u8();
    const beams = new Array(beamCount);
    for (let i = 0; i < beamCount; i++) {
        const kind = BEAM_KINDS[reader.u8()] ?? BEAM_KINDS[0];
        const color = toColorName((reader.u8() << 16) | (reader.u8() << 8) | reader.u8());
        const width = reader.f32();
        beams[i] = { kind, color, width, from: readBeamEnd(reader), to: readBeamEnd(reader) };
    }
    reader.end();

    return {
        epoch, seq, time, ack, controlsLocked: Boolean(worldFlags & WORLD_FLAG.CONTROLS_LOCKED), own,
        count, ids, flags, hull, shield, poses, indexOf, beams,
    };
}
