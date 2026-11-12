import { Vector3 } from 'three';
import { GAME_EVENTS } from '../EventBus.js';
import { clamp } from '../math.js';
import { applyDamage } from './damage.js';
import { damageObstacle } from './obstacles.js';

const scratchCentre = new Vector3();
const scratchNormal = new Vector3();

const COLLISION_DAMAGE_COOLDOWN = 0.6;
/** Asteroids up to this radius shatter when rammed instead of stopping the ship. */
const SHATTER_RADIUS = 13;
/** Hull points lost per unit of closing speed (clamped), so a scrape stings but rarely kills. */
const COLLISION_DAMAGE_PER_SPEED = 0.11;
const SOLID_KINDS = new Set(['capital', 'station', 'module', 'object']);

/** Pushes the player out of a solid sphere centred on `centre` and scrapes some hull off. */
function bounce(world, player, centre, solidRadius) {
    scratchNormal.copy(player.position).sub(centre);
    const distance = scratchNormal.length();
    const overlap = solidRadius + player.radius - distance;
    if (overlap <= 0) return;
    if (distance < 1e-3) scratchNormal.set(0, 1, 0);
    else scratchNormal.multiplyScalar(1 / distance);

    player.position.addScaledVector(scratchNormal, overlap);
    const closingSpeed = -player.velocity.dot(scratchNormal);
    if (closingSpeed <= 0) return;

    player.velocity.addScaledVector(scratchNormal, closingSpeed * 1.4);
    player.speed *= 0.5;
    if (world.time < player.collisionReadyAt) return;
    player.collisionReadyAt = world.time + COLLISION_DAMAGE_COOLDOWN;
    applyDamage(world, player, clamp(closingSpeed * COLLISION_DAMAGE_PER_SPEED, 3, 18), { point: player.position });
    world.events.emit(GAME_EVENTS.PLAYER_COLLISION, { speed: closingSpeed });
}

/** Only the player collides with hulls and rocks; AI pilots steer around them instead. */
export function resolvePlayerCollisions(world) {
    const player = world.player;
    if (!player?.alive) return;
    player.collisionReadyAt ??= 0;

    for (const ship of world.ships) {
        if (ship === player || !ship.alive || ship.arriving || !SOLID_KINDS.has(ship.cls.kind)) continue;
        if (ship.distanceToPoint(player.position) > player.radius) continue;
        ship.closestPoint(player.position, scratchCentre);
        // Deep inside a hull the closest point is the player's own position: push out from the centre line instead.
        if (scratchCentre.distanceToSquared(player.position) < 1e-6) scratchCentre.copy(ship.position);
        bounce(world, player, scratchCentre, 0);
    }
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) continue;
        const reach = obstacle.radius + player.radius;
        if (obstacle.position.distanceToSquared(player.position) > reach * reach) continue;
        if (obstacle.radius <= SHATTER_RADIUS) {
            // Small rocks lose the argument: the ship ploughs through them at a price.
            damageObstacle(world, obstacle, Infinity, obstacle.position);
            applyDamage(world, player, obstacle.radius * 0.6, { point: obstacle.position });
            world.events.emit(GAME_EVENTS.PLAYER_COLLISION, { speed: player.speed });
        } else {
            bounce(world, player, obstacle.position, obstacle.radius);
        }
    }
}
