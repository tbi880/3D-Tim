import { Vector3 } from 'three';
import { PLAYER, POWER_MODES } from '../../config/gameConfig.js';
import { WEAPONS } from '../../config/weapons.js';
import { GAME_EVENTS } from '../EventBus.js';
import { Projectile } from '../Projectile.js';
import { degToRad, forwardOf, randomInCone, randomRange } from '../math.js';
import { endAbility } from './abilities.js';
import { applyDamage, applyTrueDamage, areHostile, isEnemyFleet, mayAttack } from './damage.js';
import { damageObstacle, raycastObstacles } from './obstacles.js';
import { IDLE_CONTROLS } from './playerFlight.js';
import { aimPointOn, angleOffAxis, isValidTarget } from './targeting.js';

const scratchForward = new Vector3();
const scratchOrigin = new Vector3();
const scratchAim = new Vector3();
const scratchImpact = new Vector3();
const scratchDirection = new Vector3();
const scratchLead = new Vector3();
const scratchSample = new Vector3();
const scratchLanceOrigin = new Vector3();

/** Energy the capacitor must regain after running dry before the beam fires again. */
const BEAM_RESTART_ENERGY = 18;
const TURRET_RETARGET_INTERVAL = 1.2;

export function createWeaponState(weaponId, rng) {
    const def = WEAPONS[weaponId];
    if (!def) throw new Error(`Unknown weapon "${weaponId}"`);
    return {
        id: weaponId,
        def,
        // Stagger first shots so a freshly spawned squadron does not fire in unison.
        cooldown: rng() * 1.5,
        burstLeft: def.burst ?? 1,
        dutyOn: false,
        dutyTimer: rng() * 2,
        ammo: def.capacity ?? Infinity,
        reloadTimer: 0,
        depleted: false,
        target: null,
        retargetTimer: rng() * TURRET_RETARGET_INTERVAL,
        lancePhase: 'idle',
        lanceTimer: (def.cooldown ?? 0) * 0.6,
        lanceDirection: new Vector3(),
        firing: false,
    };
}

function mountPosition(ship, def, out) {
    if (!def.mount) return out.copy(ship.position);
    return out.set(def.mount[0], def.mount[1], def.mount[2]).applyQuaternion(ship.quaternion).add(ship.position);
}

/** Where a shot fired now has to go to meet a moving target. */
function leadPoint(origin, target, projectileSpeed, out) {
    const time = origin.distanceTo(target.position) / projectileSpeed;
    return out.copy(target.position).addScaledVector(target.velocity, time);
}

/** `limit`: only whether the gap is within this matters (see Ship.distanceToPoint). */
function distanceToSurface(target, point, limit = Infinity) {
    return target.isProjectile ? target.position.distanceTo(point) - target.radius : target.distanceToPoint(point, limit);
}

/**
 * Approximate gap between a ship's hull and a target (its hull or a projectile).
 * `limit`: only whether the gap is within this matters (see Ship.distanceToPoint).
 */
function hullSeparation(ship, target, limit = Infinity) {
    const targetRadius = target.isProjectile ? target.radius : target.boundingRadius;
    return ship.distanceToPoint(target.position, limit + targetRadius) - targetRadius;
}

function impactPoint(target, origin, out) {
    return target.isProjectile ? out.copy(target.position) : target.closestPoint(origin, out);
}

// ---------------------------------------------------------------------------------------
// Target selection for turrets
// ---------------------------------------------------------------------------------------

