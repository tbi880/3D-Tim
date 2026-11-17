import {
    background, chapter, checkpoint, escort, hint, music, objective, repeatWhile, run, say, spawn, spawnShips,
    stopBackground, wait, waitForGroup, waitUntil,
} from '../beats.js';
import { TAG, around, dawnbreakerWarnings, remainingIn, shipByTag, umbraRetreats, underBattleBudget } from './common.js';
import { carrierLaunches, parkFleet, reviveFleetOnReload, spawnPenumbra } from './fleet.js';

/**
 * Chapter 7: The Muster. Three Penumbra carriers and the Umbra line in front of them.
 */

/** Batteries per carrier at the Muster: three carriers with two each would make the sky a shooting gallery. */
const MUSTER_CANNONS_PER_CARRIER = 1;
/** Flights the three carriers' hangars hold between them, for the whole battle. */
const MUSTER_CARRIER_FLIGHTS = 12;
/** Cruiser-and-corvette waves the Umbra line sends into the Muster melee. */
const MUSTER_LINE_WAVES = 4;

/** Where the three carriers wait, in a loose line across the fleet's path. */
const MUSTER_CARRIERS = [
    { tag: 'penumbraA', offset: [-3600, 400, -1600] },
    { tag: 'penumbraB', offset: [3800, -300, -2400] },
    { tag: 'penumbraC', offset: [300, 900, -5200] },
];

export function dressMuster(ctx) {
    parkFleet(ctx, [500, -150, 6600], [0, 0, -1], { hold: false });
    const dawnbreaker = shipByTag(ctx, TAG.DAWNBREAKER);
    if (dawnbreaker) {
        // Out of the station's cover: from here on she can be hurt again.
        dawnbreaker.invulnerable = false;
        dawnbreaker.weaponsOnline = true;
    }
    for (const { tag, offset } of MUSTER_CARRIERS) {
        spawnPenumbra(ctx, { tag, at: offset, faceTag: TAG.DAWNBREAKER, cannons: MUSTER_CANNONS_PER_CARRIER });
    }
}

/**
 * The Umbra line sends cruisers and corvettes into the melee, one wave at a time, as long as a
 * carrier is left to send them, the battle budget allows and waves remain
 * (`ctx.vars.musterWaves`, set when the battle starts). Declared again after each checkpoint.
 */
const musterLine = () => background('musterLine', [
    repeatWhile((ctx) => ctx.world.countGroup('carriers') > 0 && (ctx.vars.musterWaves ?? 0) > 0, [
        waitUntil((ctx) => ctx.world.countGroup('musterLine') === 0),
        wait(18),
        waitUntil((ctx) => underBattleBudget(ctx, 4)),
        run((ctx) => {
            const [carrier] = ctx.world.getGroup('carriers');
            if (!carrier) return;
            ctx.vars.musterWaves -= 1;
            const at = { anchor: [...carrier.tags][0], bearing: 'around', distance: 2600 };
            spawnShips(ctx, 'warden', { group: 'musterLine', at, faceTag: TAG.DAWNBREAKER });
            spawnShips(ctx, 'corvette', { group: 'musterLine', at, faceTag: TAG.DAWNBREAKER });
        }),
    ]),
]);

export const muster = [
    chapter('muster'),
    music('finale'),
    escort(TAG.DAWNBREAKER),
    dawnbreakerWarnings(),
    run((ctx) => ctx.stage.playCue('alarm')),
    spawn('corvette', { group: 'musterLine', faceTag: TAG.DAWNBREAKER, at: { anchor: 'origin', offset: [1700, -100, 900] } }),
    spawn('drone', { count: 4, group: 'carrierWing', at: { anchor: 'origin', offset: [0, 300, 2200] } }),
    say('vega', 'muster.vega.arrival'),
    say('umbra', 'muster.umbra.wake'),
    say('tim', 'muster.tim.engage'),
    objective('objective.carriers', remainingIn('carriers')),
    hint('hint.melee'),
    run((ctx) => {
        ctx.vars.carrierFlights = MUSTER_CARRIER_FLIGHTS;
        ctx.vars.musterWaves = MUSTER_LINE_WAVES;
    }),
    carrierLaunches('carriers'),
    musterLine(),
    waitUntil((ctx) => ctx.world.countGroup('carriers') < MUSTER_CARRIERS.length),
    hint(null),
    say('vega', 'muster.vega.oneDown'),

    checkpoint('muster-one-down'),
    reviveFleetOnReload(),
    music('finale'),
    escort(TAG.DAWNBREAKER),
    dawnbreakerWarnings(),
    objective('objective.carriers', remainingIn('carriers')),
    carrierLaunches('carriers'),
    musterLine(),
    say('rhea', 'muster.rhea.cruisers', { wait: false }),
    waitUntil((ctx) => ctx.world.countGroup('carriers') <= 1),
    say('umbra', 'muster.umbra.last'),
    say('tim', 'muster.tim.last', { wait: false }),
    spawn('lancer', { count: 3, group: 'carrierWing', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 3400) }),
    waitForGroup('carriers'),
    stopBackground('carrierLaunches:carriers'),
    stopBackground('musterLine'),
    stopBackground(`hullWarnings:${TAG.DAWNBREAKER}`),
    run(umbraRetreats),
    objective(null),
    music('calm'),
    wait(6),
    say('vega', 'muster.vega.clear'),
    say('rhea', 'muster.rhea.count'),
    say('tim', 'muster.tim.done'),
];
