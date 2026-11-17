import { chapter, checkpoint, ending, escort, music, objective, say, wait, waitUntil, warp, waypoint } from '../beats.js';
import { TAG, distanceToTag } from './common.js';
import { parkFleet } from './fleet.js';

/**
 * Epilogue: Home. The fleet forms up and jumps back to Earth.
 */

/** The fleet drops out of warp in formation off Earth. */
const arrangeFleetAtEarth = (ctx) => parkFleet(ctx, [0, 0, 0], [0, 0, -1]);

export const home = [
    checkpoint('barrens-won'),
    chapter('home'),
    music('calm'),
    escort(null),
    say('tim', 'home.tim.formUp'),
    objective('objective.formUp'),
    waypoint({ anchor: TAG.DAWNBREAKER, offset: [0, 420, 0] }, 'waypoint.formUp'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.DAWNBREAKER) < 450),
    waypoint(null),
    objective(null),
    say('tim', 'home.tim.jump'),
    warp('home', { bring: [TAG.DAWNBREAKER, TAG.FLEET], arrive: arrangeFleetAtEarth }),
    wait(2.5),
    say('tim', 'home.tim.earth'),
    say('rhea', 'home.rhea.home'),
    say('tim', 'home.tim.thanks'),
    say('tim', 'home.tim.casino'),
    say('vega', 'home.vega.oneShip'),
    wait(1),
    ending(),
];
