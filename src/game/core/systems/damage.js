import { Vector3 } from 'three';
import { ABILITY_PHASE } from '../../config/abilities.js';
import { ALLIES, FACTION, POWER_MODES, WORLD } from '../../config/gameConfig.js';
import { GAME_EVENTS } from '../EventBus.js';

const scratchNearest = new Vector3();

/**
 * Two things fight each other on sight when they belong to different, non-neutral factions.
 * Pirates are a side like any other in this: to each other they are comrades.
 */
export function areHostile(a, b) {
    return a.faction !== b.faction && a.faction !== FACTION.NEUTRAL && b.faction !== FACTION.NEUTRAL;
}

/**
 * Whether `ship`'s pilot may open fire on `target` on purpose: on anything hostile, and -
 * where the world allows friendly fire (multiplayer) - a player on the computer-flown ships
 * of their own side. Never the other way round, and never player on player of one side -
 * except among pirates, who are comrades with no such scruple.
 *
 * What may be attacked but is not hostile is never fired on by accident: the guns do not
 * pick it, target cycling skips it; the pilot has to aim straight at it and lock it.
 */
export function mayAttack(world, ship, target) {
    if (areHostile(ship, target)) return true;
    if (!world.friendlyFire || !ship.isPlayer || target === ship || target.isProjectile) return false;
    if (target.faction !== ship.faction || target.faction === FACTION.NEUTRAL) return false;
    return !target.isPlayer || ship.faction === FACTION.PIRATE;
}

/**
 * Whether a computer-flown ship belongs to the fleet the difficulty's `enemy...` numbers are
 * about: Umbra in the story; in multiplayer (a `versus` difficulty) the fleets of every side.
 */
export function isEnemyFleet(world, ship) {
    if (ship.isPlayer) return false;
    return world.difficulty.versus ? ship.faction !== FACTION.NEUTRAL : ship.faction === FACTION.UMBRA;
}

/**
 * True while a ship's ability keeps `source`'s fire off it (`immunity` in config/abilities.js):
 * 'weapons' stops whatever a ship fires, 'all' also what nobody fired (a rammed rock).
 */
export function shrugsOff(target, source) {
    const ability = target.ability;
    if (!ability || ability.active <= 0) return false;
    const { immunity } = ability.def;
    return immunity === 'all' || (immunity === 'weapons' && Boolean(source));
}

function emitHit(world, target, position, shieldHit, amount, { continuous, source, weapon }) {
    // Continuous beams would emit an effect every frame; rate-limit them per target.
    if (continuous) {
        if (world.time < target.hitEffectTimer) return;
        target.hitEffectTimer = world.time + WORLD.beamHitEffectInterval;
    }
    world.events.emit(GAME_EVENTS.HIT, { target, position, shield: shieldHit, amount, source, weapon });
}

/** Tells whoever keeps the rules that `source` hurt `target` (every time, unlike the rate-limited HIT effect). */
function reportDamage(world, target, source, amount) {
    if (source && world.onDamage) world.onDamage(target, source, amount);
}

export function destroyProjectile(world, projectile, withExplosion) {
    if (!projectile.alive) return;
    projectile.alive = false;
    world.events.emit(GAME_EVENTS.PROJECTILE_REMOVED, { projectile, exploded: Boolean(withExplosion) });
    if (withExplosion) {
        world.events.emit(GAME_EVENTS.EXPLOSION, {
            position: projectile.position.clone(),
            size: projectile.kind === 'torpedo' ? 16 : 3,
            color: projectile.color,
        });
    }
}

/**
 * The end of a ship: its wreck, whatever was bolted onto it, and what it does as it dies (a
 * 'deathBlast' passive, config/abilities.js).
 * @param {object} [options]
 * @param {boolean} [options.shown] the ship's end is only being shown here - a device told
 *   by the host, a staged ending: nothing is worked out from it, the host has done that
 */
export function destroyShip(world, ship, killer = null, { shown = false } = {}) {
    if (!ship.alive) return;
    ship.alive = false;
    ship.hull = 0;
    ship.shield = 0;
    world.events.emit(GAME_EVENTS.EXPLOSION, {
        position: ship.position.clone(),
        size: ship.boundingRadius * 1.3,
        capital: ship.cls.kind === 'capital' || ship.cls.kind === 'station',
        ship,
    });
    world.events.emit(GAME_EVENTS.SHIP_DESTROYED, { ship, killer });
    // Anything bolted onto the ship goes down with it.
    for (const other of world.ships) {
        if (other.parent === ship) destroyShip(world, other, killer, { shown });
    }
    if (!shown && ship.passive?.kind === 'deathBlast') deathBlast(world, ship, ship.passive);
}

