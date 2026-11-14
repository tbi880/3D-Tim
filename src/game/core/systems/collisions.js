import { Vector3 } from 'three';
import { GAME_EVENTS } from '../EventBus.js';
import { clamp } from '../math.js';
import { applyDamage } from './damage.js';
import { damageObstacle } from './obstacles.js';

const scratchCentre = new Vector3();
const scratchNormal = new Vector3();
const scratchOwn = new Vector3();

const COLLISION_DAMAGE_COOLDOWN = 0.6;
/** Damage from ramming an asteroid at cruise speed: a base amount plus some per metre of rock, capped. */
const ROCK_DAMAGE_BASE = 8;
const ROCK_DAMAGE_PER_METRE = 1.3;
const ROCK_DAMAGE_MAX = 95;
/** Hull points lost per unit of closing speed (clamped), so a scrape stings but rarely kills. */
const COLLISION_DAMAGE_PER_SPEED = 0.11;
const SOLID_KINDS = new Set(['capital', 'station', 'module', 'object']);

/** World position of one of the player's collision spheres (see Ship.collisionSpheres). */
function sphereCentre(player, sphere, out) {
    return out.copy(sphere.centre).applyQuaternion(player.quaternion).add(player.position);
}

/**
 * Pushes the player out of a solid sphere centred on `centre` and scrapes some hull off.
 * `own` is the player's collision sphere doing the touching, already in world space.
 */
function bounce(world, player, own, ownRadius, centre, solidRadius) {
    scratchNormal.copy(own).sub(centre);
    const distance = scratchNormal.length();
    const overlap = solidRadius + ownRadius - distance;
    if (overlap <= 0) return false;
    if (distance < 1e-3) scratchNormal.set(0, 1, 0);
    else scratchNormal.multiplyScalar(1 / distance);

    player.position.addScaledVector(scratchNormal, overlap);
    const closingSpeed = -player.velocity.dot(scratchNormal);
    if (closingSpeed <= 0) return true;

    player.velocity.addScaledVector(scratchNormal, closingSpeed * 1.4);
    player.speed *= 0.5;
    if (world.time < player.collisionReadyAt) return true;
    player.collisionReadyAt = world.time + COLLISION_DAMAGE_COOLDOWN;
    applyDamage(world, player, clamp(closingSpeed * COLLISION_DAMAGE_PER_SPEED, 3, 18), { point: own });
    world.events.emit(GAME_EVENTS.PLAYER_COLLISION, { speed: closingSpeed });
    return true;
}

/**
 * Only the player collides with hulls and rocks; AI pilots steer around them instead.
 * The player's hull is its collision spheres: one for small craft, a row along the
 * hit boxes for long ones (the Bulwark), so the hull bumps where the model does.
 */
export function resolvePlayerCollisions(world) {
    const player = world.player;
    if (!player?.alive) return;
    player.collisionReadyAt ??= 0;

    for (const ship of world.ships) {
        if (ship === player || !ship.alive || ship.arriving || !SOLID_KINDS.has(ship.cls.kind)) continue;
        if (ship.distanceToPoint(player.position) > player.boundingRadius) continue;
        for (const sphere of player.collisionSpheres) {
            sphereCentre(player, sphere, scratchOwn);
            if (ship.distanceToPoint(scratchOwn) > sphere.radius) continue;
            ship.closestPoint(scratchOwn, scratchCentre);
            // Deep inside a hull the closest point is the sphere's own centre: push out from the ship's centre instead.
            if (scratchCentre.distanceToSquared(scratchOwn) < 1e-6) scratchCentre.copy(ship.position);
            if (bounce(world, player, scratchOwn, sphere.radius, scratchCentre, 0)) break;
        }
    }
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) continue;
        const outer = obstacle.radius + player.boundingRadius;
        if (obstacle.position.distanceToSquared(player.position) > outer * outer) continue;
        const touching = player.collisionSpheres.some((sphere) => {
            const reach = obstacle.radius + sphere.radius;
            return sphereCentre(player, sphere, scratchOwn).distanceToSquared(obstacle.position) <= reach * reach;
        });
        if (!touching) continue;
        // The rock shatters on impact and the ship pays for it: more for a bigger rock, more at speed.
        const speedFactor = 0.45 + 0.55 * Math.min(1.5, player.velocity.length() / Math.max(1, player.cls.maxSpeed));
        damageObstacle(world, obstacle, Infinity, obstacle.position);
        applyDamage(world, player, clamp(ROCK_DAMAGE_BASE + obstacle.radius * ROCK_DAMAGE_PER_METRE, 0, ROCK_DAMAGE_MAX) * speedFactor, {
            point: obstacle.position,
        });
        world.events.emit(GAME_EVENTS.PLAYER_COLLISION, { speed: player.speed });
    }
}
