import { Vector3 } from 'three';
import { WORLD } from '../../config/gameConfig.js';
import { approach, forwardOf, randomRange, randomUnitVector, turnTowards, upOf } from '../math.js';
import { areHostile } from './damage.js';
import { isValidTarget } from './targeting.js';

/**
 * AI pilots. Each behaviour is a tiny state machine that only decides two things:
 * "which way do I want to point" and "do I want to fire"; steering and weapons are
 * handled by shared helpers so every ship type moves by the same rules.
 */

const scratchToTarget = new Vector3();
const scratchDesired = new Vector3();
const scratchForward = new Vector3();
const scratchUp = new Vector3();
const scratchAxisPoint = new Vector3();
const scratchAway = new Vector3();
const scratchRandom = new Vector3();

const DEFAULT_PREFERENCES = ['fighter', 'capital'];
/** How far from a capital hull small craft start steering away (world units). */
const AVOID_MARGIN = 110;
/** Ship kinds that small craft steer around. */
const SOLID_KINDS = new Set(['capital', 'station', 'object']);
/** Bolt speed assumed when leading a target (close enough for every fighter weapon). */
const LEAD_SPEED = 640;

function targetKindFor(ship, other) {
    const prefers = ship.cls.ai?.prefers ?? DEFAULT_PREFERENCES;
    if (other.isPlayer && prefers.includes('player')) return 'player';
    if (other.cls.behavior === 'bomber' && prefers.includes('bomber')) return 'bomber';
    return other.cls.kind;
}

/** Scores every hostile by distance and class preference and returns the best one. */
function chooseTarget(world, ship) {
    const ai = ship.ai;
    if (ai.forcedTargetTag) {
        const forced = world.findByTag(ai.forcedTargetTag);
        if (isValidTarget(forced)) return forced;
    }
    const prefers = ship.cls.ai?.prefers ?? DEFAULT_PREFERENCES;
    let best = null;
    let bestScore = Infinity;
    for (const other of world.ships) {
        if (!isValidTarget(other) || !areHostile(ship, other)) continue;
        // Modules and shielded hulls are the player's job; AI gunners ignore them.
        if (other.cls.kind === 'module' || other.invulnerable) continue;
        let rank = prefers.indexOf(targetKindFor(ship, other));
        if (rank < 0) rank = prefers.length + 1;
        const distance = ship.position.distanceTo(other.position);
        // A ship on guard leaves alone whatever keeps its distance - unless it has been shot at.
        if (distance > ai.engageRange && ship.lastAttacker !== other) continue;
        // A stable per-pair jitter spreads a squadron over several targets.
        const jitter = 0.75 + (((ship.id * 31 + other.id * 17) % 10) / 10) * 0.5;
        const score = distance * (1 + rank * 0.8) * jitter;
        if (score < bestScore) {
            bestScore = score;
            best = other;
        }
    }
    return best;
}

function refreshTarget(world, ship, dt) {
    const ai = ship.ai;
    ai.retargetTimer -= dt;
    if (ai.retargetTimer > 0 && isValidTarget(ship.target) && !ship.target.invulnerable) return;
    ship.target = chooseTarget(world, ship);
    ai.retargetTimer = randomRange(world.rng, 2, 4);
}

/**
 * Bends `desired` away from capital hulls and asteroids that are too close. (The push is
 * about one unit long: give it a `desired` of about that length for it to matter.)
 */
export function avoidObstacles(world, ship, desired) {
    for (const other of world.ships) {
        if (other === ship || !other.alive || other.arriving || !SOLID_KINDS.has(other.cls.kind)) continue;
        const margin = AVOID_MARGIN + ship.boundingRadius;
        const distance = other.distanceToPoint(ship.position, margin);
        if (distance > margin) continue;
        other.closestPoint(ship.position, scratchAxisPoint);
        scratchAway.copy(ship.position).sub(scratchAxisPoint).normalize();
        desired.addScaledVector(scratchAway, (1 - Math.max(0, distance) / margin) * 3);
    }
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) continue;
        const margin = obstacle.radius + 50;
        const distanceSq = obstacle.position.distanceToSquared(ship.position);
        if (distanceSq > margin * margin) continue;
        scratchAway.copy(ship.position).sub(obstacle.position).normalize();
        desired.addScaledVector(scratchAway, 2);
    }
    // Keep the fight inside the sector.
    const fromCentre = ship.position.length();
    if (fromCentre > WORLD.arenaRadius) desired.addScaledVector(ship.position, -2 / fromCentre);
}

/** Turns towards `desired` and flies forward at `throttle` (0..1) of top speed. */
function steer(world, ship, desired, throttle, dt) {
    avoidObstacles(world, ship, desired);
    if (desired.lengthSq() > 1e-6) turnTowards(ship.quaternion, desired.normalize(), ship.cls.turnRate * dt);
    ship.speed = approach(ship.speed, ship.cls.maxSpeed * throttle, ship.cls.acceleration * dt);
    forwardOf(ship.quaternion, ship.velocity).multiplyScalar(ship.speed);
}