/**
 * A dying ship's reactor goes up (a 'deathBlast' passive): every ship within its radius loses
 * a share of all it is, shield first. What is hostile to the dead ship was hit by it - its
 * pilot is credited with what dies; what is caught on its own side was hit by nobody, so no
 * rule about turning on one's own is broken by dying in the wrong place.
 */
function deathBlast(world, ship, passive) {
    const position = ship.position.clone();
    world.events.emit(GAME_EVENTS.ABILITY, { ship, ability: passive.id, phase: ABILITY_PHASE.BLAST, position, radius: passive.radius });
    // The blast can set off another (two Bulwarks side by side), which destroys ships while this one is still counting.
    for (const other of [...world.ships]) {
        if (other === ship || !other.alive || other.arriving || other.faction === FACTION.NEUTRAL) continue;
        const hostile = areHostile(ship, other);
        if (!hostile && !passive.hitsAllies) continue;
        if (other.distanceToPoint(position, passive.radius) > passive.radius) continue;
        // Whatever keeps a ship's fire off it keeps this off it too, whose side it is on.
        if (shrugsOff(other, ship)) continue;
        const { damage } = passive;
        const share = other.isPlayer ? damage.player : other.cls.kind === 'fighter' ? damage.fighter : damage.capital;
        // All of it is all of it: no rounding leaves a fighter flying on a sliver of hull.
        const amount = share >= 1 ? Infinity : (other.maxShield + other.maxHull) * share;
        applyTrueDamage(world, other, amount, amount, { source: hostile ? ship : null, point: other.closestPoint(position, scratchNearest) });
    }
}

/**
 * Applies weapon damage to a ship or to a destructible projectile.
 * @param {object} options
 * @param {object} [options.source] the ship that dealt the damage
 * @param {object} [options.weapon] the definition of the weapon that dealt it (config/weapons.js)
 * @param {import('three').Vector3} [options.point] world position of the impact
 * @param {number} [options.shieldMult] multiplier while the target still has shields
 * @param {number} [options.hullMult] multiplier against bare hull
 * @param {boolean} [options.continuous] true for per-frame beam damage (rate-limits effects)
 */
