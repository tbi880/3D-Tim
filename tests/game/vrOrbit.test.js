import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { ORBIT, createOrbit, orbitQuaternion, recentreOrbit, resetOrbit, stepOrbit } from '../../src/game/xr/vrOrbit.js';

/** Where the VR chase seat sits and looks for a ship at the origin (as scene/PlayerCamera.jsx placeVRSeat). */
function seat(ship, orbit) {
    const rig = orbitQuaternion(ship, orbit, new Quaternion());
    const position = new Vector3(0, 8.5, 40).applyQuaternion(rig);
    const target = new Vector3(0, 0, -140).applyQuaternion(rig);
    return { position, look: target.sub(position).normalize() };
}

test('straight behind is the chase seat as it always was', () => {
    const ship = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
    const { position } = seat(ship, createOrbit());
    assert.ok(position.distanceTo(new Vector3(0, 8.5, 40).applyQuaternion(ship)) < 1e-9);
});

test('swung round, the camera goes round the ship and keeps it in view', () => {
    const ship = new Quaternion();
    // Half a turn: in front of the ship, looking back at it.
    const front = seat(ship, { yaw: Math.PI, pitch: 0 });
    assert.ok(front.position.z < -30, 'in front (the ship flies towards -z)');
    assert.ok(front.look.z > 0.9, 'looking back along the ship');
    // A quarter turn the view-turns-right way: off the ship's left side, looking at it.
    const side = seat(ship, { yaw: -Math.PI / 2, pitch: 0 });
    assert.ok(side.position.x < -30, 'stick right takes the camera round to the left');
    for (const orbit of [{ yaw: 0, pitch: ORBIT.maxPitch }, { yaw: 2, pitch: -ORBIT.maxPitch }, { yaw: -2.5, pitch: 0.6 }]) {
        const { position, look } = seat(ship, orbit);
        const toShip = position.clone().negate().normalize();
        assert.ok(look.dot(toShip) > 0.9, `the ship stays near the middle of the view (${JSON.stringify(orbit)})`);
    }
});

test('the swing back goes the short way round and ends exactly behind', () => {
    const orbit = createOrbit();
    // Most of a turn to the left is a little to the right.
    stepOrbit(orbit, { x: -1, y: 0 }, 3.5);
    assert.ok(Math.abs(orbit.yaw) <= Math.PI);
    const start = orbit.yaw;
    recentreOrbit(orbit);
    stepOrbit(orbit, null, 0.05);
    assert.ok(Math.abs(orbit.yaw) < Math.abs(start) && Math.sign(orbit.yaw) === Math.sign(start));
    for (let i = 0; i < 100; i++) stepOrbit(orbit, null, 1 / 72);
    assert.deepEqual(orbit, createOrbit());

    // Moving the stick during the swing back stops it there.
    stepOrbit(orbit, { x: 1, y: 1 }, 0.5);
    recentreOrbit(orbit);
    stepOrbit(orbit, null, 0.05);
    stepOrbit(orbit, { x: 0, y: 1 }, 0.05);
    assert.equal(orbit.returning, false);
    const held = { ...orbit };
    stepOrbit(orbit, null, 1);
    assert.deepEqual(orbit, held);
    resetOrbit(orbit);
    assert.deepEqual(orbit, createOrbit());
});
