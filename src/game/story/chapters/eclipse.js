import { FACTION } from '../../config/gameConfig.js';
import { destroyShip } from '../../core/systems/damage.js';
import {
    background, bossBar, chapter, checkpoint, escort, hint, holdLock, music, objective, progress, repeatWhile, run, say,
    spawn, spawnShips, stopBackground, wait, waitForGroup, waitUntil,
} from '../beats.js';
import { TAG, around, dawnbreakerWarnings, remainingIn, shipByTag, smallHostiles } from './common.js';

/**
 * Chapter 5: Eclipse. The Umbra flagship, its shield generators and gun batteries.
 */

const DAWN_CANNON_COLOR = '#9fe8ff';

// Mount points on the Eclipse model, in metres (the `markers` in scene/models/modelManifest.json,
// lifted a little so modules sit on the hull instead of in it).
const ECLIPSE_GENERATOR_MOUNTS = [[-351, 320, -144], [351, 320, -144], [-409, 385, 1256], [409, 385, 1256]];
/** Gun batteries: one on each blade, one on the bow, one under the keel. */
export const ECLIPSE_CANNON_MOUNTS = [[-795, 250, -700], [795, 250, -700], [0, 150, -820], [0, -585, 560]];

/** Keeps a trickle of fighters coming so the Eclipse battle never goes quiet. */
const eclipseReinforcements = () => background('eclipseReinforcements', [
    repeatWhile(() => true, [
        waitUntil((ctx) => smallHostiles(ctx) < 3),
        wait(10),
        spawn('drone', { count: 3, group: 'eclipseWing', at: around(TAG.ECLIPSE, 2600) }),
        spawn('raider', { count: 1, group: 'eclipseWing', at: around(TAG.ECLIPSE, 2600) }),
    ]),
]);

function spawnEclipse(ctx) {
    const dawnbreaker = shipByTag(ctx, TAG.DAWNBREAKER);
    const [eclipse] = spawnShips(ctx, 'eclipse', {
        at: { anchor: TAG.DAWNBREAKER, offset: [-1500, 700, -9000] },
        faceTag: TAG.DAWNBREAKER,
        tags: [TAG.ECLIPSE],
        persistent: true,
        invulnerable: true,
        minHullFraction: 0.25,
    });
    // Four shield generators on the dorsal hull; the ship stays invulnerable while any survive.
    for (const mountOffset of ECLIPSE_GENERATOR_MOUNTS) {
        ctx.world.spawnShip('shieldGenerator', { parent: eclipse, mountOffset, group: 'generators', persistent: true });
    }
    // Its guns can be shot off; anything they have not been told to ignore inside their range is fair game.
    for (const mountOffset of ECLIPSE_CANNON_MOUNTS) {
        ctx.world.spawnShip('eclipseCannon', { parent: eclipse, mountOffset, group: 'cannons', persistent: true });
    }
    // The Dawnbreaker gets partial shields and some hull repairs for the final stand.
    if (dawnbreaker) {
        dawnbreaker.maxShield = 800;
        dawnbreaker.shield = 800;
        dawnbreaker.hull = Math.max(dawnbreaker.hull, dawnbreaker.maxHull * 0.6);
        dawnbreaker.weaponsOnline = true;
    }
}

function fireDawnCannon(ctx) {
    const from = shipByTag(ctx, TAG.DAWNBREAKER);
    const to = shipByTag(ctx, TAG.ECLIPSE);
    if (!from || !to) return;
    ctx.world.addScriptedBeam({ from, to, color: DAWN_CANNON_COLOR, width: 110, duration: 3.2 });
    ctx.stage.playCue('dawnCannon');
}

