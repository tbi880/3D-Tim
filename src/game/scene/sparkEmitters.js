/**
 * Where sparks can burst from in the cockpit cabin when the hull is hit, each
 * [x, y, z, dx, dy, dz]: a place in the cabin model's own metres (eye at the origin, -z ahead,
 * +y up; CockpitCabin.jsx scales them with the cabin) and the way the shower sprays.
 * CockpitSparks.jsx picks one at random for each shower.
 */

/**
 * In a headset, all round the pilot, who can turn to look: the tips of the display glass,
 * the dash top, under the display, the side sills, the canopy rails and the arch overhead.
 */
export const HEADSET_SPARK_EMITTERS = Object.freeze([
    [-0.86, -0.46, -0.6, 0.3, 1, 0.5], [0.86, -0.46, -0.6, -0.3, 1, 0.5],
    [-0.45, -0.57, -1.15, 0, 1, 0.4], [0.45, -0.57, -1.15, 0, 1, 0.4],
    [-0.3, -0.7, -0.55, 0, 0.7, 0.7], [0.3, -0.7, -0.55, 0, 0.7, 0.7],
    [-2.1, -0.6, -0.2, 0.8, 0.7, 0], [2.1, -0.6, -0.2, -0.8, 0.7, 0],
    [-1.95, 0.9, -0.5, 0.8, -0.5, 0.2], [1.95, 0.9, -0.5, -0.8, -0.5, 0.2],
    [-0.9, 1.52, 0.6, 0, -1, -0.3], [0.9, 1.52, 0.6, 0, -1, -0.3],
]);

/**
 * On a screen the view is fixed straight ahead, and the only part of the cabin in sight is
 * the dashboard along the bottom (nearly all the places above are out of the picture): its
 * top, across the width, and the top edge of the display glass. Above the HUD's corner panels
 * and either side of the radar, so the HUD does not hide them.
 */
export const SCREEN_SPARK_EMITTERS = Object.freeze([
    [-1.1, -0.59, -1.61, 0.2, 1, 0.4], [1.1, -0.59, -1.61, -0.2, 1, 0.4],
    [-0.69, -0.59, -1.6, 0.1, 1, 0.4], [0.69, -0.59, -1.6, -0.1, 1, 0.4],
    [-0.35, -0.36, -0.82, 0, 0.8, 0.6], [0.35, -0.36, -0.82, 0, 0.8, 0.6],
    [0, -0.58, -1.93, 0, 1, 0.3],
]);