/** Nearest valid hostile within `range` of the firing ship's hull (not of its centre: big ships are long). */
function nearestInRange(candidates, ship, range, filter) {
    let best = null;
    let bestDistance = range;
    for (const candidate of candidates) {
        if (!isValidTarget(candidate) || !areHostile(ship, candidate)) continue;
        if (candidate.invulnerable || (filter && !filter(candidate))) continue;
        const distance = hullSeparation(ship, candidate, bestDistance);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    return best;
}

const isCapital = (target) => target.cls?.kind === 'capital';
const isSmall = (target) => target.cls?.kind === 'fighter';
const isTorpedo = (target) => target.kind === 'torpedo';

/** Picks a turret target according to the weapon's `targets` preference. */
function selectTurretTarget(world, ship, def) {
    switch (def.targets) {
        case 'capital':
            return nearestInRange(world.ships, ship, def.range, isCapital);
        case 'capitalFirst':
            return nearestInRange(world.ships, ship, def.range, isCapital)
                ?? nearestInRange(world.ships, ship, def.range);
        case 'smallFirst':
            return nearestInRange(world.projectiles, ship, def.range, isTorpedo)
                ?? nearestInRange(world.ships, ship, def.range, isSmall)
                ?? nearestInRange(world.ships, ship, def.range);
        default:
            return nearestInRange(world.ships, ship, def.range);
    }
}

function refreshTurretTarget(world, ship, weapon, dt) {
    weapon.retargetTimer -= dt;
    const target = weapon.target;
    const stillGood = isValidTarget(target) && !target.invulnerable && hullSeparation(ship, target, weapon.def.range) < weapon.def.range;
    if (stillGood && weapon.retargetTimer > 0) return;
    weapon.target = selectTurretTarget(world, ship, weapon.def);
    weapon.retargetTimer = TURRET_RETARGET_INTERVAL;
}

// ---------------------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------------------

function spawnBolt(world, ship, weapon, origin, direction) {
    const bolt = new Projectile('bolt', weapon.def, ship);
    bolt.position.copy(origin);
    bolt.previousPosition.copy(origin);
    randomInCone(world.rng, direction, degToRad(weapon.def.spreadDeg ?? 0), bolt.velocity).multiplyScalar(weapon.def.speed);
    world.projectiles.push(bolt);
    world.events.emit(GAME_EVENTS.WEAPON_FIRED, { ship, weapon, kind: 'bolt', projectile: bolt });
}

function spawnTorpedo(world, ship, weapon, origin, direction, target, damageScale = 1, lifeScale = 1) {
    const torpedo = new Projectile('torpedo', weapon.def, ship);
    torpedo.life *= lifeScale;
    torpedo.position.copy(origin);
    torpedo.previousPosition.copy(origin);
    torpedo.velocity.copy(direction).multiplyScalar(weapon.def.speed).add(ship.velocity);
    torpedo.velocity.setLength(weapon.def.speed);
    torpedo.target = target;
    torpedo.damageScale = damageScale;
    world.projectiles.push(torpedo);
    world.events.emit(GAME_EVENTS.WEAPON_FIRED, { ship, weapon, kind: 'torpedo', projectile: torpedo });
    return torpedo;
}

/** Burst bookkeeping shared by every bolt weapon. */
function consumeBurstShot(weapon) {
    const def = weapon.def;
    weapon.burstLeft -= 1;
    if (weapon.burstLeft > 0) {
        weapon.cooldown = def.cooldown;
    } else {
        weapon.burstLeft = def.burst ?? 1;
        weapon.cooldown = def.burstPause ?? def.cooldown;
    }
}

// ---------------------------------------------------------------------------------------
// Player weapons
// ---------------------------------------------------------------------------------------

/**
 * Reach of the player's beams in metres: the weapon's range scaled by the ship's `weaponRange` -
 * or, while the lance ability has taken the beams' place, the lance's own fixed reach.
 */
export function playerBeamRange(ship, def) {
    const lance = ship.effect?.('lance');
    return lance ? WEAPONS[lance.weapon].range : def.range * (ship.cls.weaponRange ?? 1);
}

/** Reach of the player's torpedoes in metres: speed times fuel, stretched by the ship's `weaponRange`. */
export function playerTorpedoRange(ship, def) {
    return def.speed * def.lifetime * (ship.cls.weaponRange ?? 1);
}

/** Best beam target: the locked target if it is inside the firing arc, else whatever is nearest the crosshair. */
function pickPlayerBeamTarget(world, ship, def, origin, forward) {
    const maxAngle = degToRad(def.arcDeg);
    const range = playerBeamRange(ship, def);
    const inArc = (candidate, deliberate = false) => {
        // The guns pick hostiles by themselves; anything else is only fired on when the pilot locked it.
        if (!isValidTarget(candidate) || !(deliberate ? mayAttack(world, ship, candidate) : areHostile(ship, candidate))) return Infinity;
        aimPointOn(candidate, origin, forward, scratchAim);
        if (distanceToSurface(candidate, origin, range) > range) return Infinity;
        const angle = angleOffAxis(candidate, origin, forward, scratchAim);
        return angle <= maxAngle ? angle : Infinity;
    };

    if (ship.target && inArc(ship.target, true) !== Infinity) return ship.target;

    let best = null;
    let bestAngle = Infinity;
    for (const candidate of world.ships) {
        const angle = inArc(candidate);
        if (angle < bestAngle) {
            bestAngle = angle;
            best = candidate;
        }
    }
    for (const candidate of world.projectiles) {
        if (candidate.kind !== 'torpedo') continue;
        const angle = inArc(candidate);
        if (angle < bestAngle) {
            bestAngle = angle;
            best = candidate;
        }
    }
    return best;
}

/** Where a beam from `origin`, tracking `target`, lands on it. */
function beamImpact(target, origin, forward, out) {
    aimPointOn(target, origin, forward, scratchAim);
    if (target.isProjectile) return out.copy(target.position);
    // Where the line of fire actually enters the hull.
    scratchDirection.copy(scratchAim).sub(origin).normalize();
    const entry = target.raycast(origin, scratchDirection);
    if (Number.isFinite(entry)) return out.copy(origin).addScaledVector(scratchDirection, entry);
    return target.closestPoint(origin, out);
}

/**
 * The lance ability (config/abilities.js 'lance'): while it lasts the beam trigger fires it in
 * place of the beams. It finds its mark the way they do - the lock if it is in the ring, else
 * whatever is nearest the crosshair - but reaches much further, draws nothing from the
 * capacitor (which rests and refills meanwhile), and what it does is true damage.
 */
function updatePlayerLance(world, ship, weapon, dt, triggerHeld, lance) {
    const lanceDef = WEAPONS[lance.weapon];
    if (weapon.depleted && ship.energy >= BEAM_RESTART_ENERGY) weapon.depleted = false;
    ship.energyRegenDelay -= dt;
    if (ship.energyRegenDelay <= 0) ship.energy = Math.min(PLAYER.energyMax, ship.energy + PLAYER.energyRegen * dt);
    weapon.firing = triggerHeld;
    ship.beamFiring = triggerHeld;
    if (!triggerHeld) return;

    forwardOf(ship.quaternion, scratchForward);
    const origin = ship.position;
    const target = pickPlayerBeamTarget(world, ship, lanceDef, origin, scratchForward);
    if (target) {
        beamImpact(target, origin, scratchForward, scratchImpact);
        if (target.isProjectile) {
            applyDamage(world, target, lance.capitalDps * dt, { source: ship, weapon: lanceDef, point: scratchImpact, continuous: true });
        } else {
            // Small craft lose a share of what they are every second, so the time to burn one down
            // is the same whatever it is; a ship of the line is far too much ship for that.
            const small = target.cls.kind === 'fighter' || target.isPlayer;
            const shieldRate = small ? target.maxShield / (lance.shieldedKillSeconds - lance.bareKillSeconds) : lance.capitalDps;
            const hullRate = small ? target.maxHull / lance.bareKillSeconds : lance.capitalDps;
            applyTrueDamage(world, target, shieldRate * dt, hullRate * dt, { source: ship, weapon: lanceDef, point: scratchImpact });
        }
    } else {
        const range = playerBeamRange(ship, lanceDef);
        const rock = raycastObstacles(world, origin, scratchForward, range);
        scratchImpact.copy(origin).addScaledVector(scratchForward, rock ? rock.distance : range);
        if (rock) damageObstacle(world, rock.obstacle, lance.capitalDps * dt, scratchImpact, true);
    }
    for (const mount of lanceDef.mounts) {
        scratchOrigin.fromArray(mount).applyQuaternion(ship.quaternion).add(origin);
        world.addBeam(scratchOrigin, scratchImpact, lanceDef.color, lanceDef.width, 'beam', ship, target?.isProjectile ? null : target);
    }
}

function updatePlayerBeam(world, ship, weapon, dt, triggerHeld) {
    const def = weapon.def;
    if (weapon.depleted && ship.energy >= BEAM_RESTART_ENERGY) weapon.depleted = false;

    forwardOf(ship.quaternion, scratchForward);
    const origin = ship.position;
    const target = pickPlayerBeamTarget(world, ship, def, origin, scratchForward);

    const firing = triggerHeld && !weapon.depleted && ship.energy > 0;
    if (triggerHeld && weapon.depleted && !weapon.firing) {
        world.events.emit(GAME_EVENTS.WEAPON_EMPTY, { ship });
    }
    weapon.firing = firing;
    ship.beamFiring = firing;

    if (!firing) {
        ship.energyRegenDelay -= dt;
        if (ship.energyRegenDelay <= 0) ship.energy = Math.min(PLAYER.energyMax, ship.energy + PLAYER.energyRegen * dt);
        return;
    }

    ship.energy = Math.max(0, ship.energy - def.energyPerSecond * dt);
    ship.energyRegenDelay = PLAYER.energyRegenDelay;
    if (ship.energy <= 0) weapon.depleted = true;

    const damage = def.dps * POWER_MODES[ship.powerMode].damage * (ship.cls.weaponDamage ?? 1) * dt;
    if (target) {
        beamImpact(target, origin, scratchForward, scratchImpact);
        applyDamage(world, target, damage, {
            source: ship, weapon: def, point: scratchImpact, shieldMult: def.shieldMult, hullMult: def.hullMult, continuous: true,
        });
    } else {
        // Nothing hostile in the ring: the beams fire dead ahead and carve up any asteroid in the way.
        const range = playerBeamRange(ship, def);
        const rock = raycastObstacles(world, origin, scratchForward, range);
        scratchImpact.copy(origin).addScaledVector(scratchForward, rock ? rock.distance : range);
        if (rock) damageObstacle(world, rock.obstacle, damage, scratchImpact, true);
    }
    for (const mount of def.mounts) {
        scratchOrigin.fromArray(mount).applyQuaternion(ship.quaternion).add(origin);
        world.addBeam(scratchOrigin, scratchImpact, def.color, def.width, 'beam', ship, target?.isProjectile ? null : target);
    }
}

/** Torpedo target: the lock if it is roughly ahead, otherwise the torpedo flies straight. */
function updatePlayerTorpedo(world, ship, weapon, dt, triggerPressed) {
    const def = weapon.def;
    if (weapon.ammo < def.capacity) {
        weapon.reloadTimer += dt;
        if (weapon.reloadTimer >= def.reloadTime) {
            weapon.ammo += 1;
            weapon.reloadTimer = 0;
        }
    }
    if (!triggerPressed || weapon.cooldown > 0) return;
    if (weapon.ammo <= 0) {
        world.events.emit(GAME_EVENTS.WEAPON_EMPTY, { ship });
        weapon.cooldown = 0.3;
        return;
    }

    forwardOf(ship.quaternion, scratchForward);
    mountPosition(ship, def, scratchOrigin);
    let target = null;
    if (isValidTarget(ship.target)) {
        aimPointOn(ship.target, ship.position, scratchForward, scratchAim);
        if (angleOffAxis(ship.target, ship.position, scratchForward, scratchAim) <= degToRad(def.lockConeDeg)) {
            target = ship.target;
        }
    }
    // `weaponRange` stretches the torpedo's fuel, so the same warhead reaches further.
    spawnTorpedo(world, ship, weapon, scratchOrigin, scratchForward, target,
        POWER_MODES[ship.powerMode].damage * (ship.cls.weaponDamage ?? 1), ship.cls.weaponRange ?? 1);
    weapon.ammo -= 1;
    weapon.cooldown = def.cooldown;
}

/**
 * The ability torpedo (config/abilities.js 'torpedo'): leaves the ship like one of its own,
 * homing on the lock if that is anywhere in the warhead's (wide) cone. Returns the torpedo.
 */
export function launchAbilityTorpedo(world, ship, weaponId) {
    const def = WEAPONS[weaponId];
    forwardOf(ship.quaternion, scratchForward);
    mountPosition(ship, def, scratchOrigin);
    let target = null;
    if (isValidTarget(ship.target)) {
        aimPointOn(ship.target, ship.position, scratchForward, scratchAim);
        if (angleOffAxis(ship.target, ship.position, scratchForward, scratchAim) <= degToRad(def.lockConeDeg)) target = ship.target;
    }
    return spawnTorpedo(world, ship, { id: weaponId, def }, scratchOrigin, scratchForward, target,
        POWER_MODES[ship.powerMode].damage * (ship.cls.weaponDamage ?? 1), ship.cls.weaponRange ?? 1);
}

function updatePlayerWeapons(world, ship, dt) {
    const controls = ship.controls ?? IDLE_CONTROLS;
    const helmFree = !world.controlsLocked;
    // A cloak does not survive its own ship opening fire.
    if (helmFree && (controls.firePrimary || controls.fireSecondary) && ship.effect('cloak')?.brokenByFiring) endAbility(world, ship);
    const lance = ship.effect('lance');
    for (const weapon of ship.weapons) {
        weapon.cooldown = Math.max(0, weapon.cooldown - dt);
        if (weapon.def.type === 'beam' && lance) updatePlayerLance(world, ship, weapon, dt, helmFree && controls.firePrimary, lance);
        else if (weapon.def.type === 'beam') updatePlayerBeam(world, ship, weapon, dt, helmFree && controls.firePrimary);
        else if (weapon.def.type === 'torpedo') updatePlayerTorpedo(world, ship, weapon, dt, helmFree && controls.fireSecondary);
    }
}

// ---------------------------------------------------------------------------------------
// AI weapons
// ---------------------------------------------------------------------------------------

function updateAiBeam(world, ship, weapon, dt) {
    const def = weapon.def;
    weapon.dutyTimer -= dt;
    if (weapon.dutyTimer <= 0) {
        weapon.dutyOn = !weapon.dutyOn;
        const [onTime, offTime] = def.duty ?? [1, 0];
        weapon.dutyTimer = (weapon.dutyOn ? onTime : offTime) * randomRange(world.rng, 0.8, 1.25);
    }
    refreshTurretTarget(world, ship, weapon, dt);
    const target = weapon.target;
    weapon.firing = weapon.dutyOn && Boolean(target);
    if (!weapon.firing) return;

    impactPoint(target, ship.position, scratchImpact);
    ship.closestPoint(scratchImpact, scratchOrigin);
    const beamScale = isEnemyFleet(world, ship) ? world.difficulty.enemyBeamDamage : 1;
    applyDamage(world, target, def.dps * beamScale * dt, {
        source: ship, weapon: def, point: scratchImpact, shieldMult: def.shieldMult, hullMult: def.hullMult, continuous: true,
    });
    world.addBeam(scratchOrigin, scratchImpact, def.color, def.width, 'beam', ship, target.isProjectile ? null : target);
}

/**
 * Heavy cannons must hold a target for `lockTime` seconds before they may fire, and lose
 * the lock the moment it leaves their range. While one tracks a player's ship, that ship
 * records it (1 = tracking, 2 = locked) so its pilot's HUD can warn them. Returns true once locked.
 */
function trackTarget(world, weapon, target, dt) {
    const sameTarget = Boolean(target) && weapon.lockTarget === target;
    weapon.lock = sameTarget ? Math.min(1, (weapon.lock ?? 0) + dt / weapon.def.lockTime) : 0;
    weapon.lockTarget = target ?? null;
    if (target?.isPlayer) target.cannonLock = Math.max(target.cannonLock, weapon.lock >= 1 ? 2 : 1);
    return weapon.lock >= 1;
}

function updateAiBolt(world, ship, weapon, dt) {
    const def = weapon.def;
    let target;
    if (def.turret) {
        refreshTurretTarget(world, ship, weapon, dt);
        target = weapon.target;
    } else {
        target = ship.ai.wantsFire ? ship.target : null;
    }
    if (def.lockTime && !trackTarget(world, weapon, target, dt)) return;
    if (!target || weapon.cooldown > 0) return;

    leadPoint(ship.position, target, def.speed, scratchLead);
    if (def.turret) {
        ship.closestPoint(scratchLead, scratchOrigin);
    } else {
        forwardOf(ship.quaternion, scratchForward);
        scratchOrigin.copy(ship.position).addScaledVector(scratchForward, ship.radius);
    }
    scratchDirection.copy(scratchLead).sub(scratchOrigin).normalize();
    spawnBolt(world, ship, weapon, scratchOrigin, scratchDirection);
    consumeBurstShot(weapon);
}

function updateAiTorpedo(world, ship, weapon, dt) {
    const def = weapon.def;
    let target;
    if (def.turret) {
        refreshTurretTarget(world, ship, weapon, dt);
        target = weapon.target;
    } else {
        target = ship.ai.wantsFire ? ship.target : null;
    }
    if (!isValidTarget(target) || weapon.cooldown > 0) return;
    if (hullSeparation(ship, target, def.range) > def.range) return;

    forwardOf(ship.quaternion, scratchForward);
    scratchDirection.copy(target.position).sub(ship.position).normalize();
    if (!def.turret && scratchDirection.angleTo(scratchForward) > degToRad(def.aimConeDeg ?? 30)) return;
    ship.closestPoint(scratchLead.copy(ship.position).addScaledVector(scratchDirection, ship.boundingRadius + 10), scratchOrigin);
    spawnTorpedo(world, ship, weapon, scratchOrigin, def.turret ? scratchDirection : scratchForward, target);
    weapon.cooldown = def.cooldown * randomRange(world.rng, 0.85, 1.2);
    ship.ai.firedThisFrame = true;
}

/** Lance targets: hostile capital ships, picked at random so no single ally absorbs every salvo. */
function selectLanceTarget(world, ship) {
    const candidates = world.ships.filter((other) => isValidTarget(other) && areHostile(ship, other) && isCapital(other));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(world.rng() * candidates.length)];
}

