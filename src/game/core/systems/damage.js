import { FACTION, POWER_MODES, WORLD } from '../../config/gameConfig.js';
import { GAME_EVENTS } from '../EventBus.js';

/** Two things fight each other when they belong to different, non-neutral factions. */
export function areHostile(a, b) {
    return a.faction !== b.faction && a.faction !== FACTION.NEUTRAL && b.faction !== FACTION.NEUTRAL;
}

function emitHit(world, target, position, shieldHit, amount, continuous) {
    // Continuous beams would emit an effect every frame; rate-limit them per target.
    if (continuous) {
        if (world.time < target.hitEffectTimer) return;
        target.hitEffectTimer = world.time + WORLD.beamHitEffectInterval;
    }
    world.events.emit(GAME_EVENTS.HIT, { target, position, shield: shieldHit, amount });
}

export function destroyProjectile(world, projectile, withExplosion) {
    if (!projectile.alive) return;
    projectile.alive = false;
    if (withExplosion) {
        world.events.emit(GAME_EVENTS.EXPLOSION, {
            position: projectile.position.clone(),
            size: projectile.kind === 'torpedo' ? 16 : 3,
            color: projectile.color,
        });
    }
}

export function destroyShip(world, ship, killer = null) {
    if (!ship.alive) return;
    ship.alive = false;
    ship.hull = 0;
    ship.shield = 0;
    world.events.emit(GAME_EVENTS.EXPLOSION, {
        position: ship.position.clone(),
        size: ship.boundingRadius * 1.3,
        capital: ship.cls.kind === 'capital' || ship.cls.kind === 'station',
    });
    world.events.emit(GAME_EVENTS.SHIP_DESTROYED, { ship, killer });
    // Anything bolted onto the ship goes down with it.
    for (const other of world.ships) {
        if (other.parent === ship) destroyShip(world, other, killer);
    }
}

/**
 * Applies weapon damage to a ship or to a destructible projectile.
 * @param {object} options
 * @param {object} [options.source] the ship that dealt the damage
 * @param {import('three').Vector3} [options.point] world position of the impact
 * @param {number} [options.shieldMult] multiplier while the target still has shields
 * @param {number} [options.hullMult] multiplier against bare hull
 * @param {boolean} [options.continuous] true for per-frame beam damage (rate-limits effects)
 */
export function applyDamage(world, target, amount, options = {}) {
    if (!target.alive || target.arriving || amount <= 0) return;
    const { source = null, point = null, shieldMult = 1, hullMult = 1, continuous = false } = options;

    if (target.isProjectile) {
        target.hp -= amount;
        if (target.hp <= 0) destroyProjectile(world, target, true);
        return;
    }

    const position = point ?? target.position;
    if (target.invulnerable) {
        // Shielded ships shimmer; indestructible scenery (stations, wrecks) just sparks.
        if (target.targetable) target.lastShieldHitAt = world.time;
        emitHit(world, target, position, true, 0, continuous);
        return;
    }

    let remaining = amount;
    if (target.isPlayer) {
        remaining *= world.difficulty.damageTaken * POWER_MODES[target.powerMode].damageTaken;
    } else if (target.faction === FACTION.DAWN) {
        remaining *= world.difficulty.allyDamageTaken;
    }

    let shieldHit = false;
    if (target.shield > 0) {
        const shieldDamage = remaining * shieldMult;
        const absorbed = Math.min(target.shield, shieldDamage);
        target.shield -= absorbed;
        // Whatever fraction the shield could not absorb bleeds through to the hull.
        remaining *= 1 - absorbed / shieldDamage;
        shieldHit = true;
        target.lastShieldHitAt = world.time;
    }
    if (remaining > 0) {
        target.hull = Math.max(target.minHull, target.hull - remaining * hullMult);
    }

    target.shieldCooldown = target.cls.shieldDelay;
    target.lastDamagedAt = world.time;
    target.lastAttacker = source;
    emitHit(world, target, position, shieldHit, amount, continuous);

    if (target.hull <= 0) destroyShip(world, target, source);
}

export function regenerateShield(ship, dt) {
    if (!ship.alive || ship.maxShield <= 0) return;
    if (ship.shieldCooldown > 0) {
        ship.shieldCooldown -= dt;
        return;
    }
    if (ship.shield >= ship.maxShield) return;
    const modeBonus = ship.isPlayer ? POWER_MODES[ship.powerMode].shieldRegen : 1;
    ship.shield = Math.min(ship.maxShield, ship.shield + ship.cls.shieldRegen * modeBonus * dt);
}