/** The Eclipse dies and every Umbra ship slaved to it goes with it. */
function destroyUmbraFleet(ctx) {
    const { world } = ctx;
    const eclipse = shipByTag(ctx, TAG.ECLIPSE);
    if (eclipse) {
        eclipse.minHull = 0;
        eclipse.invulnerable = false;
        destroyShip(world, eclipse, shipByTag(ctx, TAG.DAWNBREAKER));
    }
    for (const ship of [...world.ships]) {
        if (ship.alive && ship.faction === FACTION.UMBRA) destroyShip(world, ship, null);
    }
    for (const projectile of world.projectiles) {
        if (projectile.faction === FACTION.UMBRA) projectile.alive = false;
    }
}

export const eclipse = [
    checkpoint('eclipse-arrival'),
    chapter('eclipse'),
    music('finale'),
    escort(TAG.DAWNBREAKER),
    run(spawnEclipse),
    dawnbreakerWarnings(),
    spawn('drone', { count: 4, group: 'eclipseWing', at: around(TAG.ECLIPSE, 2600) }),
    spawn('raider', { count: 2, group: 'eclipseWing', at: around(TAG.ECLIPSE, 2600) }),
    bossBar(TAG.ECLIPSE),
    say('umbra', 'eclipse.umbra.yield'),
    say('tim', 'eclipse.tim.field'),
    say('tim', 'eclipse.tim.plan'),
    objective('objective.generators', remainingIn('generators')),
    hint('hint.modules'),
    eclipseReinforcements(),

    // The frigates freed at the Forge catch up.
    waitUntil((ctx) => ctx.world.countGroup('generators') < 4, { timeout: 30 }),
    hint('hint.cannons'),
    spawn('harrier', {
        callsign: 'Harrier', tags: [TAG.FLEET, TAG.HARRIER], persistent: true, faceTag: TAG.ECLIPSE,
        at: { anchor: TAG.DAWNBREAKER, offset: [-1400, 300, -1200] },
    }),
    spawn('harrier', {
        callsign: 'Osprey', tags: [TAG.FLEET, TAG.OSPREY], persistent: true, faceTag: TAG.ECLIPSE,
        at: { anchor: TAG.DAWNBREAKER, offset: [1300, -200, -1500] },
    }),
    say('rhea', 'eclipse.rhea.arrive'),
    say('tim', 'eclipse.tim.late'),
    say('rhea', 'eclipse.rhea.torpedoes', { wait: false }),

    waitUntil((ctx) => ctx.world.countGroup('generators') <= 2),
    say('vega', 'eclipse.vega.twoDown', { wait: false }),

    hint(null),
    checkpoint('eclipse-half'),
    music('finale'),
    objective('objective.generators', remainingIn('generators')),
    eclipseReinforcements(),
    dawnbreakerWarnings(),
    spawn('lancer', { count: 3, group: 'eclipseWing', targetTag: TAG.DAWNBREAKER, at: around(TAG.ECLIPSE, 2800) }),
    spawn('corvette', { group: 'eclipseWing', at: around(TAG.ECLIPSE, 2800) }),
    say('tim', 'eclipse.tim.bombers', { wait: false }),
    waitForGroup('generators'),

    // Shield down: paint the target for the Dawn cannon.
    run((ctx) => {
        const target = shipByTag(ctx, TAG.ECLIPSE);
        target.invulnerable = false;
        ctx.world.setPlayerTarget(target);
    }),
    say('tim', 'eclipse.tim.shieldDown'),
    objective('objective.paintTarget'),
    progress('hud.firingSolution', (ctx) => ctx.vars.firingSolution ?? 0),
    hint('hint.paintTarget'),
    holdLock(TAG.ECLIPSE, 8, 'firingSolution'),
    hint(null),
    stopBackground('eclipseReinforcements'),
    stopBackground(`hullWarnings:${TAG.DAWNBREAKER}`),
    say('tim', 'eclipse.tim.firing', { wait: false }),
    wait(1.6),
    run(fireDawnCannon),
    wait(2.4),
    run(destroyUmbraFleet),
    bossBar(null),
    progress(null),
    objective(null),
    music('calm'),
    wait(6),
    say('vega', 'eclipse.vega.destroyed'),
    say('tim', 'eclipse.tim.drink'),
];
