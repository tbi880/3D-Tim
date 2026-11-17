import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { createRng, randomUnitVector } from '../../src/game/core/math.js';
import { Ship } from '../../src/game/core/Ship.js';

/**
 * The hull as the simulation sees it (core/Ship.js): spheres for small craft, boxes that turn
 * with the ship for everything larger. Every hit, ram, avoidance and turret decision is one of
 * these questions.
 */

function shipOf(classId, { position = [0, 0, 0], quaternion = null } = {}) {
    const ship = new Ship(classId, SHIP_CLASSES[classId]);
    ship.position.fromArray(position);
    if (quaternion) ship.quaternion.copy(quaternion);
    return ship;
}

/** Every class with boxes, turned some way, somewhere off the origin. */
function boxedShips() {
    const rng = createRng(7);
    const axis = new Vector3();
    return Object.keys(SHIP_CLASSES)
        .filter((classId) => SHIP_CLASSES[classId].hitBoxes || SHIP_CLASSES[classId].halfExtents)
        .map((classId) => shipOf(classId, {
            position: [rng() * 4000 - 2000, rng() * 4000 - 2000, rng() * 4000 - 2000],
            quaternion: new Quaternion().setFromAxisAngle(randomUnitVector(rng, axis), rng() * Math.PI * 2),
        }));
}

test('a small craft is a sphere: distance to its skin, closest point on it, a ray through it', () => {
    const fighter = shipOf('drone', { position: [100, 0, 0] });
    const radius = fighter.radius;
    assert.equal(fighter.boxes, null);
    assert.equal(fighter.distanceToPoint(new Vector3(100, 50, 0)), 50 - radius);
    assert.equal(fighter.distanceToPoint(new Vector3(100, 0, 0)), -radius);
    const closest = fighter.closestPoint(new Vector3(100, 0, 80), new Vector3());
    assert.ok(closest.distanceTo(new Vector3(100, 0, radius)) < 1e-9);
    // Inside, the closest point is the point itself.
    assert.ok(fighter.closestPoint(new Vector3(100, 0, radius / 2), new Vector3()).equals(new Vector3(100, 0, radius / 2)));
    assert.ok(Math.abs(fighter.raycast(new Vector3(0, 0, 0), new Vector3(1, 0, 0)) - (100 - radius)) < 1e-9);
    assert.equal(fighter.raycast(new Vector3(0, 0, 0), new Vector3(-1, 0, 0)), Infinity);
    assert.equal(fighter.raycast(new Vector3(100, 0, 0), new Vector3(0, 1, 0)), 0, 'a ray from inside starts on the hull');
});

test('a boxed hull: a point off one face is that far away, one inside is negative', () => {
    const harrier = shipOf('harrier');
    const half = harrier.halfExtents;
    assert.ok(harrier.boxes.length >= 1);
    assert.ok(harrier.boundingRadius >= half.length() - 1e-9);
    // Straight above the ship's middle the nearest hull is whichever box reaches highest there.
    const above = harrier.distanceToPoint(new Vector3(0, half.y + 40, 0));
    assert.ok(above <= 40 + 1e-9 && above > 0);
    assert.ok(harrier.distanceToPoint(harrier.position) < 0);
});

test('the hull turns with the ship', () => {
    const level = shipOf('harrier');
    const turned = shipOf('harrier', { quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2) });
    // The nose (-Z) now points along -X: a point ahead of the nose is as far from the turned ship as the same point turned is from the level one.
    const ahead = new Vector3(0, 0, -(level.halfLength + 100));
    const aheadTurned = ahead.clone().applyQuaternion(turned.quaternion);
    assert.ok(Math.abs(level.distanceToPoint(ahead) - turned.distanceToPoint(aheadTurned)) < 1e-6);
    // The hull's nose is its longest box's end: 100 m beyond the furthest-reaching part, at most 100 m from the hull.
    assert.ok(level.distanceToPoint(ahead) >= 100 - 1e-6);
    // ...and side on, the same point is somewhere else entirely.
    assert.ok(Math.abs(turned.distanceToPoint(ahead) - level.distanceToPoint(ahead)) > 1);
});

