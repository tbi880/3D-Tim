import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { POWER_MODE_ORDER } from '../../config/gameConfig.js';
import { cleanUpgrades } from '../match/matchInfo.js';

/**
 * A zone written down so that another device can go on from it: every ship as it stands and
 * the rocks that are gone. It is what the host sends to the devices next in line to host
 * (MatchServer.capture), and what one of them rebuilds the match from if the host is lost
 * (MatchServer's `checkpoint`).
 *
 * Shots in flight are not kept: a torpedo that was on its way when the host was lost is
 * simply gone. The numbers are rounded - this is a place to resume from, not a replay.
 *
 * A checkpoint comes from another player's device. Restoring one never trusts it further
 * than it must: unknown ship classes are skipped, numbers that are not numbers become safe
 * ones, and nothing in it is used as a key into the game's own tables without a check.
 */

const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
};
const vector = (source, digits = 1) => [round(source.x, digits), round(source.y, digits), round(source.z, digits)];
const number = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const isVector = (value, length) => Array.isArray(value) && value.length === length && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
/** Most ships a restored zone accepts, so a broken checkpoint cannot ask for an absurd amount of work. */
const MAX_SHIPS = 400;

/** @param {import('./Zone.js').Zone} zone */
export function captureZone(zone) {
    const { world } = zone;
    const ships = world.ships.filter((ship) => ship.alive);
    const indexOf = new Map(ships.map((ship, index) => [ship, index]));
    return {
        time: round(world.time),
        rocks: [...zone.destroyedRocks],
        ships: ships.map((ship) => ({
            classId: ship.classId,
            faction: ship.faction,
            callsign: ship.callsign,
            group: ship.group,
            tags: [...ship.tags],
            position: vector(ship.position),
            quaternion: [round(ship.quaternion.x, 5), round(ship.quaternion.y, 5), round(ship.quaternion.z, 5), round(ship.quaternion.w, 5)],
            velocity: vector(ship.velocity),
            speed: round(ship.speed),
            throttle: round(ship.throttle),
            hull: round(ship.hull),
            shield: round(ship.shield),
            maxShield: ship.maxShield,
            minHull: round(ship.minHull),
            shieldCooldown: round(ship.shieldCooldown),
            invulnerable: ship.invulnerable,
            targetable: ship.targetable,
            weaponsOnline: ship.weaponsOnline,
            pilotId: ship.pilotId,
            upgrades: ship.upgrades,
            energy: round(ship.energy),
            boost: round(ship.boost),
            powerMode: ship.powerMode,
            // The active ability as it stands (a warhead in flight is not kept, like any shot), and a shield held down.
            ability: ship.ability ? [round(ship.ability.cooldown), round(Math.max(0, ship.ability.active))] : null,
            shieldDown: round(ship.shieldDown),
            // Infinity (an energy weapon's "ammunition") does not survive JSON: null stands for it.
            weapons: ship.weapons.map((weapon) => [Number.isFinite(weapon.ammo) ? weapon.ammo : null, round(weapon.reloadTimer), round(weapon.cooldown), weapon.depleted ? 1 : 0]),
            aiMode: ship.ai.mode,
            engageRange: Number.isFinite(ship.ai.engageRange) ? ship.ai.engageRange : null,
            parent: ship.parent ? indexOf.get(ship.parent) ?? null : null,
            mountOffset: ship.mountOffset ? vector(ship.mountOffset) : null,
            // A ship still dropping out of warp lands at once on the new host.
            target: ship.target && !ship.target.isProjectile ? indexOf.get(ship.target) ?? null : null,
        })),
    };
}

/**
 * Puts a captured zone's ships and missing rocks into a freshly made zone.
 * @param {import('./Zone.js').Zone} zone as the match server makes it: the sector's rocks, no ships
 * @param {object} data from captureZone
 * @returns {import('../../core/Ship.js').Ship[]} the ships built, players' among them (`ship.pilotId`)
 */