export function applyDamage(world, target, amount, options = {}) {
    if (!target.alive || target.arriving || amount <= 0) return;
    const { source = null, weapon = null, point = null, shieldMult = 1, hullMult = 1, continuous = false } = options;
    const effect = { continuous, source, weapon };

    if (target.isProjectile) {
        target.hp -= amount;
        if (target.hp <= 0) destroyProjectile(world, target, true);
        return;
    }
    if (shrugsOff(target, source)) return;

    const position = point ?? target.position;
    if (target.invulnerable) {
        // Shielded ships shimmer; indestructible scenery (stations, wrecks) just sparks.
        if (target.targetable) target.lastShieldHitAt = world.time;
        emitHit(world, target, position, true, 0, effect);
        return;
    }

    let remaining = amount;
    if (world.difficulty.versus) {
        // Multiplayer: every side's computer-flown ships are as tough as each other and hurt a
        // player's ship alike; what one player's guns do to another has a scale of its own.
        if (target.isPlayer) {
            let scale = 1;
            if (source?.isPlayer) scale = world.difficulty.playerDamage ?? 1;
            else if (source && isEnemyFleet(world, source)) scale = world.difficulty.damageTaken;
            remaining *= scale * POWER_MODES[target.powerMode].damageTaken;
        } else if (isEnemyFleet(world, target)) {
            remaining /= world.difficulty.enemyToughness;
        }
    } else if (target.isPlayer) {
        remaining *= world.difficulty.damageTaken * POWER_MODES[target.powerMode].damageTaken;
    } else if (target.faction === FACTION.DAWN) {
        remaining *= world.difficulty.allyDamageTaken;
    } else if (target.faction === FACTION.UMBRA) {
        remaining /= world.difficulty.enemyToughness;
        if (source && !source.isPlayer && source.faction === FACTION.DAWN) {
            remaining *= world.difficulty.allyDamage * (target.cls.kind === 'module' ? 1 : world.difficulty.allyDamageVsShips ?? ALLIES.damageVsShips);
        }
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
    emitHit(world, target, position, shieldHit, amount, effect);
    reportDamage(world, target, source, amount);

    if (target.hull <= 0) destroyShip(world, target, source);
}

/**
 * Takes `amount` off a ship's shield and then its hull as it stands: nothing softens it - no
 * difficulty, no power mode, no shield multiplier - and nobody dealt it (a black hole's pull).
 * The hull's floor (`minHull`) still holds.
 */
export function drainShip(world, ship, amount) {
    if (!ship.alive || ship.arriving || ship.invulnerable || amount <= 0) return;
    const absorbed = Math.min(ship.shield, amount);
    ship.shield -= absorbed;
    ship.hull = Math.max(ship.minHull, ship.hull - (amount - absorbed));
    ship.shieldCooldown = ship.cls.shieldDelay;
    ship.lastDamagedAt = world.time;
    if (absorbed > 0) ship.lastShieldHitAt = world.time;
    emitHit(world, ship, ship.position, absorbed > 0, amount, { continuous: true, source: null, weapon: null });
    if (ship.hull <= 0) destroyShip(world, ship, null);
}

/**
 * True damage from a weapon: `shieldAmount` comes off the shield while there is one,
 * `hullAmount` off the hull once there is none (and in the same proportion for the step in
 * which the shield gives out). Nothing scales it - no difficulty, no power mode, no shield or
 * hull multiplier - but what cannot be hurt at all still cannot: invulnerable hulls, a hull's
 * floor (`minHull`), a ship whose ability keeps fire off it. Continuous, like a beam.
 * @param {object} [options] `source`, `weapon`, `point`, as for applyDamage
 */
export function applyTrueDamage(world, target, shieldAmount, hullAmount, options = {}) {
    if (!target.alive || target.arriving || target.isProjectile) return;
    const { source = null, weapon = null, point = null } = options;
    if (shrugsOff(target, source)) return;
    const effect = { continuous: true, source, weapon };
    const position = point ?? target.position;
    if (target.invulnerable) {
        if (target.targetable) target.lastShieldHitAt = world.time;
        emitHit(world, target, position, true, 0, effect);
        return;
    }

    let hullShare = 1;
    let dealt = 0;
    const shieldHit = target.shield > 0 && shieldAmount > 0;
    if (shieldHit) {
        const absorbed = Math.min(target.shield, shieldAmount);
        target.shield -= absorbed;
        hullShare = 1 - absorbed / shieldAmount;
        dealt += absorbed;
        target.lastShieldHitAt = world.time;
    }
    if (hullShare > 0 && hullAmount > 0) {
        const before = target.hull;
        target.hull = Math.max(target.minHull, target.hull - hullAmount * hullShare);
        dealt += before - target.hull;
    }
    target.shieldCooldown = target.cls.shieldDelay;
    target.lastDamagedAt = world.time;
    target.lastAttacker = source;
    emitHit(world, target, position, shieldHit, dealt, effect);
    reportDamage(world, target, source, dealt);
    if (target.hull <= 0) destroyShip(world, target, source);
}

/**
 * Takes a ship's shield away and keeps it from coming back for `seconds` (a breach torpedo's
 * blast). Ships with no shield to lose, invulnerable ones and those whose ability keeps fire
 * off them are left alone.
 * @param {object} [options] `source`, `weapon`, `point`, as for applyDamage
 * @returns {boolean} whether the ship was affected
 */
export function stripShield(world, ship, seconds, options = {}) {
    if (!ship.alive || ship.arriving || ship.invulnerable || ship.maxShield <= 0) return false;
    const { source = null, weapon = null, point = null } = options;
    if (shrugsOff(ship, source)) return false;
    const lost = ship.shield;
    ship.shield = 0;
    ship.shieldDown = Math.max(ship.shieldDown, seconds);
    ship.lastDamagedAt = world.time;
    ship.lastShieldHitAt = world.time;
    ship.lastAttacker = source;
    emitHit(world, ship, point ?? ship.position, true, lost, { continuous: false, source, weapon });
    if (lost > 0) reportDamage(world, ship, source, lost);
    return true;
}

export function regenerateShield(world, ship, dt) {
    if (!ship.alive || ship.maxShield <= 0) return;
    // Held down by a breach blast: nothing comes back until the time is up.
    if (ship.shieldDown > 0) {
        ship.shieldDown = Math.max(0, ship.shieldDown - dt);
        ship.shield = 0;
    }
    if (ship.shieldCooldown > 0) {
        ship.shieldCooldown -= dt;
        return;
    }
    if (ship.shieldDown > 0 || ship.shield >= ship.maxShield) return;
    const modeBonus = ship.isPlayer ? POWER_MODES[ship.powerMode].shieldRegen * world.difficulty.shieldRegen : 1;
    ship.shield = Math.min(ship.maxShield, ship.shield + ship.cls.shieldRegen * modeBonus * dt);
}
