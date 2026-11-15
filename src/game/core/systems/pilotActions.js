import { POWER_MODES, POWER_MODE_ORDER } from '../../config/gameConfig.js';

/**
 * One-shot things a pilot does to their own ship: changing the lock and diverting power.
 * (Held controls - stick, throttle, triggers - go through `ship.controls` instead.)
 *
 * Single player applies them to `world.player`; a multiplayer host applies the ones each
 * player sends to that player's ship, which is why they live here and not in the session.
 */
export const PILOT_ACTIONS = Object.freeze([
    'cycleTarget', 'targetCrosshair', 'power:balanced', 'power:attack', 'power:defense', 'power:cycle',
]);

/** Cue the pilot should hear after `applyPilotAction` (see the session's `playCue`). */
export const POWER_CUE = 'power';

/**
 * @param {import('../World.js').World} world
 * @param {import('../Ship.js').Ship | null} ship the pilot's ship
 * @param {string} action one of PILOT_ACTIONS
 * @param {object} [params]
 * @param {import('three').Vector3} [params.forward] 'targetCrosshair': look along this unit vector instead of the nose (VR gaze)
 * @returns {string | null} a cue to play for that pilot, or null
 */
export function applyPilotAction(world, ship, action, { forward = null } = {}) {
    if (!ship) return null;
    switch (action) {
        case 'cycleTarget':
            world.cycleTarget(1, ship);
            return null;
        case 'targetCrosshair':
            world.targetNearestToCrosshair(forward, ship);
            return null;
        // One button that steps through the modes, for touch screens.
        case 'power:cycle':
            return applyPilotAction(world, ship, `power:${POWER_MODE_ORDER[(POWER_MODE_ORDER.indexOf(ship.powerMode) + 1) % POWER_MODE_ORDER.length]}`);
        case 'power:balanced':
        case 'power:attack':
        case 'power:defense': {
            const mode = action.slice('power:'.length);
            if (!ship.alive || !POWER_MODES[mode] || ship.powerMode === mode) return null;
            ship.powerMode = mode;
            return POWER_CUE;
        }
        default:
            return null;
    }
}
