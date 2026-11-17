import { PLAYER } from './gameConfig.js';
import { SHIP_CLASSES } from './shipClasses.js';
import { WEAPONS } from './weapons.js';

/**
 * The ships a player can choose on the title screen. Each one is an ordinary entry in
 * SHIP_CLASSES (hull, shields, speed, plus `handling` and `weaponDamage`); this file only
 * decides which classes are on offer and how the hangar describes them.
 *
 * `ratings` are the 1-10 bars shown on the ship's card (the Kestrel, the yardstick, is 5 across). They are a summary for the player,
 * not what the simulation reads, so keep them in step with the class when rebalancing. They are also
 * where refits start from: a rating already at 10 cannot be upgraded (config/refit.js).
 * Names and descriptions are in the i18n files: `ship.<id>`, `playerShip.<id>.role` and
 * `playerShip.<id>.text`.
 */
export const PLAYER_SHIPS = Object.freeze([
    { classId: 'kestrel', ratings: { speed: 5, agility: 5, firepower: 5, range: 5, shields: 5, hull: 5 } },
    { classId: 'swift', ratings: { speed: 7, agility: 10, firepower: 5, range: 3, shields: 4, hull: 3 } },
    { classId: 'shrike', ratings: { speed: 6, agility: 3, firepower: 9, range: 9, shields: 2, hull: 5 } },
    { classId: 'bulwark', ratings: { speed: 1, agility: 1, firepower: 10, range: 10, shields: 10, hull: 10 } },
    { classId: 'peregrine', ratings: { speed: 10, agility: 6, firepower: 4, range: 6, shields: 6, hull: 4 } },
]);

export const RATING_ORDER = Object.freeze(['speed', 'agility', 'firepower', 'range', 'shields', 'hull']);
export const RATING_MAX = 10;
export const DEFAULT_PLAYER_SHIP = 'kestrel';

export function isPlayerShip(classId) {
    return PLAYER_SHIPS.some((ship) => ship.classId === classId);
}

/**
 * A player ship in plain numbers, worked out from its class the way the simulation does
 * (shields and hull as they are, top speeds as systems/playerFlight.js reaches them, weapon
 * reach and damage as systems/weapons.js scales them). The ship pages show them next to the
 * rating bars: the bars compare the ships, these say what a bar is worth.
 * `cls` may be a refitted class (core/refit.js `upgradedClass`); by default the class as built.
 * @returns {{ shield: number, shieldRegen: number, hull: number, speed: number, boostSpeed: number,
 *   beamRange: number, beamDps: number, torpedoRange: number, torpedoDamage: number, torpedoCount: number } | null}
 *   speeds in m/s, ranges in metres; null for a class that is not a ship
 */
export function shipSpecs(classId, cls = SHIP_CLASSES[classId]) {
    if (!cls) return null;
    const weapon = (type) => (cls.weapons ?? []).map((id) => WEAPONS[id]).find((def) => def?.type === type);
    const beam = weapon('beam');
    const torpedo = weapon('torpedo');
    const damage = cls.weaponDamage ?? 1;
    const reach = cls.weaponRange ?? 1;
    return {
        shield: cls.shield,
        shieldRegen: cls.shieldRegen,
        hull: cls.hull,
        speed: cls.maxSpeed,
        boostSpeed: cls.maxSpeed * PLAYER.boostMultiplier * (cls.handling?.boostMultiplier ?? 1),
        beamRange: beam ? beam.range * reach : 0,
        beamDps: beam ? beam.dps * damage : 0,
        torpedoRange: torpedo ? torpedo.speed * torpedo.lifetime * reach : 0,
        torpedoDamage: torpedo ? torpedo.damage * damage : 0,
        torpedoCount: torpedo?.capacity ?? 0,
    };
}