function slewLance(weapon, origin, target, maxAngle) {
    scratchDirection.copy(target.position).sub(origin).normalize();
    const angle = weapon.lanceDirection.angleTo(scratchDirection);
    if (angle <= maxAngle) weapon.lanceDirection.copy(scratchDirection);
    else weapon.lanceDirection.lerp(scratchDirection, maxAngle / angle).normalize();
}

/** Damages every hostile ship inside the lance's corridor. */
function applyLanceDamage(world, ship, weapon, origin, dt) {
    const def = weapon.def;
    for (const other of world.ships) {
        if (!other.alive || !areHostile(ship, other)) continue;
        if (other.arriving) continue;
        // Sample the hull axis at three points so long ships are hit along their length.
        let hit = false;
        forwardOf(other.quaternion, scratchForward);
        for (let step = -1; step <= 1 && !hit; step++) {
            scratchSample.copy(other.position).addScaledVector(scratchForward, step * other.halfLength * 0.6);
            const along = scratchSample.sub(origin).dot(weapon.lanceDirection);
            if (along < 0 || along > def.range) continue;
            scratchSample.copy(origin).addScaledVector(weapon.lanceDirection, along);
            hit = other.distanceToPoint(scratchSample, def.corridorRadius) < def.corridorRadius;
        }
        if (hit) {
            applyDamage(world, other, def.dps * dt, {
                source: ship, weapon: def, shieldMult: def.shieldMult, hullMult: def.hullMult, continuous: true,
            });
        }
    }
}

