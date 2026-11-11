import { FACTION } from '../config/gameConfig.js';
import { destroyShip } from '../core/systems/damage.js';
import {
    background, bossBar, chapter, checkpoint, ending, escort, everyFrame, hint, holdLock, music,
    objective, progress, repeatWhile, run, say, spawn, spawnShips, stopBackground, wait, waitForCalm,
    waitForGroup, waitUntil, warp, waypoint,
} from './beats.js';

/**
 * ECHOES OF DAWN - the campaign script.
 *
 * The story is one continuous sequence (no level select): each beat runs when the one
 * before it finishes. Dialogue text lives in i18n/<locale>.js under the keys used here.
 *
 * Conventions:
 *  - `checkpoint(id)` is a save point. Enemies are never saved, so place checkpoints at
 *    lulls, and re-declare anything non-persistent right after one (see `trackCoreCharge`).
 *  - Ships the story needs later are spawned with `persistent: true` and a tag.
 *  - Story variables live in `ctx.vars` and must stay plain JSON.
 */

// ---- Small helpers used by the script -----------------------------------------------------

const TAG = Object.freeze({
    BUOY: 'buoy',
    INTERDICTOR: 'interdictor',
    DAWNBREAKER: 'dawnbreaker',
    ECLIPSE: 'eclipse',
    FLEET: 'fleet',
});

/** Seconds the Dawn core needs to recharge while the player holds the line. */
const CORE_CHARGE_SECONDS = 210;
const DAWN_CANNON_COLOR = '#9fe8ff';

const shipByTag = (ctx, tag) => ctx.world.findByTag(tag);
const distanceToTag = (ctx, tag) => {
    const ship = shipByTag(ctx, tag);
    return ship && ctx.world.player ? ship.distanceToPoint(ctx.world.player.position) : Infinity;
};
const groupCleared = (group) => (ctx) => ctx.world.countGroup(group) === 0;
const remainingIn = (group) => (ctx) => ({ remaining: ctx.world.countGroup(group) });
const hostilesRemaining = (ctx) => ({ remaining: ctx.world.countFaction(FACTION.UMBRA) });
const coreCharge = (ctx) => ctx.vars.coreCharge ?? 0;
const smallHostiles = (ctx) => ctx.world.ships.filter((ship) => ship.alive && ship.faction === FACTION.UMBRA && ship.cls.kind === 'fighter').length;

/** Around a tagged ship, at a distance, facing it. */
const around = (tag, distance) => ({ anchor: tag, bearing: 'around', distance });

/** Core charge timer + its HUD bar. Declared again after each checkpoint inside the siege. */
const trackCoreCharge = () => [
    progress('hud.coreCharge', coreCharge),
    background('coreCharge', [
        everyFrame((ctx, dt) => {
            ctx.vars.coreCharge = Math.min(1, coreCharge(ctx) + dt / CORE_CHARGE_SECONDS);
        }),
    ]),
];

/** Tim calls for help as the Dawnbreaker's hull drops. Declared again after each checkpoint. */
const escortWarnings = () => background('escortWarnings', [
    waitUntil((ctx) => (shipByTag(ctx, TAG.DAWNBREAKER)?.hullFraction ?? 1) < 0.5),
    say('tim', 'fleet.tim.hullHalf', { wait: false }),
    waitUntil((ctx) => (shipByTag(ctx, TAG.DAWNBREAKER)?.hullFraction ?? 1) < 0.25),
    say('tim', 'fleet.tim.hullCritical', { wait: false }),
]);

/** Keeps a trickle of fighters coming so the Eclipse battle never goes quiet. */
const eclipseReinforcements = () => background('eclipseReinforcements', [
    repeatWhile(() => true, [
        waitUntil((ctx) => smallHostiles(ctx) < 3),
        wait(7),
        spawn('drone', { count: 3, group: 'eclipseWing', at: around(TAG.ECLIPSE, 500) }),
        spawn('raider', { count: 1, group: 'eclipseWing', at: around(TAG.ECLIPSE, 500) }),
    ]),
]);

