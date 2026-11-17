import { Vector3 } from 'three';
import { ABILITY_PHASE } from '../../config/abilities.js';
import { FACTION } from '../../config/gameConfig.js';
import { GAME_EVENTS } from '../EventBus.js';
import { applyDamage, areHostile, destroyProjectile, stripShield } from './damage.js';
import { damageObstacle } from './obstacles.js';

const scratchDesired = new Vector3();
const scratchDirection = new Vector3();
const scratchMidpoint = new Vector3();
const scratchNearest = new Vector3();

function steerTorpedo(torpedo, dt) {
    const target = torpedo.target;
    if (!target) return;
    // A target that is gone, or has cloaked, is lost for good: the torpedo flies on as it was heading.
    if (!target.alive || target.cloaked) {
        torpedo.target = null;
        return;
    }
    scratchDesired.copy(target.position).sub(torpedo.position).normalize();
    scratchDirection.copy(torpedo.velocity).normalize();
    const angle = scratchDirection.angleTo(scratchDesired);
    const maxTurn = torpedo.def.turnRate * dt;
    if (angle <= maxTurn) scratchDirection.copy(scratchDesired);
    else scratchDirection.lerp(scratchDesired, maxTurn / angle).normalize();
    torpedo.velocity.copy(scratchDirection).multiplyScalar(torpedo.speed);
}

function hitShip(world, projectile, ship) {
    const def = projectile.def;
    applyDamage(world, ship, def.damage * projectile.damageScale, {
        source: projectile.owner,
        weapon: def,
        point: projectile.position,
        shieldMult: def.shieldMult ?? 1,
        hullMult: def.hullMult ?? 1,
    });
    endProjectile(world, projectile);
}

/** A shot that has hit something or run out of fuel: a breach warhead goes off, anything else is simply gone. */
function endProjectile(world, projectile) {
    if (projectile.def.breach) detonateBreach(world, projectile);
    else destroyProjectile(world, projectile, projectile.kind === 'torpedo');
}

/**
 * Sets off a breach warhead where it is (`breach` in config/weapons.js): every ship within its
 * radius - hostile to it, or the one it was locked on; its own side too if `hitsAllies` - loses
 * its shield for a while. Called when it lands, when its fuel is gone, and when its pilot says so.
 */
export function detonateBreach(world, torpedo) {
    if (!torpedo.alive) return;
    const { breach } = torpedo.def;
    for (const ship of world.ships) {
        if (!ship.alive || ship.arriving) continue;
        if (!breach.hitsAllies && ship !== torpedo.target && !areHostile(torpedo, ship)) continue;
        if (ship.distanceToPoint(torpedo.position) > breach.radius) continue;
        stripShield(world, ship, breach.shieldDownSeconds, {
            source: torpedo.owner, weapon: torpedo.def, point: ship.closestPoint(torpedo.position, scratchNearest),
        });
    }
    const position = torpedo.position.clone();
    destroyProjectile(world, torpedo, true);
    world.events.emit(GAME_EVENTS.ABILITY, { ship: torpedo.owner, ability: breach.ability, phase: ABILITY_PHASE.BLAST, position, radius: breach.radius });
}

/** Tests the projectile's position and the midpoint of its last step, so fast bolts do not tunnel. */
function findHit(world, projectile) {
    scratchMidpoint.copy(projectile.position).add(projectile.previousPosition).multiplyScalar(0.5);
    for (const ship of world.ships) {
        // A cloaked ship cannot be fired on: shots pass it by.
        if (!ship.alive || ship.arriving || ship.cloaked || ship === projectile.owner) continue;
        // Shots hit enemies, and are also stopped by neutral scenery (wrecks, buoys). A torpedo
        // also hits what it was locked on, whoever that is (multiplayer friendly fire).
        if (!areHostile(projectile, ship) && ship.faction !== FACTION.NEUTRAL && ship !== projectile.target) continue;
        const reach = projectile.radius;
        if (ship.distanceToPoint(projectile.position) <= reach || ship.distanceToPoint(scratchMidpoint) <= reach) {
            return ship;
        }
    }
    return null;
}

function findObstacleHit(world, projectile) {
    for (const obstacle of world.obstacles) {
        if (!obstacle.alive) continue;
        const reach = obstacle.radius + projectile.radius;
        if (obstacle.position.distanceToSquared(projectile.position) <= reach * reach) return obstacle;
    }
    return null;
}

/**
 * Flies one shot for `dt` seconds: burns fuel, homes (torpedoes) and moves. No hit testing.
 * @returns {boolean} false once its fuel has run out (it did not move)
 */
export function flyProjectile(projectile, dt) {
    projectile.life -= dt;
    if (projectile.life <= 0) return false;
    if (projectile.kind === 'torpedo') steerTorpedo(projectile, dt);
    projectile.previousPosition.copy(projectile.position);
    projectile.position.addScaledVector(projectile.velocity, dt);
    return true;
}

export function updateProjectiles(world, dt) {
    for (const projectile of world.projectiles) {
        if (!projectile.alive) continue;
        if (!flyProjectile(projectile, dt)) {
            endProjectile(world, projectile);
            continue;
        }

        const ship = findHit(world, projectile);
        if (ship) {
            hitShip(world, projectile, ship);
            continue;
        }
        const obstacle = findObstacleHit(world, projectile);
        if (obstacle) {
            damageObstacle(world, obstacle, projectile.def.damage * projectile.damageScale, projectile.position);
            endProjectile(world, projectile);
        }
    }
}
