import {
    bossBar, chapter, checkpoint, hint, music, objective, run, say, spawn, waitForCalm, waitForGroup, waitUntil, warp,
} from '../beats.js';
import { TAG, around, hostilesRemaining, hullOf, shipByTag } from './common.js';
import { dressGraveyard } from './graveyard.js';

/**
 * Chapter 1: Interdiction. An Umbra warden pulls the Kestrel out of warp in the Veil.
 */

export const interdiction = [
    chapter('trail'),
    music('battle'),
    run((ctx) => ctx.stage.playCue('alarm')),
    spawn('warden', { tags: [TAG.INTERDICTOR], group: 'interdictor', at: [300, 100, -2000] }),
    spawn('drone', { count: 4, group: 'escorts', at: around(TAG.INTERDICTOR, 700) }),
    say('vega', 'trail.vega.pulledOut'),
    say('umbra', 'trail.umbra.yield'),
    say('vega', 'trail.vega.umbra'),
    objective('objective.destroyInterdictor'),
    bossBar(TAG.INTERDICTOR),
    hint('hint.power'),

    waitUntil((ctx) => (shipByTag(ctx, TAG.INTERDICTOR)?.shield ?? 0) <= 0),
    hint(null),
    say('vega', 'trail.vega.shieldsDown', { wait: false }),

    waitUntil((ctx) => hullOf(ctx, TAG.INTERDICTOR) < 0.6 || !shipByTag(ctx, TAG.INTERDICTOR)),
    spawn('raider', { count: 2, group: 'escorts', at: { anchor: 'player', bearing: 'behind', distance: 1700 } }),
    say('tim', 'trail.tim.contact1'),
    say('tim', 'trail.tim.contact2'),
    say('vega', 'trail.vega.raiders', { wait: false }),

    waitForGroup('interdictor'),
    bossBar(null),
    objective('objective.clearHostiles', hostilesRemaining),
    waitForCalm(),

    checkpoint('veil-cleared'),
    music('calm'),
    objective(null),
    say('vega', 'trail.vega.fieldDown'),
    say('vega', 'trail.vega.transponders'),
    warp('graveyard', { arrive: dressGraveyard }),
];