function spawnEclipse(ctx) {
    const dawnbreaker = shipByTag(ctx, TAG.DAWNBREAKER);
    const [eclipse] = spawnShips(ctx, 'eclipse', {
        at: { anchor: TAG.DAWNBREAKER, offset: [-600, 260, -3900] },
        faceTag: TAG.DAWNBREAKER,
        tags: [TAG.ECLIPSE],
        persistent: true,
        invulnerable: true,
        minHullFraction: 0.25,
    });
    // Four shield generators along the spine; the hull stays invulnerable while any survive.
    const mounts = [[-150, 95, -210], [150, 95, -210], [-150, 95, 170], [150, 95, 170]];
    for (const mountOffset of mounts) {
        ctx.world.spawnShip('shieldGenerator', {
            parent: eclipse, mountOffset, group: 'generators', persistent: true,
        });
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
    ctx.world.addScriptedBeam({ from, to, color: DAWN_CANNON_COLOR, width: 30, duration: 3.2 });
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

/** Remaining attackers break off: they turn away and jump out a few seconds later. */
function umbraRetreats(ctx) {
    for (const ship of ctx.world.ships) {
        if (!ship.alive || ship.faction !== FACTION.UMBRA) continue;
        ship.ai.mode = 'flee';
        ship.despawnTimer = 3 + ctx.world.rng() * 3;
    }
}

function arrangeFleetAtEarth(ctx) {
    const { world } = ctx;
    const dawnbreaker = shipByTag(ctx, TAG.DAWNBREAKER);
    if (dawnbreaker) {
        dawnbreaker.position.set(0, 0, 0);
        dawnbreaker.quaternion.identity();
    }
    let slot = 0;
    for (const ship of world.ships) {
        if (!ship.tags.has(TAG.FLEET)) continue;
        const side = slot % 2 === 0 ? -1 : 1;
        const row = Math.floor(slot / 2);
        ship.position.set(side * (380 + row * 160), 40 + row * 30, 200 + row * 140);
        ship.quaternion.identity();
        ship.velocity.set(0, 0, 0);
        ship.speed = 0;
        ship.ai.mode = 'hold';
        slot += 1;
    }
}

// ---- The script ---------------------------------------------------------------------------

const prologue = [
    chapter('prologue'),
    music('calm'),
    spawn('buoy', { tags: [TAG.BUOY], at: [0, -30, -1400], persistent: true, warpIn: false }),
    say('vega', 'prologue.vega.arrival'),
    say('vega', 'prologue.vega.noStar'),
    waypoint({ anchor: TAG.BUOY }, 'waypoint.beacon'),
    objective('objective.reachBeacon'),
    hint('hint.flight'),
    say('vega', 'prologue.vega.helmCheck'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BUOY) < 900),

    hint('hint.weapons'),
    spawn('drone', { count: 3, group: 'scavengers', at: around(TAG.BUOY, 320) }),
    objective('objective.destroyScavengers', remainingIn('scavengers')),
    say('vega', 'prologue.vega.contacts'),
    say('vega', 'prologue.vega.beams', { wait: false }),
    waitForGroup('scavengers'),

    hint('hint.torpedoes'),
    say('vega', 'prologue.vega.secondWave'),
    spawn('raider', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'ahead', distance: 1300 } }),
    spawn('drone', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'left', distance: 1200 } }),
    waitForGroup('scavengers'),
    hint(null),

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

