import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { WEAPONS } from '../../config/weapons.js';
import { GAME_EVENTS } from '../../core/EventBus.js';
import { Projectile } from '../../core/Projectile.js';

/**
 * How ships and shots cross the wire: the host describes them as plain JSON, a client
 * rebuilds them in its own World with the ordinary `spawnShip`, so the scene, the HUD and
 * the sound cannot tell a copy from the real thing.
 *
 * Ids are the host's `ship.id` / `projectile.id`. A client's own objects get ids of their
 * own, so it keeps maps from the host's ids to its objects (`EntityIndex`).
 */

const round = (value) => Math.round(value * 100) / 100;
const roundVector = (vector) => [round(vector.x), round(vector.y), round(vector.z)];

/** @param {import('../../core/Ship.js').Ship} ship */
export function describeShip(ship) {
    return {
        id: ship.id,
        classId: ship.classId,
        faction: ship.faction,
        callsign: ship.callsign,
        group: ship.group,
        tags: [...ship.tags],
        position: roundVector(ship.position),
        quaternion: ship.quaternion.toArray(),
        hullFraction: ship.hullFraction,
        maxShield: ship.maxShield,
        invulnerable: ship.invulnerable,
        targetable: ship.targetable,
        parentId: ship.parent ? ship.parent.id : null,
        mountOffset: ship.mountOffset ? ship.mountOffset.toArray() : null,
        /** Seconds until it lands, for a ship still dropping out of warp. */
        warpSeconds: ship.arriving ? round(ship.warpTimer) : 0,
        pilotId: ship.pilotId,
        upgrades: ship.upgrades,
    };
}

const isVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

/** The host's ids mapped to this device's objects. */
export class EntityIndex {
    constructor() {
        this.ships = new Map();
        this.projectiles = new Map();
    }

    clear() {
        this.ships.clear();
        this.projectiles.clear();
    }
}

/**
 * Builds the ship a description is about. Returns null (and builds nothing) for a
 * description this device cannot use: an unknown class, a missing parent, broken numbers.
 * @param {import('../../core/World.js').World} world
 * @param {object} description from describeShip
 * @param {EntityIndex} index
 * @param {string} localPilotId the player on this device
 */
export function spawnReplicaShip(world, description, index, localPilotId) {
    if (!description || !SHIP_CLASSES[description.classId] || index.ships.has(description.id)) return null;
    if (!isVector(description.position, 3) || !isVector(description.quaternion, 4)) return null;
    const parent = description.parentId != null ? index.ships.get(description.parentId) : null;
    if (description.parentId != null && !parent) return null;

    const ship = world.spawnShip(description.classId, {
        faction: description.faction,
        callsign: description.callsign,
        group: description.group,
        tags: description.tags,
        position: description.position,
        quaternion: description.quaternion,
        hullFraction: description.hullFraction,
        maxShield: description.maxShield,
        invulnerable: description.invulnerable,
        targetable: description.targetable,
        parent,
        mountOffset: parent ? description.mountOffset : undefined,
        warpIn: description.warpSeconds > 0,
        warpSeconds: description.warpSeconds,
        pilotId: description.pilotId,
        upgrades: description.upgrades ?? undefined,
        local: description.pilotId != null && description.pilotId === localPilotId,
    });
    index.ships.set(description.id, ship);
    return ship;
}

/** @param {{ ship: object, weapon: object, kind: string, projectile: import('../../core/Projectile.js').Projectile }} fired a WEAPON_FIRED payload */
export function describeProjectile({ ship, weapon, kind, projectile }) {
    return {
        id: projectile.id,
        kind,
        weaponId: weapon.id,
        ownerId: ship.id,
        position: roundVector(projectile.position),
        velocity: roundVector(projectile.velocity),
        life: round(projectile.life),
        targetId: projectile.target && !projectile.target.isProjectile ? projectile.target.id : null,
    };
}

/**
 * Puts a copy of a shot into the world. It only flies and looks the part: on a client shots
 * hit nothing, the host says when each one is gone.
 */
export function spawnReplicaProjectile(world, description, index) {
    const owner = index.ships.get(description?.ownerId);
    const def = WEAPONS[description?.weaponId];
    if (!owner || !def || index.projectiles.has(description.id)) return null;
    if (!isVector(description.position, 3) || !isVector(description.velocity, 3) || !Number.isFinite(description.life)) return null;
    if (description.kind !== 'bolt' && description.kind !== 'torpedo') return null;

    const projectile = new Projectile(description.kind, def, owner);
    projectile.position.fromArray(description.position);
    projectile.previousPosition.copy(projectile.position);
    projectile.velocity.fromArray(description.velocity);
    projectile.life = description.life;
    projectile.target = description.targetId != null ? index.ships.get(description.targetId) ?? null : null;
    world.projectiles.push(projectile);
    index.projectiles.set(description.id, projectile);
    const weapon = owner.weapons.find((state) => state.id === description.weaponId) ?? { id: description.weaponId, def };
    world.events.emit(GAME_EVENTS.WEAPON_FIRED, { ship: owner, weapon, kind: description.kind, projectile });
    return projectile;
}
