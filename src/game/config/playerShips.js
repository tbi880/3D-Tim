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