const theTrail = [
    chapter('trail'),
    music('battle'),
    run((ctx) => ctx.stage.playCue('alarm')),
    spawn('warden', { tags: [TAG.INTERDICTOR], group: 'interdictor', at: [260, 90, -1500] }),
    spawn('drone', { count: 4, group: 'escorts', at: around(TAG.INTERDICTOR, 320) }),
    say('vega', 'trail.vega.pulledOut'),
    say('umbra', 'trail.umbra.yield'),
    say('vega', 'trail.vega.umbra'),
    objective('objective.destroyInterdictor'),
    bossBar(TAG.INTERDICTOR),
    hint('hint.power'),

    waitUntil((ctx) => (shipByTag(ctx, TAG.INTERDICTOR)?.shield ?? 0) <= 0),
    hint(null),
    say('vega', 'trail.vega.shieldsDown', { wait: false }),

    waitUntil((ctx) => (shipByTag(ctx, TAG.INTERDICTOR)?.hullFraction ?? 0) < 0.6),
    spawn('raider', { count: 2, group: 'escorts', at: { anchor: 'player', bearing: 'behind', distance: 1500 } }),
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
    warp('cinder', {
        arrive: (ctx) => {
            spawnShips(ctx, 'dawnbreaker', {
                tags: [TAG.DAWNBREAKER], callsign: 'Dawnbreaker', persistent: true, at: [0, 0, 0],
                facing: [1, 0, 0.25], hullFraction: 0.75, weaponsOnline: false, warpIn: false,
            });
            ctx.vars.coreCharge = 0.04;
        },
    }),
];

