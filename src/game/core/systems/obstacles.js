import { Vector3 } from 'three';
import { WORLD } from '../../config/gameConfig.js';
import { GAME_EVENTS } from '../EventBus.js';
import { createRng, randomRange, randomUnitVector } from '../math.js';

/**
 * Asteroids ("obstacles"): drifting rocks that block shots, hurt to fly into, and can be
 * blasted apart. Big rocks break into smaller ones; small ones turn to dust.
 */

const scratchOffset = new Vector3();
const scratchDirection = new Vector3();

/** Hit points per unit of radius: a 10 m rock takes about a second of beam fire. */
const HP_PER_RADIUS = 3.2;
/** Rocks at least this big split into fragments instead of vanishing. */
const SPLIT_MIN_RADIUS = 22;
const FRAGMENT_DRAG = 0.6;
let nextObstacleId = 1;

export function createObstacle(position, radius, seed, velocity = null) {
    return {
        id: nextObstacleId++,
        position,
        radius,
        seed,
        hp: radius * HP_PER_RADIUS,
        velocity: velocity ?? new Vector3(),
        alive: true,
        hitEffectTimer: 0,
    };
}

/** Scatters asteroid spheres through a box, deterministically from the sector's seed. */
export function generateAsteroids(config) {
    if (!config) return [];
    const rng = createRng(config.seed);
    const clearings = config.clearings ?? [];
    const asteroids = [];
    for (let i = 0; i < config.count; i++) {
        const position = new Vector3(
            config.centre[0] + randomRange(rng, -1, 1) * config.spread[0],
            config.centre[1] + randomRange(rng, -1, 1) * config.spread[1],
            config.centre[2] + randomRange(rng, -1, 1) * config.spread[2],
        );
        // Squaring biases the field towards small rocks with a few big ones.
        const radius = config.minRadius + (config.maxRadius - config.minRadius) * rng() ** 2;
        const seed = rng();
        const blocked = clearings.some(([x, y, z, clearRadius]) => position.distanceTo(scratchOffset.set(x, y, z)) < clearRadius + radius);
        if (!blocked) asteroids.push(createObstacle(position, radius, seed));
    }
    return asteroids;
}

function destroyObstacle(world, obstacle) {
    obstacle.alive = false;
    world.events.emit(GAME_EVENTS.OBSTACLE_DESTROYED, { position: obstacle.position.clone(), radius: obstacle.radius });
    if (obstacle.radius < SPLIT_MIN_RADIUS) return;
    // Break into two or three chunks that drift apart.
    const pieces = obstacle.radius > 45 ? 3 : 2;
    for (let i = 0; i < pieces; i++) {
        randomUnitVector(world.rng, scratchDirection);
        const radius = obstacle.radius * randomRange(world.rng, 0.38, 0.52);
        const position = obstacle.position.clone().addScaledVector(scratchDirection, obstacle.radius * 0.5);
        const velocity = scratchDirection.clone().multiplyScalar(randomRange(world.rng, 14, 30));
        world.obstacles.push(createObstacle(position, radius, world.rng(), velocity));
    }
}

/**
 * @param {boolean} continuous true for per-frame beam damage (rate-limits the hit effect)
 */
export function damageObstacle(world, obstacle, amount, point, continuous = false) {
    if (!obstacle.alive) return;
    obstacle.hp -= amount;
    if (!continuous || world.time >= obstacle.hitEffectTimer) {
        obstacle.hitEffectTimer = world.time + WORLD.beamHitEffectInterval;
        world.events.emit(GAME_EVENTS.HIT, { target: null, position: point ?? obstacle.position, shield: false, amount });
    }
    if (obstacle.hp <= 0) destroyObstacle(world, obstacle);
}

/** Nearest asteroid a ray (unit `direction`) hits within `maxDistance`, as `{ obstacle, distance }` or null. */
export function raycastObstacles(world, origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) continue;
        scratchOffset.copy(obstacle.position).sub(origin);
        const along = scratchOffset.dot(direction);
        if (along < 0 || along - obstacle.radius > bestDistance) continue;
        const offAxisSq = scratchOffset.lengthSq() - along * along;
        const radiusSq = obstacle.radius * obstacle.radius;
        if (offAxisSq > radiusSq) continue;
        const entry = along - Math.sqrt(radiusSq - offAxisSq);
        if (entry < bestDistance) {
            bestDistance = Math.max(0, entry);
            best = obstacle;
        }
    }
    return best ? { obstacle: best, distance: bestDistance } : null;
}

/** Fragments drift and slow down; destroyed rocks are dropped from the list. */
export function updateObstacles(world, dt) {
    let anyDestroyed = false;
    const drag = Math.exp(-FRAGMENT_DRAG * dt);
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) {
            anyDestroyed = true;
            continue;
        }
        if (obstacle.velocity.lengthSq() < 0.01) continue;
        obstacle.position.addScaledVector(obstacle.velocity, dt);
        obstacle.velocity.multiplyScalar(drag);
    }
    if (anyDestroyed) world.obstacles = world.obstacles.filter((obstacle) => obstacle.alive);
}
