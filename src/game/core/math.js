import { Vector3, Quaternion, Matrix4 } from 'three';

/**
 * Small vector helpers shared by the simulation.
 * Convention: a ship's nose points down its local -Z axis (same as a three.js camera),
 * +Y is up and +X is starboard.
 */

export const WORLD_UP = Object.freeze(new Vector3(0, 1, 0));

const ZERO = new Vector3();
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchUp = new Vector3();
const scratchVector = new Vector3();

export function forwardOf(quaternion, out) {
    return out.set(0, 0, -1).applyQuaternion(quaternion);
}

export function upOf(quaternion, out) {
    return out.set(0, 1, 0).applyQuaternion(quaternion);
}

export function rightOf(quaternion, out) {
    return out.set(1, 0, 0).applyQuaternion(quaternion);
}

/** Writes into `out` the orientation whose nose points along `direction`. */
export function lookRotation(direction, out, up = WORLD_UP) {
    scratchMatrix.lookAt(ZERO, direction, up);
    return out.setFromRotationMatrix(scratchMatrix);
}

/**
 * Rotates `quaternion` so its nose moves towards `direction`, by at most `maxAngle`.
 * The ship's current "up" is kept as the roll reference so it never snaps upright.
 * @returns {number} the angle (rad) that was left before this call.
 */
export function turnTowards(quaternion, direction, maxAngle) {
    upOf(quaternion, scratchUp);
    lookRotation(direction, scratchQuaternion, scratchUp);
    const angle = quaternion.angleTo(scratchQuaternion);
    if (angle > 1e-5) quaternion.rotateTowards(scratchQuaternion, maxAngle);
    return angle;
}

/** Moves `current` towards `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
    if (current < target) return Math.min(current + maxDelta, target);
    return Math.max(current - maxDelta, target);
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function degToRad(degrees) {
    return (degrees * Math.PI) / 180;
}

/** Deterministic pseudo random generator (mulberry32) so simulations can be replayed. */
export function createRng(seed = 1) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function randomRange(rng, min, max) {
    return min + (max - min) * rng();
}

/** Uniformly distributed unit vector. */
export function randomUnitVector(rng, out) {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(angle), r * Math.sin(angle), z);
}

/** Random unit vector at most `halfAngle` radians away from `axis` (which must be unit length). */
export function randomInCone(rng, axis, halfAngle, out) {
    randomUnitVector(rng, scratchVector);
    // Remove the component along the axis to get a random perpendicular direction.
    scratchVector.addScaledVector(axis, -scratchVector.dot(axis));
    if (scratchVector.lengthSq() < 1e-8) return out.copy(axis);
    scratchVector.normalize();
    const angle = halfAngle * Math.sqrt(rng());
    return out.copy(axis).multiplyScalar(Math.cos(angle)).addScaledVector(scratchVector, Math.sin(angle));
}
