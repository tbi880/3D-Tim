import {
    background, chapter, checkpoint, escort, everyFrame, hint, holdNear, music, objective, progress, run, say, spawn,
    stopBackground, waitForCalm, waitForGroup, waitUntil, warp, waypoint,
} from '../beats.js';
import { TAG, around, distanceToTag, hostilesRemaining, hullWarnings, remainingIn, responseRadius, shipByTag } from './common.js';
import { dressForge } from './forge.js';

/**
 * Chapter 2: The Graveyard. The wrecks of the Dawn picket line, and the crippled Harrier.
 */

/** Seconds the Harrier needs to restart her reactor in the Graveyard. */
const HARRIER_RESTART_SECONDS = 70;

/** Wrecks of the Dawn picket line, the two beacons, and the crippled Harrier. */
export function dressGraveyard(ctx) {
    const wrecks = [
        [[-1100, 140, 1300], [0.6, 0.2, -1]], [[-1900, -60, 300], [-1, 0.3, 0.4]], [[900, 220, 600], [0.3, -0.4, 1]],
        [[2100, -160, -700], [1, 0.1, 0.5]], [[1300, 60, -1500], [-0.5, 0.5, -1]], [[-900, -220, -1800], [0.8, -0.2, -0.6]],
        [[300, 320, -900], [-0.2, 0.9, 0.4]],
    ];
    for (const [position, facing] of wrecks) {
        ctx.world.spawnShip('wreck', { position, facing, persistent: true });
    }
    ctx.world.spawnShip('buoy', { position: [-1500, 60, 600], tags: [TAG.BEACON_A], persistent: true });
    ctx.world.spawnShip('buoy', { position: [1700, -80, -900], tags: [TAG.BEACON_B], persistent: true });
    ctx.world.spawnShip('harrier', {
        position: [-300, 120, -2600], facing: [1, 0.05, 0.3], tags: [TAG.HARRIER], callsign: 'Harrier',
        persistent: true, aiMode: 'hold', weaponsOnline: false, hullFraction: 0.85, maxShield: 0,
    });
}

/** The Harrier's reactor is back: she can move, shoot and raise shields again. */
function restartHarrier(ctx) {
    const harrier = shipByTag(ctx, TAG.HARRIER);
    if (!harrier) return;
    harrier.ai.mode = 'normal';
    harrier.weaponsOnline = true;
    harrier.maxShield = harrier.cls.shield;
    harrier.shield = harrier.cls.shield * 0.5;
}

export const graveyard = [
    chapter('graveyard'),
    music('calm'),
    say('vega', 'graveyard.vega.arrival'),
    say('vega', 'graveyard.vega.picket'),

    // Beacon A: a black box.
    objective('objective.scanBeacon'),
    waypoint({ anchor: TAG.BEACON_A }, 'waypoint.transponder'),
    hint('hint.scan'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BEACON_A) < 320),
    progress('hud.scanning', (ctx) => ctx.vars.scan ?? 0),
    holdNear(TAG.BEACON_A, 380, 3.5, 'scan'),
    progress(null),
    hint(null),
    say('vega', 'graveyard.vega.blackBox'),
    say('rhea', 'graveyard.rhea.recording'),

    // Beacon B: bait.
    waypoint({ anchor: TAG.BEACON_B }, 'waypoint.transponder'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BEACON_B) < 1200),
    run((ctx) => ctx.stage.playCue('alarm')),
    music('battle'),
    spawn('corvette', { group: 'ambush', at: { anchor: TAG.BEACON_B, bearing: 'around', distance: 900 } }),
    spawn('raider', { count: 3, group: 'ambush', at: { anchor: 'player', bearing: 'behind', distance: 1500 } }),
    say('vega', 'graveyard.vega.bait'),
    waypoint(null),
    objective('objective.destroyAmbush', remainingIn('ambush')),
    waitForGroup('ambush'),
    objective('objective.scanBeacon'),
    waypoint({ anchor: TAG.BEACON_B }, 'waypoint.transponder'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BEACON_B) < 320),
    progress('hud.scanning', (ctx) => ctx.vars.scan ?? 0),
    holdNear(TAG.BEACON_B, 380, 3.5, 'scan'),
    progress(null),
    say('vega', 'graveyard.vega.osprey'),

    checkpoint('graveyard-ambush'),
    music('battle'),

    // The third transponder is a ship that is still alive.
    waypoint({ anchor: TAG.HARRIER }, 'waypoint.transponder'),
    objective('objective.reachHarrier'),
    say('vega', 'graveyard.vega.moving'),
    // The hunters only close in once the player is near enough to do something about it:
    // a slow hull (the Bulwark) has to be right alongside before they show themselves.
    waitUntil((ctx) => distanceToTag(ctx, TAG.HARRIER) < responseRadius(ctx, 3600)),
    spawn('lancer', { count: 2, group: 'hunters', targetTag: TAG.HARRIER, at: around(TAG.HARRIER, 3200) }),
    spawn('drone', { count: 3, group: 'hunters', at: around(TAG.HARRIER, 1900) }),
    waypoint(null),
    escort(TAG.HARRIER),
    hullWarnings(TAG.HARRIER, 'rhea', 'graveyard.rhea.hullHalf', 'graveyard.rhea.hullCritical'),
    say('rhea', 'graveyard.rhea.contact'),
    objective('objective.protectHarrier'),
    run((ctx) => { ctx.vars.harrierRestart = 0; }),
    progress('hud.harrierReactor', (ctx) => ctx.vars.harrierRestart ?? 0),
    background('harrierRestart', [
        everyFrame((ctx, dt) => {
            ctx.vars.harrierRestart = Math.min(1, (ctx.vars.harrierRestart ?? 0) + dt / HARRIER_RESTART_SECONDS);
        }),
    ]),
    waitUntil((ctx) => ctx.vars.harrierRestart >= 0.4),
    spawn('lancer', { count: 1, group: 'hunters', targetTag: TAG.HARRIER, at: around(TAG.HARRIER, 2700) }),
    spawn('raider', { count: 2, group: 'hunters', at: around(TAG.HARRIER, 2000) }),
    say('rhea', 'graveyard.rhea.moreComing', { wait: false }),
    waitUntil((ctx) => ctx.vars.harrierRestart >= 1),
    stopBackground('harrierRestart'),
    progress(null),
    run(restartHarrier),
    say('rhea', 'graveyard.rhea.restart', { wait: false }),
    objective('objective.clearHostiles', hostilesRemaining),
    waitForCalm(),
    stopBackground(`hullWarnings:${TAG.HARRIER}`),
    escort(null),
    objective(null),
    music('calm'),
    say('rhea', 'graveyard.rhea.thanks'),
    say('rhea', 'graveyard.rhea.forge'),
    say('vega', 'graveyard.vega.detour'),
    say('rhea', 'graveyard.rhea.together'),

    checkpoint('graveyard-harrier'),
    warp('forge', { bring: [TAG.HARRIER], arrive: dressForge }),
];
