import { FACTION } from '../config/gameConfig.js';
import { destroyShip } from '../core/systems/damage.js';
import {
    background, bossBar, chapter, checkpoint, ending, escort, everyFrame, hint, holdLock, holdNear, music,
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
 *  - Distances are metres. Capital ships are hundreds of metres long, so spawn escorts
 *    a couple of kilometres out (`around(tag, distance)` measures from the ship's centre).
 */

// ---- Small helpers used by the script -----------------------------------------------------

const TAG = Object.freeze({
    BUOY: 'buoy',
    INTERDICTOR: 'interdictor',
    BEACON_A: 'beaconA',
    BEACON_B: 'beaconB',
    HARRIER: 'harrier',
    OSPREY: 'osprey',
    FORGE: 'forge',
    DAWNBREAKER: 'dawnbreaker',
    ECLIPSE: 'eclipse',
    FLEET: 'fleet',
});

/** Seconds the Dawn core needs to recharge while the player holds the line. */
const CORE_CHARGE_SECONDS = 210;
/** Seconds the Harrier needs to restart her reactor in the Graveyard. */
const HARRIER_RESTART_SECONDS = 70;
/** The Harrier arrives at the Forge with at least this fraction of her hull repaired. */
const HARRIER_PATCHED_HULL = 0.8;
/** Seconds between the Forge's reactors failing and the shipyard exploding. */
const FORGE_FUSE_SECONDS = 22;
const DAWN_CANNON_COLOR = '#9fe8ff';
const TRACTOR_COLOR = '#c04dff';

// Mount points on the big models, in metres (the `markers` in scene/models/modelManifest.json,
// lifted a little so modules sit on the hull instead of in it).
const ECLIPSE_GENERATOR_MOUNTS = [[-351, 320, -144], [351, 320, -144], [-409, 385, 1256], [409, 385, 1256]];
/** Gun batteries: one on each blade, one on the bow, one under the keel. */
const ECLIPSE_CANNON_MOUNTS = [[-795, 250, -700], [795, 250, -700], [0, 150, -820], [0, -585, 560]];
const FORGE_SLIPWAY = [0, 670, 0];
const FORGE_TRACTOR_MOUNTS = [[0, 1177, -765], [507, 670, 0], [-507, 670, 765]];
const FORGE_REACTOR_MOUNTS = [[-823, 0, 1224], [823, 0, 1224]];
const FORGE_TURRET_MOUNTS = [[0, 250, -1052], [0, -250, 0], [0, 430, 1435]];

const shipByTag = (ctx, tag) => ctx.world.findByTag(tag);
const distanceToTag = (ctx, tag) => {
    const ship = shipByTag(ctx, tag);
    return ship && ctx.world.player ? ship.distanceToPoint(ctx.world.player.position) : Infinity;
};
const hullOf = (ctx, tag) => shipByTag(ctx, tag)?.hullFraction ?? 1;
const groupCleared = (group) => (ctx) => ctx.world.countGroup(group) === 0;
const remainingIn = (group) => (ctx) => ({ remaining: ctx.world.countGroup(group) });
const hostilesRemaining = (ctx) => ({ remaining: ctx.world.countFaction(FACTION.UMBRA) });
const coreCharge = (ctx) => ctx.vars.coreCharge ?? 0;
const smallHostiles = (ctx) => ctx.world.ships.filter((ship) => ship.alive && ship.faction === FACTION.UMBRA && ship.cls.kind === 'fighter').length;

/** Around a tagged ship, `distance` metres from its centre, facing the player. */
const around = (tag, distance) => ({ anchor: tag, bearing: 'around', distance });

/** A named ally calls for help as its hull drops. Declared again after each checkpoint. */
const hullWarnings = (tag, speakerId, halfKey, criticalKey) => background(`hullWarnings:${tag}`, [
    waitUntil((ctx) => hullOf(ctx, tag) < 0.5),
    say(speakerId, halfKey, { wait: false }),
    waitUntil((ctx) => hullOf(ctx, tag) < 0.25),
    say(speakerId, criticalKey, { wait: false }),
]);
const dawnbreakerWarnings = () => hullWarnings(TAG.DAWNBREAKER, 'tim', 'fleet.tim.hullHalf', 'fleet.tim.hullCritical');

/** Core charge timer + its HUD bar. Declared again after each checkpoint inside the siege. */
const trackCoreCharge = () => [
    progress('hud.coreCharge', coreCharge),
    background('coreCharge', [
        everyFrame((ctx, dt) => {
            ctx.vars.coreCharge = Math.min(1, coreCharge(ctx) + dt / CORE_CHARGE_SECONDS);
        }),
    ]),
];

// ---- Prologue: The Signal -----------------------------------------------------------------

const prologue = [
    chapter('prologue'),
    music('calm'),
    spawn('buoy', { tags: [TAG.BUOY], at: [0, -30, -1600], persistent: true, warpIn: false }),
    say('vega', 'prologue.vega.arrival'),
    say('vega', 'prologue.vega.noStar'),
    waypoint({ anchor: TAG.BUOY }, 'waypoint.beacon'),
    objective('objective.reachBeacon'),
    hint('hint.flight'),
    say('vega', 'prologue.vega.helmCheck'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.BUOY) < 1100),

    hint('hint.weapons'),
    spawn('drone', { count: 3, group: 'scavengers', at: around(TAG.BUOY, 420) }),
    objective('objective.destroyScavengers', remainingIn('scavengers')),
    say('vega', 'prologue.vega.contacts'),
    say('vega', 'prologue.vega.beams', { wait: false }),
    waitForGroup('scavengers'),

    hint('hint.torpedoes'),
    say('vega', 'prologue.vega.secondWave'),
    spawn('raider', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'ahead', distance: 1500 } }),
    spawn('drone', { count: 2, group: 'scavengers', at: { anchor: 'player', bearing: 'left', distance: 1400 } }),
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

