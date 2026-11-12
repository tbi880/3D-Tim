import { Vector3 } from 'three';
import { TARGETING } from '../../config/gameConfig.js';
import { degToRad, forwardOf } from '../math.js';
import { areHostile } from './damage.js';

const scratchForward = new Vector3();
const scratchToTarget = new Vector3();
const scratchRayPoint = new Vector3();

export function isValidTarget(target) {
    return Boolean(target && target.alive && target.targetable !== false && !target.arriving);
}

/**
 * The point on a target that a gunner looking along `forward` from `origin` would aim at.
 * For small targets this is their centre; for capital ships it is the point of the hull
 * nearest to the line of sight, so "aiming at the stern" works.
 */
export function aimPointOn(target, origin, forward, out) {
    if (target.isProjectile || !target.halfExtents) return out.copy(target.position);
    const along = Math.max(0, scratchToTarget.copy(target.position).sub(origin).dot(forward));
    scratchRayPoint.copy(origin).addScaledVector(forward, along);
    return target.closestPoint(scratchRayPoint, out);
}

/**
 * Angle (rad) between `forward` and the nearest edge of the target as seen from `origin`.
 * 0 means the line of sight passes through the target.
 */
export function angleOffAxis(target, origin, forward, aimPoint) {
    scratchToTarget.copy(aimPoint).sub(origin);
    const distance = scratchToTarget.length();
    if (distance < 1e-3) return 0;
    const angle = Math.acos(Math.min(1, Math.max(-1, scratchToTarget.dot(forward) / distance)));
    // Box hulls already return an aim point on the hull itself, so they need no extra allowance.
    const angularRadius = target.halfExtents ? 0 : Math.atan2(target.radius, distance);
    return Math.max(0, angle - angularRadius);
}

/** Hostile ships the player is allowed to lock, nearest first. */
export function getLockCandidates(world) {
    const player = world.player;
    if (!player) return [];
    const candidates = [];
    for (const ship of world.ships) {
        if (!isValidTarget(ship) || !areHostile(player, ship)) continue;
        const distance = ship.position.distanceTo(player.position);
        if (distance > TARGETING.lockRange) continue;
        candidates.push({ ship, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.map((entry) => entry.ship);
}

/** The hostile ship closest to the crosshair, or null if none is inside the cone. */
export function findTargetNearCrosshair(world, coneDeg = TARGETING.crosshairConeDeg) {
    const player = world.player;
    if (!player) return null;
    forwardOf(player.quaternion, scratchForward);
    const maxAngle = degToRad(coneDeg);
    const aimPoint = new Vector3();
    let best = null;
    let bestAngle = maxAngle;
    for (const ship of getLockCandidates(world)) {
        aimPointOn(ship, player.position, scratchForward, aimPoint);
        const angle = angleOffAxis(ship, player.position, scratchForward, aimPoint);
        if (angle < bestAngle) {
            bestAngle = angle;
            best = ship;
        }
    }
    return best;
}

export function findNearestHostile(world, ship, filter = null) {
    let best = null;
    let bestDistance = Infinity;
    for (const other of world.ships) {
        if (!isValidTarget(other) || !areHostile(ship, other)) continue;
        if (filter && !filter(other)) continue;
        const distance = other.position.distanceToSquared(ship.position);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = other;
        }
    }
    return best;
}
