import {
    chapter, checkpoint, hint, music, objective, run, say, spawn, tutorial, wait, waitForGroup, waitUntil, warp, waypoint,
} from '../beats.js';
import { TAG, around, distanceToTag, remainingIn } from './common.js';

/**
 * Prologue: The Signal. A drifting beacon, a few scavengers, and Tim's last log.
 */

/**
 * The prologue is also the flying lesson. Each `tutorial(...)` stops the game for a new pilot
 * until they have tried the controls it names (config/tutorial.js), at the moment the story
 * first needs them; for everyone else these beats pass at once and the prologue plays as written.
 */
export const prologue = [
    // A pilot about to be taught the throttle starts with the engines idling, so the lesson is felt.
    run((ctx) => { if (ctx.stage.tutorial?.enabled && ctx.world.player) ctx.world.player.throttle = 0; }),
    chapter('prologue'),
    music('calm'),
    spawn('buoy', { tags: [TAG.BUOY], at: [0, -30, -1600], persistent: true, warpIn: false }),
    // The first line is still on screen when the lesson on comms lines stops the game.
    say('vega', 'prologue.vega.arrival', { wait: false }),
    wait(1.6),
    tutorial('comms'),
    say('vega', 'prologue.vega.noStar'),
    waypoint({ anchor: TAG.BUOY }, 'waypoint.beacon'),
    objective('objective.reachBeacon'),
    hint('hint.flight'),
    say('vega', 'prologue.vega.helmCheck'),
    tutorial('objective', 'steer', 'throttle', 'roll', 'boost', 'view'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BUOY) < 1100),

    hint('hint.weapons'),
    spawn('drone', { count: 3, group: 'scavengers', at: around(TAG.BUOY, 420) }),
    objective('objective.destroyScavengers', remainingIn('scavengers')),
    say('vega', 'prologue.vega.contacts'),
    tutorial('radar', 'lock', 'beams'),
    say('vega', 'prologue.vega.beams', { wait: false }),
    waitForGroup('scavengers'),

    hint('hint.torpedoes'),
    say('vega', 'prologue.vega.secondWave'),
    spawn('raider', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'ahead', distance: 1500 } }),
    spawn('drone', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'left', distance: 1400 } }),
    tutorial('status', 'power', 'torpedo', 'ability'),
    waitForGroup('scavengers'),
    hint(null),
    // The last card (pausing, the settings, what the ship does by itself) ends the tutorial for good.
    tutorial('pause'),

    checkpoint('prologue-log'),
    music('calm'),
    waypoint({ anchor: TAG.BUOY }, 'waypoint.beacon'),
    objective('objective.recoverLog'),
    say('vega', 'prologue.vega.clear', { wait: false }),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BUOY) < 320),
    waypoint(null),
    objective(null),
    say('vega', 'prologue.vega.log'),
    say('tim', 'prologue.tim.log1'),
    say('tim', 'prologue.tim.log2'),
    say('tim', 'prologue.tim.log3'),
    say('vega', 'prologue.vega.course'),
    warp('veil'),
];