// ---- Chapter 1: Interdiction --------------------------------------------------------------

const interdiction = [
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

// ---- Chapter 2: The Graveyard -------------------------------------------------------------

/** Wrecks of the Dawn picket line, the two beacons, and the crippled Harrier. */
function dressGraveyard(ctx) {
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

const graveyard = [
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
    // The hunters only close in once the player is near enough to do something about it.
    waitUntil((ctx) => distanceToTag(ctx, TAG.HARRIER) < 3600),
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

// ---- Chapter 3: The Forge -----------------------------------------------------------------

/** The shipyard with its defences, the captive Osprey in the slipway, and the Harrier at our side. */
function dressForge(ctx) {
    const { world } = ctx;
    const forge = world.spawnShip('forge', { position: [0, 0, 0], facing: [0, 0, -1], tags: [TAG.FORGE], persistent: true });
    const osprey = world.spawnShip('harrier', {
        position: FORGE_SLIPWAY, facing: [0, 0, -1], tags: [TAG.OSPREY], callsign: 'Osprey', persistent: true,
        aiMode: 'hold', weaponsOnline: false, invulnerable: true, targetable: false, maxShield: 0, hullFraction: 0.7,
    });
    for (const mountOffset of FORGE_TRACTOR_MOUNTS) {
        const emitter = world.spawnShip('tractorEmitter', { parent: forge, mountOffset, group: 'tractors', persistent: true });
        world.addScriptedBeam({ from: emitter, to: osprey, color: TRACTOR_COLOR, width: 16, kind: 'tractor' });
    }
    for (const mountOffset of FORGE_TURRET_MOUNTS) {
        world.spawnShip('stationTurret', { parent: forge, mountOffset, group: 'forgeTurrets', persistent: true });
    }
    for (const mountOffset of FORGE_REACTOR_MOUNTS) {
        world.spawnShip('reactor', { parent: forge, mountOffset, group: 'reactors', persistent: true, invulnerable: true, targetable: false });
    }
    const harrier = shipByTag(ctx, TAG.HARRIER);
    if (harrier) {
        harrier.position.set(1500, 420, 5400);
        harrier.quaternion.copy(world.player.quaternion);
        harrier.velocity.set(0, 0, 0);
        // Her crew patched the worst of the damage during the jump, so the Forge is a fair fight.
        harrier.hull = Math.max(harrier.hull, harrier.maxHull * HARRIER_PATCHED_HULL);
    }
}

function freeOsprey(ctx) {
    const osprey = shipByTag(ctx, TAG.OSPREY);
    if (!osprey) return;
    osprey.invulnerable = false;
    osprey.targetable = true;
    osprey.ai.mode = 'normal';
    osprey.weaponsOnline = true;
    osprey.maxShield = osprey.cls.shield;
    osprey.shield = osprey.cls.shield * 0.6;
}

function exposeReactors(ctx) {
    for (const reactor of ctx.world.getGroup('reactors')) {
        reactor.invulnerable = false;
        reactor.targetable = true;
    }
}

/** Both frigates jump clear; they rejoin the story at Cinder. */
function frigatesJumpOut(ctx) {
    for (const tag of [TAG.HARRIER, TAG.OSPREY]) {
        const ship = shipByTag(ctx, tag);
        if (!ship) continue;
        ship.persistent = false;
        ship.ai.mode = 'flee';
        ship.despawnTimer = 2.5 + ctx.world.rng();
    }
}

function destroyForge(ctx) {
    const { world } = ctx;
    const forge = shipByTag(ctx, TAG.FORGE);
    if (forge) destroyShip(world, forge, world.player);
    for (const ship of [...world.ships]) {
        if (ship.alive && ship.faction === FACTION.UMBRA) destroyShip(world, ship, null);
    }
    ctx.stage.playCue('dawnCannon');
}

const forgeLaunches = () => background('forgeLaunches', [
    repeatWhile(() => true, [
        waitUntil((ctx) => smallHostiles(ctx) < 3),
        wait(9),
        spawn('drone', { count: 3, group: 'forgeWing', at: { anchor: TAG.FORGE, offset: [0, -500, 1700] } }),
    ]),
]);

const theForge = [
    chapter('forge'),
    music('battle'),
    escort(TAG.HARRIER),
    hullWarnings(TAG.HARRIER, 'rhea', 'graveyard.rhea.hullHalf', 'graveyard.rhea.hullCritical'),
    say('vega', 'forge.vega.arrival'),
    say('rhea', 'forge.rhea.plan'),
    say('umbra', 'forge.umbra.retain'),
    spawn('drone', { count: 4, group: 'forgeWing', at: { anchor: TAG.FORGE, offset: [0, 900, -2200] } }),
    spawn('raider', { count: 2, group: 'forgeWing', at: { anchor: TAG.FORGE, offset: [900, 500, 1800] } }),
    objective('objective.tractors', remainingIn('tractors')),
    hint('hint.modules'),
    forgeLaunches(),
    waitUntil((ctx) => ctx.world.countGroup('tractors') < 3),
    hint(null),
    say('vega', 'forge.vega.oneDown', { wait: false }),
    waitForGroup('tractors'),
    run(freeOsprey),
    say('sato', 'forge.sato.free'),
    say('rhea', 'forge.rhea.welcome', { wait: false }),

    checkpoint('forge-osprey'),
    music('battle'),
    escort(TAG.HARRIER),
    hullWarnings(TAG.HARRIER, 'rhea', 'graveyard.rhea.hullHalf', 'graveyard.rhea.hullCritical'),
    forgeLaunches(),
    say('vega', 'forge.vega.keel'),
    say('rhea', 'forge.rhea.burnIt'),
    run(exposeReactors),
    objective('objective.reactors', remainingIn('reactors')),
    hint('hint.torpedoModules'),
    spawn('corvette', { group: 'forgeWing', at: { anchor: TAG.FORGE, offset: [-1500, 300, 2600] } }),
    spawn('lancer', { count: 2, group: 'forgeWing', targetTag: TAG.HARRIER, at: { anchor: TAG.FORGE, offset: [0, -700, 2400] } }),
    waitForGroup('reactors'),
    hint(null),
    stopBackground('forgeLaunches'),
    stopBackground(`hullWarnings:${TAG.HARRIER}`),
    escort(null),

    // The shipyard is going to blow: get clear.
    run((ctx) => {
        ctx.stage.playCue('alarm');
        ctx.vars.forgeFuse = 0;
    }),
    say('vega', 'forge.vega.critical', { wait: false }),
    objective('objective.escapeBlast'),
    progress('hud.forgeFuse', (ctx) => ctx.vars.forgeFuse ?? 0),
    run(frigatesJumpOut),
    say('rhea', 'forge.rhea.jumping', { wait: false }),
    waitUntil((ctx) => {
        ctx.vars.forgeFuse = Math.min(1, (ctx.vars.forgeFuse ?? 0) + ctx.world.lastStep / FORGE_FUSE_SECONDS);
        return ctx.vars.forgeFuse >= 1;
    }),
    progress(null),
    objective(null),
    run(destroyForge),
    music('calm'),
    wait(6),
    say('vega', 'forge.vega.destroyed'),

    checkpoint('forge-destroyed'),
    say('vega', 'forge.vega.cinder'),
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

// ---- Chapter 4: Hold the Line -------------------------------------------------------------

/** Remaining attackers break off: they turn away and jump out a few seconds later. */
function umbraRetreats(ctx) {
    for (const ship of ctx.world.ships) {
        if (!ship.alive || ship.faction !== FACTION.UMBRA) continue;
        ship.ai.mode = 'flee';
        ship.despawnTimer = 3 + ctx.world.rng() * 3;
    }
}

const holdTheLine = [
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

// ---- Chapter 5: Eclipse -------------------------------------------------------------------

/** Keeps a trickle of fighters coming so the Eclipse battle never goes quiet. */
const eclipseReinforcements = () => background('eclipseReinforcements', [
    repeatWhile(() => true, [
        waitUntil((ctx) => smallHostiles(ctx) < 3),
        wait(7),
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

const eclipse = [
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

// ---- Epilogue: Home -----------------------------------------------------------------------

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
        ship.position.set(side * (700 + row * 260), 120 + row * 60, 300 + row * 320);
        ship.quaternion.identity();
        ship.velocity.set(0, 0, 0);
        ship.speed = 0;
        ship.ai.mode = 'hold';
        slot += 1;
    }
}

const home = [
    checkpoint('eclipse-down'),
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

/** The full campaign, in order. */
export const CAMPAIGN = Object.freeze([...prologue, ...interdiction, ...graveyard, ...theForge, ...holdTheLine, ...eclipse, ...home]);

/** The sector a brand new game starts in. */
export const STARTING_SECTOR = 'collapse';
