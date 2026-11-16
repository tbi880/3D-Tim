import { cameraModeOf } from '../../xr/vrState.js';
import { INSIDE_SCALE, shieldShells } from './ShieldShell.js';

/**
 * Where a hit on a ship is shown.
 *
 * The simulation reports hits where they meet the hull. With the shield up, what the eye
 * should see is the shot stopped by the shield: the beam ending on the shell, the bolt
 * breaking up on it. And from the cockpit the pilot's own hull is not drawn at all, while
 * the cabin round the eye is: there every hit is shown out on the shell (larger from the
 * inside, see ShieldShell), or just inside it once the shield is down, never in the pilot's lap.
 */

/** Where hits on the pilot's bare hull are shown from the cockpit, as a multiple of the shell's size. */
const INSIDE_HULL_SCALE = 1.3;
/** From the cockpit a hit is a few metres from the eye: its flares are drawn this much smaller. */
export const INSIDE_FLARE_SCALE = 0.4;

/** Whether `ship` is the one this device flies and is seen from its cockpit (so its hull is not drawn). */
export function seenFromInside(session, ship) {
    return Boolean(ship) && ship === session.world.player && cameraModeOf(session) !== 'chase';
}

/**
 * @param {boolean} onShield whether the shield took the hit
 * @returns {import('three').Vector3} `out`, the point to show the hit at
 */
export function shownImpact(session, ship, position, onShield, out) {
    const shell = ship ? shieldShells.get(ship) : null;
    const inside = seenFromInside(session, ship);
    if (!shell || !(onShield || inside)) return out.copy(position);
    return shell.surfacePoint(ship, position, inside ? (onShield ? INSIDE_SCALE : INSIDE_HULL_SCALE) : 1, out);
}
