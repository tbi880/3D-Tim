/**
 * The ships a player can choose on the title screen. Each one is an ordinary entry in
 * SHIP_CLASSES (hull, shields, speed, plus `handling` and `weaponDamage`); this file only
 * decides which classes are on offer and how the hangar describes them.
 *
 * `ratings` are the 1-5 bars shown on the ship's card. They are a summary for the player,
 * not what the simulation reads, so keep them in step with the class when rebalancing.
 * Names and descriptions are in the i18n files: `ship.<id>`, `playerShip.<id>.role` and
 * `playerShip.<id>.text`.
 */
export const PLAYER_SHIPS = Object.freeze([
    { classId: 'kestrel', ratings: { speed: 3, agility: 3, firepower: 3, shields: 3, hull: 3 } },
    { classId: 'swift', ratings: { speed: 4, agility: 5, firepower: 3, shields: 2, hull: 2 } },
    { classId: 'shrike', ratings: { speed: 3, agility: 3, firepower: 5, shields: 2, hull: 2 } },
    { classId: 'bulwark', ratings: { speed: 2, agility: 2, firepower: 2, shields: 5, hull: 5 } },
]);

export const RATING_ORDER = Object.freeze(['speed', 'agility', 'firepower', 'shields', 'hull']);
export const RATING_MAX = 5;
export const DEFAULT_PLAYER_SHIP = 'kestrel';

export function isPlayerShip(classId) {
    return PLAYER_SHIPS.some((ship) => ship.classId === classId);
}
