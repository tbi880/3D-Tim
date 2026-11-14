import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { UPGRADE_PER_LEVEL } from '../config/refit.js';

/**
 * Ship upgrades bought at a refit (config/refit.js). `upgrades` is a plain object of
 * rating -> levels bought, e.g. { firepower: 2, hull: 1 }; it is saved with checkpoints.
 */

/** The ship's hangar ratings (1-10), or null for a class the hangar does not offer. */
export function baseRatings(classId) {
    return PLAYER_SHIPS.find((ship) => ship.classId === classId)?.ratings ?? null;
}

/** Ratings after upgrades, capped at RATING_MAX. */
export function upgradedRatings(classId, upgrades = {}) {
    const base = baseRatings(classId);
    if (!base) return null;
    return Object.fromEntries(RATING_ORDER.map((rating) => [rating, Math.min(RATING_MAX, base[rating] + (upgrades[rating] ?? 0))]));
}

/** True if one more level of `rating` fits under the cap. */
export function canUpgrade(classId, upgrades, rating) {
    const ratings = upgradedRatings(classId, upgrades);
    return Boolean(ratings) && ratings[rating] < RATING_MAX;
}

/** Adds `added` to `upgrades`, dropping anything over the cap. Returns a new object. */
export function mergeUpgrades(classId, upgrades = {}, added = {}) {
    const merged = { ...upgrades };
    for (const rating of RATING_ORDER) {
        for (let i = 0; i < (added[rating] ?? 0); i++) {
            if (!canUpgrade(classId, merged, rating)) break;
            merged[rating] = (merged[rating] ?? 0) + 1;
        }
    }
    return merged;
}

/** Levels actually counted for a rating: never more than the cap leaves room for. */
function levels(classId, upgrades, rating) {
    const base = baseRatings(classId)?.[rating] ?? RATING_MAX;
    return Math.max(0, Math.min(upgrades[rating] ?? 0, RATING_MAX - base));
}

/**
 * The class with its upgrades applied: a frozen copy the player's Ship uses as its `cls`.
 * Every system reads the ship's stats from `ship.cls`, so nothing else needs to know.
 */
export function upgradedClass(classId, cls, upgrades = {}) {
    const factor = (rating) => (1 + UPGRADE_PER_LEVEL[rating]) ** levels(classId, upgrades, rating);
    const handling = cls.handling ?? {};
    return Object.freeze({
        ...cls,
        maxSpeed: cls.maxSpeed * factor('speed'),
        handling: Object.freeze({
            ...handling,
            turn: (handling.turn ?? 1) * factor('agility'),
            acceleration: (handling.acceleration ?? 1) * factor('agility'),
        }),
        weaponDamage: (cls.weaponDamage ?? 1) * factor('firepower'),
        weaponRange: (cls.weaponRange ?? 1) * factor('range'),
        shield: cls.shield * factor('shields'),
        shieldRegen: cls.shieldRegen * factor('shields'),
        hull: cls.hull * factor('hull'),
    });
}

/** The upgrades the autopilot (scripts/simulate-campaign.mjs) buys: the weakest ratings first. */
export function weakestFirst(classId, points) {
    let upgrades = {};
    for (let i = 0; i < points; i++) {
        const ratings = upgradedRatings(classId, upgrades);
        if (!ratings) break;
        const open = RATING_ORDER.filter((rating) => ratings[rating] < RATING_MAX);
        if (open.length === 0) break;
        const weakest = open.reduce((best, rating) => (ratings[rating] < ratings[best] ? rating : best));
        upgrades = mergeUpgrades(classId, upgrades, { [weakest]: 1 });
    }
    return upgrades;
}