function updateLance(world, ship, weapon, dt) {
    const def = weapon.def;
    const origin = mountPosition(ship, def, scratchLanceOrigin);
    weapon.lanceTimer -= dt;

    if (weapon.lancePhase === 'idle') {
        weapon.firing = false;
        if (weapon.lanceTimer > 0) return;
        weapon.target = selectLanceTarget(world, ship);
        if (!weapon.target) {
            weapon.lanceTimer = 2;
            return;
        }
        weapon.lanceDirection.copy(weapon.target.position).sub(origin).normalize();
        weapon.lancePhase = 'charging';
        weapon.lanceTimer = def.chargeTime;
        world.events.emit(GAME_EVENTS.LANCE_CHARGING, { ship, weapon });
        return;
    }

    const end = scratchImpact.copy(origin).addScaledVector(weapon.lanceDirection, def.range);

    if (weapon.lancePhase === 'charging') {
        if (isValidTarget(weapon.target)) slewLance(weapon, origin, weapon.target, def.slewRate * 6 * dt);
        world.addBeam(origin, end, def.color, def.width * 0.12, 'lanceCharge', ship);
        if (weapon.lanceTimer <= 0) {
            weapon.lancePhase = 'firing';
            weapon.lanceTimer = def.fireTime;
            world.events.emit(GAME_EVENTS.LANCE_FIRING, { ship, weapon });
        }
        return;
    }

    // Firing: the beam sweeps slowly, so a fast ship can get out of its way.
    weapon.firing = true;
    if (isValidTarget(weapon.target)) slewLance(weapon, origin, weapon.target, def.slewRate * dt);
    applyLanceDamage(world, ship, weapon, origin, dt);
    world.addBeam(origin, end, def.color, def.width, 'lance', ship);
    if (weapon.lanceTimer <= 0) {
        weapon.lancePhase = 'idle';
        weapon.lanceTimer = def.cooldown * randomRange(world.rng, 0.85, 1.15);
    }
}

export function updateShipWeapons(world, ship, dt) {
    if (!ship.alive || ship.arriving || ship.weapons.length === 0) return;
    if (ship.isPlayer) {
        updatePlayerWeapons(world, ship, dt);
        return;
    }
    if (!ship.weaponsOnline) return;
    // Difficulty: the enemy fleet's guns cycle faster or slower; its beams hit harder or softer.
    const reloadStep = dt * (isEnemyFleet(world, ship) ? world.difficulty.enemyFireRate : 1);
    for (const weapon of ship.weapons) {
        weapon.cooldown = Math.max(0, weapon.cooldown - reloadStep);
        switch (weapon.def.type) {
            case 'beam': updateAiBeam(world, ship, weapon, dt); break;
            case 'bolt': updateAiBolt(world, ship, weapon, dt); break;
            case 'torpedo': updateAiTorpedo(world, ship, weapon, dt); break;
            case 'lance': updateLance(world, ship, weapon, dt); break;
            default: break;
        }
    }
}
