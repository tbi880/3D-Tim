import { Vector3 } from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { applyDamage, areHostile, destroyProjectile } from './damage.js';
import { damageObstacle } from './obstacles.js';

const scratchDesired = new Vector3();
const scratchDirection = new Vector3();
const scratchMidpoint = new Vector3();

function steerTorpedo(torpedo, dt) {
    const target = torpedo.target;
    if (!target || !target.alive) return;
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
        point: projectile.position,
        shieldMult: def.shieldMult ?? 1,
        hullMult: def.hullMult ?? 1,
    });
    destroyProjectile(world, projectile, projectile.kind === 'torpedo');
}

/** Tests the projectile's position and the midpoint of its last step, so fast bolts do not tunnel. */
function findHit(world, projectile) {
    scratchMidpoint.copy(projectile.position).add(projectile.previousPosition).multiplyScalar(0.5);
    for (const ship of world.ships) {
        if (!ship.alive || ship.arriving) continue;
        // Shots hit enemies, and are also stopped by neutral scenery (wrecks, buoys).
        if (!areHostile(projectile, ship) && ship.faction !== FACTION.NEUTRAL) continue;
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

export function updateProjectiles(world, dt) {
    for (const projectile of world.projectiles) {
        if (!projectile.alive) continue;
        projectile.life -= dt;
        if (projectile.life <= 0) {
            destroyProjectile(world, projectile, projectile.kind === 'torpedo');
            continue;
        }
        if (projectile.kind === 'torpedo') steerTorpedo(projectile, dt);
        projectile.previousPosition.copy(projectile.position);
        projectile.position.addScaledVector(projectile.velocity, dt);

        const ship = findHit(world, projectile);
        if (ship) {
            hitShip(world, projectile, ship);
            continue;
        }
        const obstacle = findObstacleHit(world, projectile);
        if (obstacle) {
            damageObstacle(world, obstacle, projectile.def.damage * projectile.damageScale, projectile.position);
            destroyProjectile(world, projectile, projectile.kind === 'torpedo');
        }
    }
}
