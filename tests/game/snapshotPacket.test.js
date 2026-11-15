import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { World } from '../../src/game/core/World.js';
import { ByteWriter, PacketError } from '../../src/game/net/codec/binary.js';
import { PACKET } from '../../src/game/net/codec/inputPacket.js';
import { POSE_STRIDE, SHIP_FLAG, SNAPSHOT_LIMITS, SnapshotEncoder, decodeSnapshot } from '../../src/game/net/codec/snapshotPacket.js';

function worldWithShips() {
    const world = new World();
    world.setSector('cinder');
    const player = world.spawnShip('kestrel', { position: [10, 20, 30], facing: [1, 0, 0], pilotId: 'ann' });
    const drone = world.spawnShip('drone', { position: [-500.5, 0, 250], facing: [0, 0, 1] });
    const warden = world.spawnShip('warden', { position: [0, 1000, -4000] });
    const turret = world.spawnShip('stationTurret', { parent: warden, mountOffset: [0, 50, 0] });
    return { world, player, drone, warden, turret };
}

function roundTrip(world, ownShip = null, seq = 1, ack = 0, epoch = 0) {
    const encoder = new SnapshotEncoder();
    encoder.captureWorld(world);
    return decodeSnapshot(encoder.packetFor(epoch, seq, ack, ownShip));
}

function poseOf(snapshot, id) {
    const at = snapshot.indexOf.get(id) * POSE_STRIDE;
    const { poses } = snapshot;
    return { position: new Vector3(poses[at], poses[at + 1], poses[at + 2]), rotation: new Quaternion(poses[at + 3], poses[at + 4], poses[at + 5], poses[at + 6]) };
}

test('header: epoch, sequence, time, acknowledged input and the helm lock', () => {
    const { world } = worldWithShips();
    world.time = 1234.5678;
    world.controlsLocked = true;

    const snapshot = roundTrip(world, null, 77, 4000000000, 9);

    assert.equal(snapshot.epoch, 9);
    assert.equal(snapshot.seq, 77);
    assert.equal(snapshot.time, 1234.5678);
    assert.equal(snapshot.ack, 4000000000);
    assert.equal(snapshot.controlsLocked, true);
    assert.equal(snapshot.own, null);
});

test('every ship is there with its pose, hull and shield', () => {
    const { world, player, drone } = worldWithShips();
    drone.hull = drone.maxHull * 0.25;
    player.shield = player.maxShield * 0.5;

    const snapshot = roundTrip(world);

    assert.equal(snapshot.count, 4);
    assert.deepEqual([...snapshot.ids], world.ships.map((ship) => ship.id));
    const pose = poseOf(snapshot, drone.id);
    assert.ok(pose.position.distanceTo(drone.position) < 1e-3);
    assert.ok(pose.rotation.angleTo(drone.quaternion) < 1e-3);
    assert.ok(Math.abs(snapshot.hull[snapshot.indexOf.get(drone.id)] - 0.25) < 1e-4);
    assert.ok(Math.abs(snapshot.shield[snapshot.indexOf.get(player.id)] - 0.5) < 1e-4);
});

test('flags carry boosting, invulnerable and targetable', () => {
    const { world, player, drone } = worldWithShips();
    player.boosting = true;
    drone.invulnerable = true;
    drone.targetable = false;

    const snapshot = roundTrip(world);
    const flagsOf = (ship) => snapshot.flags[snapshot.indexOf.get(ship.id)];

    assert.ok(flagsOf(player) & SHIP_FLAG.BOOSTING);
    assert.ok(flagsOf(player) & SHIP_FLAG.TARGETABLE);
    assert.ok(flagsOf(drone) & SHIP_FLAG.INVULNERABLE);
    assert.equal(flagsOf(drone) & SHIP_FLAG.TARGETABLE, 0);
});

test('ships mounted on another ship are sent without a pose', () => {
    const { world, warden, turret } = worldWithShips();

    const snapshot = roundTrip(world);

    assert.ok(snapshot.flags[snapshot.indexOf.get(warden.id)] & SHIP_FLAG.POSE);
    assert.equal(snapshot.flags[snapshot.indexOf.get(turret.id)] & SHIP_FLAG.POSE, 0);
});

test('the player\'s own ship comes back in full', () => {
    const { world, player, drone } = worldWithShips();
    player.velocity.set(1, -2, 3);
    player.angularVelocity.set(0.1, 0.2, -0.3);
    player.speed = 140;
    player.throttle = 0.75;
    player.boost = 0.4;
    player.boosting = true;
    player.boostLockout = true;
    player.energy = 62.5;
    player.cannonLock = 2;
    player.powerMode = 'defense';
    player.outOfBounds = true;
    player.beamFiring = true;
    player.target = drone;
    const torpedoes = player.weapons.find((weapon) => weapon.def.type === 'torpedo');
    torpedoes.ammo = 3;
    torpedoes.reloadTimer = 1.25;
    player.weapons.find((weapon) => weapon.def.type === 'beam').depleted = true;

    const { own } = roundTrip(world, player);

    assert.equal(own.id, player.id);
    assert.ok(own.position.distanceTo(player.position) < 1e-4);
    assert.ok(own.quaternion.angleTo(player.quaternion) < 1e-6, 'full precision: prediction is corrected against this');
    assert.deepEqual(own.velocity.toArray(), [1, -2, 3]);
    assert.ok(own.angularVelocity.distanceTo(player.angularVelocity) < 1e-6);
    assert.equal(own.speed, 140);
    assert.equal(own.throttle, 0.75);
    assert.ok(Math.abs(own.boost - 0.4) < 1e-6);
    assert.equal(own.energy, 62.5);
    assert.deepEqual([own.boosting, own.boostLockout, own.beamDepleted, own.outOfBounds, own.beamFiring], [true, true, true, true, true]);
    assert.equal(own.cannonLock, 2);
    assert.equal(own.powerMode, 'defense');
    assert.equal(own.torpedoes, 3);
    assert.equal(own.torpedoReload, 1.25);
    assert.equal(own.targetId, drone.id);
});

