/**
 * Where a ship that is dropping out of (or leaping into) warp is drawn, relative to where
 * the simulation says it is. Shared by the hull (ShipsLayer) and the arrival effects
 * (WarpArrivalEffects), so the streak, its wake and the landing all line up.
 */

/** How far behind its destination a ship starts its warp-in streak, and how much it is stretched. */
export const WARP_IN_DISTANCE = 9000;
export const WARP_STRETCH = 45;
/** Final seconds of a departing ship's life, during which it stretches away into warp. */
export const WARP_OUT_SECONDS = 0.9;

/**
 * Signed offset along the ship's nose, as a fraction of WARP_IN_DISTANCE: negative while
 * arriving (behind its spot, racing in and braking hard), positive while leaving, 0 otherwise.
 */
export function warpDisplacement(ship) {
    if (ship.warpTimer > 0) return -((ship.warpTimer / ship.warpDuration) ** 3);
    if (ship.despawnTimer != null && ship.despawnTimer < WARP_OUT_SECONDS) {
        return (1 - Math.max(0, ship.despawnTimer) / WARP_OUT_SECONDS) ** 3;
    }
    return 0;
}

/**
 * 0 for fighters .. 1 for the largest capital ships, on a log scale of the hull's size:
 * corvette ~0.4, cruiser ~0.6, battleship ~0.75, flagship and larger 1.
 */
export function arrivalHeft(ship) {
    return Math.min(1, Math.max(0, Math.log(Math.max(1, ship.boundingRadius) / 12) / Math.log(700 / 12)));
}
