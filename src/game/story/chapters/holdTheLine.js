import { FACTION } from '../../config/gameConfig.js';
import {
    background, chapter, checkpoint, escort, everyFrame, hint, music, objective, progress, repeatWhile, run, say, spawn,
    stopBackground, wait, waitUntil,
} from '../beats.js';
import { TAG, around, dawnbreakerWarnings, groupCleared, shipByTag, umbraRetreats } from './common.js';

/**
 * Chapter 4: Hold the Line. The player keeps the Umbra waves off the Dawnbreaker while the Dawn
 * core recharges.
 */

/** Seconds the Dawn core needs to recharge while the player holds the line. */
const CORE_CHARGE_SECONDS = 210;
const coreCharge = (ctx) => ctx.vars.coreCharge ?? 0;

/** Core charge timer + its HUD bar. Declared again after each checkpoint inside the siege. */
const trackCoreCharge = () => [
    progress('hud.coreCharge', coreCharge),
    background('coreCharge', [
        everyFrame((ctx, dt) => {
            ctx.vars.coreCharge = Math.min(1, coreCharge(ctx) + dt / CORE_CHARGE_SECONDS);
        }),
    ]),
];

export const holdTheLine = [
    chapter('holdTheLine'),
    music('battle'),
    escort(TAG.DAWNBREAKER),
    ...trackCoreCharge(),
    dawnbreakerWarnings(),
    say('tim', 'hold.tim.welcome'),
    say('tim', 'hold.tim.status'),
    objective('objective.protectDawnbreaker'),

    // Wave 1: fighters.
    spawn('drone', { count: 4, group: 'wave', at: around(TAG.DAWNBREAKER, 3000) }),
    say('tim', 'hold.tim.fighters', { wait: false }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.26),

    // Wave 2: torpedo bombers going for the Dawnbreaker.
    spawn('lancer', { count: 3, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 3600) }),
    spawn('drone', { count: 2, group: 'wave', at: around(TAG.DAWNBREAKER, 3200) }),
    hint('hint.torpedoDefense'),
    say('vega', 'hold.vega.bombers'),
    say('tim', 'hold.tim.bombers', { wait: false }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.5),
    hint(null),

    checkpoint('cinder-siege'),
    music('battle'),
    ...trackCoreCharge(),
    dawnbreakerWarnings(),

    // Wave 3: the Dawnbreaker's hangar comes back to life.
    say('tim', 'hold.tim.darts'),
    spawn('dart', {
        count: 3, group: 'darts', tags: [TAG.FLEET], persistent: true, warpIn: false,
        at: { anchor: TAG.DAWNBREAKER, offset: [0, 260, 0] }, facing: [1, 0, 0],
    }),
    spawn('raider', { count: 3, group: 'wave', at: around(TAG.DAWNBREAKER, 3200) }),
    spawn('lancer', { count: 2, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 3700) }),
    spawn('corvette', { group: 'wave', at: around(TAG.DAWNBREAKER, 3400) }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.76),

    // Wave 4: a cruiser, just as point defence comes online.
    run((ctx) => { shipByTag(ctx, TAG.DAWNBREAKER).weaponsOnline = true; }),
    say('tim', 'hold.tim.pointDefense', { wait: false }),
    spawn('warden', { group: 'wave', at: around(TAG.DAWNBREAKER, 4200) }),
    spawn('drone', { count: 4, group: 'wave', at: around(TAG.DAWNBREAKER, 3300) }),
    spawn('lancer', { count: 2, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 3800) }),
    background('siegePressure', [
        repeatWhile((ctx) => coreCharge(ctx) < 1, [
            waitUntil((ctx) => ctx.world.countFaction(FACTION.UMBRA) < 2),
            wait(5),
            spawn('drone', { count: 3, group: 'wave', at: around(TAG.DAWNBREAKER, 3200) }),
            spawn('lancer', { count: 1, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 3600) }),
        ]),
    ]),
    waitUntil((ctx) => coreCharge(ctx) >= 1),
    stopBackground('siegePressure'),
    stopBackground('coreCharge'),

    say('tim', 'hold.tim.coreFull'),
    run((ctx) => ctx.stage.playCue('alarm')),
    say('vega', 'hold.vega.signature'),
    run(umbraRetreats),
    progress(null),
    objective(null),
    wait(6.5),
];
