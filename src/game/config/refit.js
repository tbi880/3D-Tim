/**
 * Refits: at Lantern Station the player spends upgrade points on their ship.
 *
 * A point raises one of the ship's hangar ratings (config/playerShips.js, 1-10) by one level,
 * never past RATING_MAX: a Bulwark, with shields already at 10, cannot buy more shields. What a
 * level is worth in the simulation is `perLevel` below - each level multiplies the listed class
 * values by (1 + perLevel), compounding, so three points of firepower on any ship is about +33 %
 * damage. The upgrades last for the rest of the campaign and are saved with checkpoints
 * (core/refit.js applies them to the player's ship class).
 */
export const REFIT = Object.freeze({
    /** Points handed out at Lantern Station. */
    pointsAtLantern: 3,
});

/**
 * One level of each rating, and the class values it scales (see upgradedClass in core/refit.js):
 *   speed     - top speed
 *   agility   - turn rate and acceleration (handling.turn / handling.acceleration)
 *   firepower - beam and torpedo damage (weaponDamage)
 *   range     - beam reach and torpedo flight time (weaponRange)
 *   shields   - shield capacity and recharge rate
 *   hull      - hull points
 */
export const UPGRADE_PER_LEVEL = Object.freeze({
    speed: 0.07,
    agility: 0.09,
    firepower: 0.1,
    range: 0.09,
    shields: 0.12,
    hull: 0.12,
});
