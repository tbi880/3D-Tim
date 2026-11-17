import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import {
    approach, clamp, createRng, forwardOf, lookRotation, randomInCone, randomRange, randomUnitVector, rightOf, turnTowards, upOf,
} from '../../src/game/core/math.js';

/** The vector helpers the simulation is built on (core/math.js). A ship's nose is its local -Z. */

const near = (a, b, epsilon = 1e-9) => Math.abs(a - b) < epsilon;

test('the random generator replays the same numbers from the same seed', () => {
    const take = (rng, n) => Array.from({ length: n }, () => rng());
    assert.deepEqual(take(createRng(42), 20), take(createRng(42), 20));
    assert.notDeepEqual(take(createRng(42), 20), take(createRng(43), 20));
    const values = take(createRng(1), 10000);
    assert.ok(values.every((value) => value >= 0 && value < 1));
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(near(mean, 0.5, 0.02), `mean ${mean}`);
    const rng = createRng(5);
    for (let i = 0; i < 100; i++) {
        const value = randomRange(rng, -3, 7);
        assert.ok(value >= -3 && value < 7);
    }
});

test('approach moves towards a target without overshooting it', () => {
    assert.equal(approach(0, 10, 3), 3);
    assert.equal(approach(9, 10, 3), 10);
    assert.equal(approach(10, 0, 3), 7);
    assert.equal(approach(1, 0, 3), 0);
    assert.equal(approach(5, 5, 3), 5);
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('an unturned ship faces -Z with +Y up and +X to starboard', () => {
    const level = new Quaternion();
    assert.ok(forwardOf(level, new Vector3()).equals(new Vector3(0, 0, -1)));
    assert.ok(upOf(level, new Vector3()).equals(new Vector3(0, 1, 0)));
    assert.ok(rightOf(level, new Vector3()).equals(new Vector3(1, 0, 0)));
});

test('lookRotation points the nose along a direction', () => {
    for (const direction of [new Vector3(1, 0, 0), new Vector3(0.3, 0.5, -1).normalize(), new Vector3(0, -0.2, 1).normalize()]) {
        const forward = forwardOf(lookRotation(direction, new Quaternion()), new Vector3());
        assert.ok(forward.distanceTo(direction) < 1e-9, `${direction.toArray()}`);
    }
});

test('turnTowards turns at most the angle it is given and gets there in the end', () => {
    const quaternion = new Quaternion();
    const target = new Vector3(1, 0, 0);
    assert.ok(near(turnTowards(quaternion, target, 0.1), Math.PI / 2, 1e-6), 'reports the angle that was left before the turn');
    assert.ok(near(forwardOf(quaternion, new Vector3()).angleTo(target), Math.PI / 2 - 0.1, 1e-6), 'turned by its limit');
    for (let i = 0; i < 20; i++) turnTowards(quaternion, target, 0.1);
    assert.ok(forwardOf(quaternion, new Vector3()).angleTo(target) < 1e-4);
    assert.ok(turnTowards(quaternion, target, 0.1) < 1e-4, 'nothing left to turn');
});

test('turnTowards keeps a banked ship banked instead of snapping it upright', () => {
    const banked = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
    for (let i = 0; i < 40; i++) turnTowards(banked, new Vector3(0.3, 0.1, -1).normalize(), 0.02);
    const up = upOf(banked, new Vector3());
    // Upright would put "up" straight along +Y; banked it keeps leaning to the side.
    assert.ok(up.angleTo(new Vector3(0, 1, 0)) > 0.3, `${up.toArray()}`);
});

test('random directions are unit length, and the ones in a cone stay inside it', () => {
    const rng = createRng(9);
    const axis = new Vector3(0.2, -0.4, 0.9).normalize();
    const out = new Vector3();
    let widest = 0;
    for (let i = 0; i < 2000; i++) {
        assert.ok(near(randomUnitVector(rng, out).length(), 1, 1e-9));
        const inCone = randomInCone(rng, axis, 0.3, out);
        assert.ok(near(inCone.length(), 1, 1e-9));
        widest = Math.max(widest, inCone.angleTo(axis));
    }
    assert.ok(widest <= 0.3 + 1e-9, `${widest}`);
    assert.ok(widest > 0.25, 'and fill it out to the edge');
    assert.ok(randomInCone(rng, axis, 0, out).distanceTo(axis) < 1e-9, 'a cone of no width is the axis');
});