test('closestPoint lands on the hull and is as far away as distanceToPoint says', () => {
    const rng = createRng(11);
    const direction = new Vector3();
    const point = new Vector3();
    const closest = new Vector3();
    for (const ship of boxedShips()) {
        for (let i = 0; i < 40; i++) {
            point.copy(ship.position).addScaledVector(randomUnitVector(rng, direction), ship.boundingRadius * (0.2 + rng() * 2));
            const distance = ship.distanceToPoint(point);
            ship.closestPoint(point, closest);
            if (distance > 0) {
                assert.ok(Math.abs(closest.distanceTo(point) - distance) < 1e-6, `${ship.classId}: ${closest.distanceTo(point)} vs ${distance}`);
                assert.ok(Math.abs(ship.distanceToPoint(closest)) < 1e-6, `${ship.classId}: closest point off the hull`);
            } else {
                assert.ok(closest.distanceTo(point) < 1e-6, `${ship.classId}: inside, the closest point is the point`);
            }
        }
    }
});

test('a ray meets the hull where distanceToPoint says the surface is', () => {
    const rng = createRng(5);
    const direction = new Vector3();
    const origin = new Vector3();
    const towards = new Vector3();
    const entry = new Vector3();
    for (const ship of boxedShips()) {
        // Aimed at the middle of one of its boxes (a ring station has nothing at its own centre).
        const aim = ship.boxes[0].centre.clone().applyQuaternion(ship.quaternion).add(ship.position);
        origin.copy(aim).addScaledVector(randomUnitVector(rng, direction), ship.boundingRadius * 3);
        towards.copy(aim).sub(origin).normalize();
        const along = ship.raycast(origin, towards);
        assert.ok(Number.isFinite(along), `${ship.classId}: a ray at a box's middle missed`);
        entry.copy(origin).addScaledVector(towards, along);
        assert.ok(Math.abs(ship.distanceToPoint(entry)) < 1e-6, `${ship.classId}: the ray entered ${ship.distanceToPoint(entry)} m off the hull`);
        towards.negate();
        assert.equal(ship.raycast(origin, towards), Infinity, `${ship.classId}: a ray pointing away hit`);
    }
});

test('with a limit, distanceToPoint answers every "within the limit?" question as the exact distance does', () => {
    const rng = createRng(3);
    const direction = new Vector3();
    const point = new Vector3();
    let shortcuts = 0;
    for (const ship of boxedShips()) {
        for (let i = 0; i < 300; i++) {
            point.copy(ship.position).addScaledVector(randomUnitVector(rng, direction), ship.boundingRadius * rng() * 3);
            const exact = ship.distanceToPoint(point);
            // Limits around the exact distance, the bounding sphere and far from both.
            for (const limit of [exact, exact - 0.001, exact + 0.001, exact * 0.5, exact * 2, 0, -5, 30, 1000]) {
                const bounded = ship.distanceToPoint(point, limit);
                assert.equal(bounded <= limit, exact <= limit, `${ship.classId}: <= ${limit}`);
                assert.equal(bounded < limit, exact < limit, `${ship.classId}: < ${limit}`);
                assert.ok(bounded <= exact + 1e-9, `${ship.classId}: the shortcut overstated the distance`);
                if (bounded !== exact) {
                    shortcuts++;
                    assert.ok(bounded > limit, `${ship.classId}: a shortcut not beyond its limit`);
                }
            }
        }
    }
    assert.ok(shortcuts > 1000, `the shortcut was hardly ever taken (${shortcuts})`);
});

test('with a limit, a point within reach still gets its exact distance', () => {
    const harrier = shipOf('harrier', { position: [500, 0, 0] });
    const point = new Vector3(500, harrier.halfExtents.y + 20, 0);
    assert.equal(harrier.distanceToPoint(point, 50), harrier.distanceToPoint(point));
    // Far beyond the limit the answer is only "further than that".
    const far = new Vector3(500, 10000, 0);
    assert.ok(harrier.distanceToPoint(far, 50) > 50);
    assert.ok(harrier.distanceToPoint(far, 50) <= harrier.distanceToPoint(far));
});