function coast(ship, dt) {
    ship.speed = approach(ship.speed, 0, (ship.cls.acceleration || 10) * dt);
    forwardOf(ship.quaternion, ship.velocity).multiplyScalar(ship.speed);
}

function pickBreakDirection(world, ship, target) {
    const ai = ship.ai;
    forwardOf(ship.quaternion, scratchForward);
    randomUnitVector(world.rng, scratchRandom);
    ai.breakDirection.copy(ship.position).sub(target.position).normalize().multiplyScalar(0.35)
        .addScaledVector(scratchRandom, 0.9)
        .addScaledVector(scratchForward, 0.7)
        .normalize();
}

// ---- Behaviours -------------------------------------------------------------------------

/** Attack run until too close, break away for a few seconds, come back around. */
function updateFighter(world, ship, dt) {
    const ai = ship.ai;
    const target = ship.target;
    ai.wantsFire = false;
    if (!target) {
        coast(ship, dt);
        return;
    }
    const config = ship.cls.ai;
    scratchToTarget.copy(target.position).sub(ship.position);
    const distance = target.distanceToPoint(ship.position);
    ai.stateTimer -= dt;

    if (ai.state === 'break') {
        if (ai.stateTimer <= 0 || distance > 3200) ai.state = 'attack';
        steer(world, ship, scratchDesired.copy(ai.breakDirection), 1, dt);
        return;
    }

    if (distance < config.breakDistance) {
        ai.state = 'break';
        ai.stateTimer = randomRange(world.rng, 1.8, 3.4);
        pickBreakDirection(world, ship, target);
        return;
    }

    // Aim ahead of a moving target.
    const leadTime = Math.min(2, distance / LEAD_SPEED);
    scratchDesired.copy(target.position).addScaledVector(target.velocity, leadTime).sub(ship.position);
    forwardOf(ship.quaternion, scratchForward);
    const aimError = scratchForward.angleTo(scratchDesired);
    ai.wantsFire = distance < config.attackRange && aimError < 0.16;
    steer(world, ship, scratchDesired, 1, dt);
}

/** Close on a capital ship, launch a torpedo, run, repeat. */
function updateBomber(world, ship, dt) {
    const ai = ship.ai;
    const target = ship.target;
    ai.wantsFire = false;
    if (!target) {
        coast(ship, dt);
        return;
    }
    scratchToTarget.copy(target.position).sub(ship.position);
    ai.stateTimer -= dt;

    if (ai.state === 'retreat') {
        if (ai.stateTimer <= 0) ai.state = 'attack';
        steer(world, ship, scratchDesired.copy(ai.breakDirection), 1, dt);
        return;
    }

    if (ai.firedThisFrame) {
        ai.firedThisFrame = false;
        ai.state = 'retreat';
        ai.stateTimer = ship.cls.ai.retreatTime * randomRange(world.rng, 0.8, 1.2);
        pickBreakDirection(world, ship, target);
        ai.breakDirection.addScaledVector(scratchToTarget.normalize(), -1).normalize();
        return;
    }
    ai.wantsFire = true;
    steer(world, ship, scratchDesired.copy(scratchToTarget), 1, dt);
}

/** Close to stand-off range, then circle the target presenting a broadside. */
function updateCapital(world, ship, dt) {
    const ai = ship.ai;
    const target = ship.target;
    if (ai.mode === 'hold' || ship.cls.maxSpeed <= 0 || !target) {
        coast(ship, dt);
        return;
    }
    const standoff = ship.cls.ai?.standoff ?? 700;
    scratchToTarget.copy(target.position).sub(ship.position);
    const distance = scratchToTarget.length();
    scratchToTarget.multiplyScalar(1 / Math.max(distance, 1e-3));

    if (distance > standoff * 1.2) {
        steer(world, ship, scratchDesired.copy(scratchToTarget), 1, dt);
        return;
    }
    upOf(ship.quaternion, scratchUp);
    scratchDesired.crossVectors(scratchToTarget, scratchUp);
    if (scratchDesired.lengthSq() < 1e-4) scratchDesired.set(1, 0, 0);
    scratchDesired.normalize();
    if (distance < standoff * 0.7) scratchDesired.addScaledVector(scratchToTarget, -0.6);
    steer(world, ship, scratchDesired, 0.55, dt);
}

/** Leaving the battle: fly straight out and vanish when the timer expires. */
function updateFleeing(world, ship, dt) {
    ship.ai.wantsFire = false;
    scratchDesired.copy(ship.position);
    if (scratchDesired.lengthSq() < 1) forwardOf(ship.quaternion, scratchDesired);
    steer(world, ship, scratchDesired, 1, dt);
}

export function updateAI(world, ship, dt) {
    const behavior = ship.cls.behavior;
    if (behavior === 'module' || behavior === 'static' || ship.arriving) return;
    if (ship.ai.mode === 'flee') {
        updateFleeing(world, ship, dt);
        return;
    }
    refreshTarget(world, ship, dt);
    switch (behavior) {
        case 'fighter': updateFighter(world, ship, dt); break;
        case 'bomber': updateBomber(world, ship, dt); break;
        case 'capital': updateCapital(world, ship, dt); break;
        default: break;
    }
}