export function restoreZone(zone, data) {
    const { world } = zone;
    world.time = number(data?.time);
    const gone = new Set(Array.isArray(data?.rocks) ? data.rocks.filter(Number.isInteger) : []);
    for (const rock of world.obstacles) {
        if (gone.has(rock.serial)) zone.clearRock(rock);
    }

    const saved = Array.isArray(data?.ships) ? data.ships.slice(0, MAX_SHIPS) : [];
    /** The ship built for each saved entry (null for one that could not be), so parents and targets can be found by index. */
    const built = [];
    for (const entry of saved) {
        built.push(restoreShip(world, entry, built));
    }
    saved.forEach((entry, index) => {
        const ship = built[index];
        const target = Number.isInteger(entry?.target) ? built[entry.target] : null;
        if (ship && target) ship.target = target;
    });
    return built.filter(Boolean);
}

function restoreShip(world, entry, built) {
    const cls = SHIP_CLASSES[entry?.classId];
    if (!cls || !isVector(entry.position, 3) || !isVector(entry.quaternion, 4)) return null;
    const parent = Number.isInteger(entry.parent) ? built[entry.parent] : null;
    if (entry.parent != null && !parent) return null;

    const ship = world.spawnShip(entry.classId, {
        faction: typeof entry.faction === 'string' ? entry.faction : undefined,
        callsign: typeof entry.callsign === 'string' ? entry.callsign.slice(0, 40) : null,
        group: typeof entry.group === 'string' ? entry.group : null,
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string').slice(0, 8) : [],
        position: entry.position,
        quaternion: entry.quaternion,
        invulnerable: Boolean(entry.invulnerable),
        targetable: Boolean(entry.targetable),
        weaponsOnline: entry.weaponsOnline !== false,
        aiMode: typeof entry.aiMode === 'string' ? entry.aiMode : undefined,
        engageRange: entry.engageRange === null ? Infinity : number(entry.engageRange, Infinity),
        parent,
        mountOffset: parent && isVector(entry.mountOffset, 3) ? entry.mountOffset : undefined,
        pilotId: typeof entry.pilotId === 'string' ? entry.pilotId : null,
        upgrades: cleanUpgrades(entry.upgrades),
        // A match server has no player of its own.
        local: false,
    });
    if (number(entry.maxShield, -1) >= 0) ship.maxShield = entry.maxShield;
    ship.hull = Math.min(ship.maxHull, Math.max(0.01, number(entry.hull, ship.maxHull)));
    ship.shield = Math.min(ship.maxShield, Math.max(0, number(entry.shield, ship.maxShield)));
    ship.minHull = Math.max(0, number(entry.minHull));
    ship.shieldCooldown = Math.max(0, number(entry.shieldCooldown));
    if (isVector(entry.velocity, 3)) ship.velocity.fromArray(entry.velocity);
    ship.speed = number(entry.speed, ship.speed);
    ship.throttle = Math.min(1, Math.max(0, number(entry.throttle, ship.throttle)));
    ship.energy = Math.max(0, number(entry.energy, ship.energy));
    ship.boost = Math.min(1, Math.max(0, number(entry.boost, ship.boost)));
    if (POWER_MODE_ORDER.includes(entry.powerMode)) ship.powerMode = entry.powerMode;
    if (ship.ability && Array.isArray(entry.ability)) {
        const { def } = ship.ability;
        ship.ability.cooldown = Math.min(def.cooldown, Math.max(0, number(entry.ability[0])));
        ship.ability.active = Math.min(def.duration ?? 0, Math.max(0, number(entry.ability[1])));
        ship.cloaked = Boolean(ship.effect('cloak'));
    }
    ship.shieldDown = Math.min(60, Math.max(0, number(entry.shieldDown)));
    if (Array.isArray(entry.weapons)) {
        ship.weapons.forEach((weapon, index) => {
            const state = entry.weapons[index];
            if (!Array.isArray(state)) return;
            weapon.ammo = state[0] === null ? weapon.ammo : Math.max(0, number(state[0], weapon.ammo));
            weapon.reloadTimer = Math.max(0, number(state[1]));
            weapon.cooldown = Math.max(0, number(state[2]));
            weapon.depleted = Boolean(state[3]);
        });
    }
    return ship;
}