test('no target, or a target that is gone, is sent as none', () => {
    const { world, player, drone } = worldWithShips();
    assert.equal(roundTrip(world, player).own.targetId, 0);
    player.target = drone;
    drone.alive = false;
    assert.equal(roundTrip(world, player).own.targetId, 0);
});

test('beams are pinned to the ships they join', () => {
    const { world, player, drone } = worldWithShips();
    const muzzle = player.position.clone().add(new Vector3(0, 0, -5).applyQuaternion(player.quaternion));
    world.addBeam(muzzle, drone.position, '#59c8ff', 0.34, 'beam', player, drone);
    world.addBeam(new Vector3(1, 2, 3), new Vector3(4, 5, 6), '#ff3355', 5, 'lance');

    const { beams } = roundTrip(world);

    assert.equal(beams.length, 2);
    const [pinned, free] = beams;
    assert.equal(pinned.kind, 'beam');
    assert.equal(pinned.color, '#59c8ff');
    assert.ok(Math.abs(pinned.width - 0.34) < 1e-6);
    assert.equal(pinned.from.shipId, player.id);
    assert.ok(pinned.from.point.distanceTo(new Vector3(0, 0, -5)) < 1e-3, 'start is in the firing ship\'s own axes');
    assert.equal(pinned.to.shipId, drone.id);
    assert.ok(pinned.to.point.length() < 1e-3, 'end is at the target\'s centre, in its axes');
    assert.equal(free.kind, 'lance');
    assert.equal(free.color, '#ff3355');
    assert.equal(free.from.shipId, 0);
    assert.deepEqual(free.from.point.toArray(), [1, 2, 3]);
    assert.deepEqual(free.to.point.toArray(), [4, 5, 6]);
});

test('one capture serves every client, each with its own header', () => {
    const { world, player } = worldWithShips();
    const encoder = new SnapshotEncoder();
    encoder.captureWorld(world);

    const forAnn = decodeSnapshot(encoder.packetFor(1, 5, 100, player));
    const forBo = decodeSnapshot(encoder.packetFor(2, 9, 200, null));

    assert.deepEqual([forAnn.epoch, forAnn.seq, forAnn.ack, forAnn.own?.id], [1, 5, 100, player.id]);
    assert.deepEqual([forBo.epoch, forBo.seq, forBo.ack, forBo.own], [2, 9, 200, null]);
    assert.deepEqual([...forAnn.ids], [...forBo.ids]);
});

test('an empty world is a valid snapshot', () => {
    const snapshot = roundTrip(new World());
    assert.equal(snapshot.count, 0);
    assert.equal(snapshot.beams.length, 0);
});

test('a snapshot of a full battle stays small', () => {
    const world = new World();
    world.setSector('cinder');
    for (let i = 0; i < 48; i++) world.spawnShip('drone', { position: [i * 10, 0, 0] });
    const encoder = new SnapshotEncoder();
    encoder.captureWorld(world);

    const bytes = encoder.packetFor(0, 1, 0, world.spawnShip('kestrel')).byteLength;

    assert.ok(bytes < 1700, `48 ships in ${bytes} bytes`);
});

test('truncated, padded or mistyped packets are refused', () => {
    const { world, player } = worldWithShips();
    const encoder = new SnapshotEncoder();
    encoder.captureWorld(world);
    const good = new Uint8Array(encoder.packetFor(0, 1, 0, player));

    for (const cut of [0, 1, 10, good.length - 1]) {
        assert.throws(() => decodeSnapshot(good.slice(0, cut).buffer), PacketError, `cut to ${cut} bytes`);
    }
    assert.throws(() => decodeSnapshot(new Uint8Array([...good, 0]).buffer), PacketError, 'one byte too many');
    const mistyped = good.slice();
    mistyped[0] = PACKET.INPUT;
    assert.throws(() => decodeSnapshot(mistyped.buffer), PacketError);
    assert.throws(() => decodeSnapshot('not binary'), PacketError);
});

test('a packet that claims too many ships is refused before any memory is set aside', () => {
    const packet = new ByteWriter().u8(PACKET.SNAPSHOT).u8(0).u32(1).f64(0).u32(0).u8(0).u8(0).u16(SNAPSHOT_LIMITS.ships + 1).toArrayBuffer();
    assert.throws(() => decodeSnapshot(packet), /too many ships/);
});

test('a packet with a NaN position is refused', () => {
    const packet = new ByteWriter().u8(PACKET.SNAPSHOT).u8(0).u32(1).f64(0).u32(0).u8(0).u8(0)
        .u16(1).u32(5).u8(SHIP_FLAG.POSE).u16(0).u16(0).f32(NaN).f32(0).f32(0).i16(0).i16(0).i16(0).i16(32767)
        .u8(0).toArrayBuffer();
    assert.throws(() => decodeSnapshot(packet), PacketError);
});