const holdTheLine = [
    chapter('holdTheLine'),
    music('battle'),
    escort(TAG.DAWNBREAKER),
    ...trackCoreCharge(),
    escortWarnings(),
    say('tim', 'hold.tim.welcome'),
    say('tim', 'hold.tim.status'),
    objective('objective.protectDawnbreaker'),

    // Wave 1: fighters.
    spawn('drone', { count: 4, group: 'wave', at: around(TAG.DAWNBREAKER, 2000) }),
    say('tim', 'hold.tim.fighters', { wait: false }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.26),

    // Wave 2: torpedo bombers going for the Dawnbreaker.
    spawn('lancer', { count: 3, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 2300) }),
    spawn('drone', { count: 2, group: 'wave', at: around(TAG.DAWNBREAKER, 2100) }),
    hint('hint.torpedoDefense'),
    say('vega', 'hold.vega.bombers'),
    say('tim', 'hold.tim.bombers', { wait: false }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.5),
    hint(null),

    checkpoint('cinder-siege'),
    music('battle'),
    ...trackCoreCharge(),
    escortWarnings(),

    // Wave 3: the Dawnbreaker's hangar comes back to life.
    say('tim', 'hold.tim.darts'),
    spawn('dart', {
        count: 3, group: 'darts', tags: [TAG.FLEET], persistent: true,
        at: { anchor: TAG.DAWNBREAKER, bearing: 'above', distance: 190 }, facing: [1, 0, 0],
    }),
    spawn('raider', { count: 3, group: 'wave', at: around(TAG.DAWNBREAKER, 2100) }),
    spawn('lancer', { count: 2, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 2400) }),
    spawn('drone', { count: 3, group: 'wave', at: around(TAG.DAWNBREAKER, 2000) }),
    waitUntil((ctx) => groupCleared('wave')(ctx) || coreCharge(ctx) >= 0.76),

    // Wave 4: a cruiser, just as point defence comes online.
    run((ctx) => { shipByTag(ctx, TAG.DAWNBREAKER).weaponsOnline = true; }),
    say('tim', 'hold.tim.pointDefense', { wait: false }),
    spawn('warden', { group: 'wave', at: around(TAG.DAWNBREAKER, 2600) }),
    spawn('drone', { count: 4, group: 'wave', at: around(TAG.DAWNBREAKER, 2200) }),
    spawn('lancer', { count: 2, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 2500) }),
    background('siegePressure', [
        repeatWhile((ctx) => coreCharge(ctx) < 1, [
            waitUntil((ctx) => ctx.world.countFaction(FACTION.UMBRA) < 2),
            wait(5),
            spawn('drone', { count: 3, group: 'wave', at: around(TAG.DAWNBREAKER, 2100) }),
            spawn('lancer', { count: 1, group: 'wave', targetTag: TAG.DAWNBREAKER, at: around(TAG.DAWNBREAKER, 2300) }),
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

const eclipse = [
    checkpoint('eclipse-arrival'),
    chapter('eclipse'),
    music('finale'),
    escort(TAG.DAWNBREAKER),
    run(spawnEclipse),
    escortWarnings(),
    spawn('drone', { count: 4, group: 'eclipseWing', at: around(TAG.ECLIPSE, 500) }),
    spawn('raider', { count: 2, group: 'eclipseWing', at: around(TAG.ECLIPSE, 500) }),
    bossBar(TAG.ECLIPSE),
    say('umbra', 'eclipse.umbra.yield'),
    say('tim', 'eclipse.tim.field'),
    say('tim', 'eclipse.tim.plan'),
    objective('objective.generators', remainingIn('generators')),
    eclipseReinforcements(),

    // The rest of Tim's fleet followed the Kestrel's wake.
    waitUntil((ctx) => ctx.world.countGroup('generators') < 4, { timeout: 25 }),
    spawn('harrier', {
        callsign: 'Harrier', tags: [TAG.FLEET, 'harrier'], persistent: true, faceTag: TAG.ECLIPSE,
        at: { anchor: TAG.DAWNBREAKER, offset: [-650, 120, -500] },
    }),
    spawn('harrier', {
        callsign: 'Osprey', tags: [TAG.FLEET, 'osprey'], persistent: true, faceTag: TAG.ECLIPSE,
        at: { anchor: TAG.DAWNBREAKER, offset: [600, -80, -650] },
    }),
    say('rhea', 'eclipse.rhea.arrive'),
    say('tim', 'eclipse.tim.late'),
    say('rhea', 'eclipse.rhea.torpedoes', { wait: false }),

    waitUntil((ctx) => ctx.world.countGroup('generators') <= 2),
    say('vega', 'eclipse.vega.twoDown', { wait: false }),

    checkpoint('eclipse-half'),
    music('finale'),
    objective('objective.generators', remainingIn('generators')),
    eclipseReinforcements(),
    escortWarnings(),
    spawn('lancer', { count: 3, group: 'eclipseWing', targetTag: TAG.DAWNBREAKER, at: around(TAG.ECLIPSE, 600) }),
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
    stopBackground('escortWarnings'),
    say('tim', 'eclipse.tim.firing', { wait: false }),
    wait(1.6),
    run(fireDawnCannon),
    wait(2.4),
    run(destroyUmbraFleet),
    bossBar(null),
    progress(null),
    objective(null),
    music('calm'),
    wait(5),
    say('vega', 'eclipse.vega.destroyed'),
    say('tim', 'eclipse.tim.drink'),
];

const home = [
    checkpoint('eclipse-down'),
    chapter('home'),
    music('calm'),
    escort(null),
    say('tim', 'home.tim.formUp'),
    objective('objective.formUp'),
    waypoint({ anchor: TAG.DAWNBREAKER, offset: [0, 260, 0] }, 'waypoint.formUp'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.DAWNBREAKER) < 320),
    waypoint(null),
    objective(null),
    say('tim', 'home.tim.jump'),
    warp('home', { bring: [TAG.DAWNBREAKER, TAG.FLEET], arrive: arrangeFleetAtEarth }),
    wait(1.5),
    say('tim', 'home.tim.earth'),
    say('rhea', 'home.rhea.home'),
    say('tim', 'home.tim.thanks'),
    say('tim', 'home.tim.casino'),
    say('vega', 'home.vega.oneShip'),
    wait(1),
    ending(),
];

/** The full campaign, in order. */
export const CAMPAIGN = Object.freeze([...prologue, ...theTrail, ...holdTheLine, ...eclipse, ...home]);

/** The sector a brand new game starts in. */
export const STARTING_SECTOR = 'collapse';
