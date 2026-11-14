import { Quaternion, Vector3 } from 'three';
import { BATTLE, FACTION } from '../config/gameConfig.js';
import { REFIT } from '../config/refit.js';
import { lookRotation } from '../core/math.js';
import { destroyShip } from '../core/systems/damage.js';
import {
    background, bossBar, chapter, checkpoint, ending, escort, everyFrame, fade, glide, hint, holdLock, holdNear, music,
    objective, progress, refit, repeatWhile, run, say, spawn, spawnShips, stopBackground, wait, waitForCalm,
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
    LANTERN: 'lantern',
    PENUMBRA: 'penumbra',
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

// Lantern Station (the `lanes` in tools/game-models/station/build/layout.json). The station sits
// at the origin, unturned; both lanes leave the tower along -Z, through the gap in the ring.
// Each dock mouth has a hangar door over it (`dockGates` in scene/models/ShipModel.jsx, at
// z 1678 / 1653): docking ships fly through the door into the hull while the screen fades out.
const ARRIVAL_MOUTH = [0, -120, 1643];
const ARRIVAL_MOUTH_POINT = Object.freeze(new Vector3(...ARRIVAL_MOUTH));
/** Docking: line up on the arrival lane's axis, then fly through the door into the hangar. */
const DOCK_APPROACH = [0, -120, 1150];
const ARRIVAL_HANGAR = [0, -120, 1820];
/** Undocking: out of the departure hangar through its door, then on along the lane. */
const DEPARTURE_HANGAR = [0, 300, 1820];
const UNDOCK_EXIT = [0, 300, 1250];
const UNDOCK_CLEAR = [0, 300, 200];
/** Defence turrets on the ring and the tower. */
const LANTERN_TURRET_MOUNTS = [[2379, 100, 305], [-2330, 140, -296], [1941, -20, -1501], [-1905, -20, -1466], [149, 690, 2165]];
/** Lantern's fighter wing, launched with the Kestrel. */
const LANTERN_WING_SIZE = 5;
/** Where Tim's fleet drops out of warp at Lantern: the Dawnbreaker, and her escorts around her. */
const FLEET_ARRIVAL = [-2600, 700, -5600];
const FLEET_ESCORT_OFFSETS = [[1200, 200, -900], [-900, -300, -1200], [600, 500, 800], [-500, 300, 900], [1500, -200, 300]];
/** The fleet arrives patched up to at least this much hull. */
const FLEET_ARRIVAL_HULL = 0.6;
/** The fleet jumps in once the carrier's shield is down and its hull below this. */
const CARRIER_BLEEDING_HULL = 0.97;
/** The Penumbra carriers' gun batteries: one on each blade (two of the Eclipse's four mounts). */
const PENUMBRA_CANNON_MOUNTS = ECLIPSE_CANNON_MOUNTS.slice(0, 2);
/** Batteries per carrier at the Muster: three carriers with two each would make the sky a shooting gallery. */
const MUSTER_CANNONS_PER_CARRIER = 1;
/** Under the carrier's aft hull, where its fighters come out. */
const PENUMBRA_HANGAR = [0, -650, 500];
/** Seconds between two carrier launches (one carrier launches each time; see launchFromCarriers). */
const CARRIER_LAUNCH_SECONDS = 22;
/** Flights the carriers' hangars hold, for the whole battle: Lantern's lone carrier, the Muster's three. */
const LANTERN_CARRIER_FLIGHTS = 6;
const MUSTER_CARRIER_FLIGHTS = 12;
/** Longest the carrier at Lantern waits for its vanguard to be broken before it comes in anyway. */
const VANGUARD_SECONDS = 150;
/** Cruiser-and-corvette waves the Umbra line sends into the Muster melee. */
const MUSTER_LINE_WAVES = 4;

const shipByTag = (ctx, tag) => ctx.world.findByTag(tag);
const distanceToTag = (ctx, tag) => {
    const ship = shipByTag(ctx, tag);
    return ship && ctx.world.player ? ship.distanceToPoint(ctx.world.player.position) : Infinity;
};
/** `base` metres scaled down for player ships slower than the Kestrel, never under 900 m. */
const responseRadius = (ctx, base) => Math.max(900, base * Math.min(1, (ctx.world.player?.cls.maxSpeed ?? 150) / 150));
const hullOf = (ctx, tag) => shipByTag(ctx, tag)?.hullFraction ?? 1;
const groupCleared = (group) => (ctx) => ctx.world.countGroup(group) === 0;
const remainingIn = (group) => (ctx) => ({ remaining: ctx.world.countGroup(group) });
const hostilesRemaining = (ctx) => ({ remaining: ctx.world.countFaction(FACTION.UMBRA) });
const coreCharge = (ctx) => ctx.vars.coreCharge ?? 0;
const smallHostiles = (ctx) => ctx.world.ships.filter((ship) => ship.alive && ship.faction === FACTION.UMBRA && ship.cls.kind === 'fighter').length;
/**
 * True while `extra` more ships fit in the sector without crossing the battle limits
 * (BATTLE in config/gameConfig.js). Every reinforcement wave in the big battles waits on this.
 */
const underBattleBudget = (ctx, extra = 0) => {
    let ships = 0;
    for (const ship of ctx.world.ships) if (ship.alive) ships++;
    return ships + extra <= BATTLE.maxShips && smallHostiles(ctx) + extra <= BATTLE.maxHostileFighters;
};

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

/** Umbra pilots abandon the doomed shipyard: their fighters and escorts run and jump out. */
function umbraAbandonForge(ctx) {
    for (const ship of ctx.world.ships) {
        if (!ship.alive || ship.faction !== FACTION.UMBRA || !ship.ai) continue;
        if (ship.cls.kind !== 'fighter' && ship.cls.kind !== 'capital') continue;
        ship.ai.mode = 'flee';
        ship.despawnTimer = 4 + ctx.world.rng() * 4;
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
        wait(12),
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
    run(umbraAbandonForge),
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

// ---- Fleet helpers shared by the last chapters ---------------------------------------------

const scratchFleetOffset = new Vector3();
const scratchFleetFacing = new Vector3();
const scratchFleetHeading = new Quaternion();

/**
 * Parks the Dawnbreaker at `centre`, nose along `facing`, with every ship of the fleet in two
 * columns either side of her. `hold` keeps the escorts in place (no enemies to chase).
 */
function parkFleet(ctx, centre, facing, { hold = true } = {}) {
    const { world } = ctx;
    const heading = lookRotation(scratchFleetFacing.fromArray(facing).normalize(), scratchFleetHeading);
    const dawnbreaker = shipByTag(ctx, TAG.DAWNBREAKER);
    if (dawnbreaker) {
        dawnbreaker.position.fromArray(centre);
        dawnbreaker.quaternion.copy(heading);
        dawnbreaker.velocity.set(0, 0, 0);
    }
    let slot = 0;
    for (const ship of world.ships) {
        if (!ship.tags.has(TAG.FLEET)) continue;
        const side = slot % 2 === 0 ? -1 : 1;
        const row = Math.floor(slot / 2);
        scratchFleetOffset.set(side * (700 + row * 260), 120 + row * 60, 300 + row * 320).applyQuaternion(heading);
        ship.position.fromArray(centre).add(scratchFleetOffset);
        ship.quaternion.copy(heading);
        ship.velocity.set(0, 0, 0);
        ship.speed = 0;
        if (hold) ship.ai.mode = 'hold';
        slot += 1;
    }
}

/**
 * A Penumbra-class carrier with `cannons` gun batteries (up to two), facing `faceTag`. Persistent,
 * so a checkpoint in the middle of a carrier battle keeps the carriers (and their damage).
 */
function spawnPenumbra(ctx, { tag, at, faceTag, group = 'carriers', cannons = PENUMBRA_CANNON_MOUNTS.length }) {
    const [carrier] = spawnShips(ctx, 'penumbra', { at, faceTag, tags: [tag], group, persistent: true });
    for (const mountOffset of PENUMBRA_CANNON_MOUNTS.slice(0, cannons)) {
        ctx.world.spawnShip('eclipseCannon', { parent: carrier, mountOffset, group: 'carrierGuns', persistent: true });
    }
    return carrier;
}

const scratchHangar = new Vector3();

/** A Dawn capital ship the carriers' bombers can go after (the flagship only while it can be hurt). */
function bomberTarget(ctx) {
    const targets = ctx.world.ships.filter((ship) => ship.alive && !ship.invulnerable && ship.faction === FACTION.DAWN && ship.cls.kind === 'capital');
    if (targets.length === 0) return null;
    const pick = targets[Math.floor(ctx.world.rng() * targets.length)];
    return pick.tags.size > 0 ? [...pick.tags].find((tag) => tag !== TAG.FLEET) ?? null : null;
}

/**
 * One of the living carriers in `group` (a different one each time, as it falls out) puts a
 * flight out of its hangar: drones, or a pair of torpedo bombers when there is a Dawn capital
 * ship for them to go after. However many carriers there are, the sky fills at the same rate.
 */
function launchFromCarriers(ctx, group) {
    const carriers = ctx.world.getGroup(group);
    if (carriers.length === 0 || !underBattleBudget(ctx, 3)) return;
    const carrier = carriers[Math.floor(ctx.world.rng() * carriers.length)];
    scratchHangar.fromArray(PENUMBRA_HANGAR).applyQuaternion(carrier.quaternion).add(carrier.position);
    const targetTag = ctx.world.rng() < 0.35 ? bomberTarget(ctx) : null;
    spawnShips(ctx, targetTag ? 'lancer' : 'drone', {
        count: targetTag ? 2 : 3, group: 'carrierWing', targetTag, at: scratchHangar.toArray(), facing: [0, -1, 0], warpIn: false,
    });
}

/**
 * Carriers keep launching while any of them is alive and their hangars hold out: `ctx.vars.carrierFlights`
 * flights in all for the battle (set when it starts; a story variable, so it survives checkpoints).
 * Finite on purpose: a pilot who only ever shoots the nearest fighter still runs the hangars dry.
 * Declared again after each checkpoint.
 */
const carrierLaunches = (group) => background(`carrierLaunches:${group}`, [
    repeatWhile((ctx) => ctx.world.countGroup(group) > 0 && (ctx.vars.carrierFlights ?? 0) > 0, [
        wait(CARRIER_LAUNCH_SECONDS),
        waitUntil((ctx) => underBattleBudget(ctx, 3)),
        run((ctx) => {
            launchFromCarriers(ctx, group);
            ctx.vars.carrierFlights -= 1;
        }),
    ]),
]);

// ---- Chapter 6: Lantern --------------------------------------------------------------------

/** Lantern Station with its guns. Tim's fleet is not here yet (see sendFleetAhead). */
function dressLantern(ctx) {
    const { world } = ctx;
    const station = world.spawnShip('lanternStation', { position: [0, 0, 0], facing: [0, 0, -1], tags: [TAG.LANTERN], persistent: true });
    for (const mountOffset of LANTERN_TURRET_MOUNTS) {
        world.spawnShip('stationTurret', {
            parent: station, mountOffset, faction: FACTION.DAWN, group: 'lanternGuns', persistent: true,
            invulnerable: true, targetable: false,
        });
    }
}

const isFleetShip = (ship) => ship.alive && (ship.tags.has(TAG.DAWNBREAKER) || ship.tags.has(TAG.FLEET));

/**
 * The Kestrel goes on to Lantern alone; Tim's fleet follows once its drives have cycled. Its
 * ships are written into `ctx.vars.fleetAway` (plain JSON, so checkpoints keep them) and taken
 * out of the world; fleetJumpsIn brings them back. Harmless to call again: an older save made
 * after the fleet had already reached Lantern gets the same treatment when it is loaded.
 */
function sendFleetAhead(ctx) {
    const { world } = ctx;
    const leaving = world.ships.filter(isFleetShip);
    if (leaving.length === 0) return;
    ctx.vars.fleetAway = [...(ctx.vars.fleetAway ?? []), ...leaving.map((ship) => ({
        classId: ship.classId, callsign: ship.callsign, group: ship.group, tags: [...ship.tags],
        hullFraction: ship.hullFraction, maxShield: ship.maxShield,
    }))];
    for (const ship of leaving) world.removeShip(ship);
}

/**
 * Tim's fleet drops out of warp over the battle: the Dawnbreaker on the near side of the
 * carrier, her escorts spread around it. Patched up on the way (never below FLEET_ARRIVAL_HULL).
 */
function fleetJumpsIn(ctx) {
    const { world } = ctx;
    const carrier = shipByTag(ctx, TAG.PENUMBRA);
    const target = carrier ? carrier.position.toArray() : [0, 0, -6000];
    let escortSlot = 0;
    for (const saved of ctx.vars.fleetAway ?? []) {
        const flagship = saved.tags.includes(TAG.DAWNBREAKER);
        const position = flagship ? FLEET_ARRIVAL : FLEET_ARRIVAL.map((value, axis) => value + FLEET_ESCORT_OFFSETS[escortSlot % FLEET_ESCORT_OFFSETS.length][axis]);
        if (!flagship) escortSlot += 1;
        world.spawnShip(saved.classId, {
            ...saved,
            position,
            facing: target.map((value, axis) => value - position[axis]),
            hullFraction: Math.max(saved.hullFraction, FLEET_ARRIVAL_HULL),
            persistent: true,
            weaponsOnline: true,
            warpIn: true,
        });
    }
    ctx.vars.fleetAway = [];
}

/** Lantern's own fighter wing launches with the Kestrel. It may be lost; nothing depends on it. */
function launchLanternWing(ctx) {
    spawnShips(ctx, 'dart', {
        count: LANTERN_WING_SIZE, group: 'lanternWing', spacing: 90, warpIn: false,
        at: { anchor: TAG.LANTERN, offset: UNDOCK_EXIT }, facing: [0, 0, -1],
    });
}

/** The carrier is really hurting: its shield is gone and its hull has started to go. */
const carrierBleeding = (ctx) => {
    const carrier = shipByTag(ctx, TAG.PENUMBRA);
    return !carrier || (carrier.shield <= 0 && carrier.hullFraction < CARRIER_BLEEDING_HULL);
};

/**
 * Tim's fleet for the strike on the Muster: the Dawnbreaker's frigates and Lantern's, plus the
 * Dawnbreaker's darts. Any of them may be lost in a battle; completeFleet brings the line back
 * up to strength before the Muster and whenever a Muster battle is replayed from a checkpoint.
 */
const FLEET_FRIGATES = Object.freeze([
    { callsign: 'Harrier', tag: TAG.HARRIER }, { callsign: 'Osprey', tag: TAG.OSPREY },
    { callsign: 'Kite', tag: 'kite' }, { callsign: 'Tern', tag: 'tern' },
    { callsign: 'Heron', tag: 'heron' }, { callsign: 'Wren', tag: 'wren' },
]);
const FLEET_DARTS = 3;

/**
 * Repairs every ship of the fleet to full hull and replaces the ones that were lost, a couple
 * of kilometres from the Dawnbreaker (`warpIn`: dropping out of warp, as at the Muster).
 */
function completeFleet(ctx, { warpIn = false } = {}) {
    const { world } = ctx;
    for (const ship of world.ships) {
        if (ship.alive && ship.tags.has(TAG.FLEET)) ship.hull = ship.maxHull;
    }
    const near = { anchor: TAG.DAWNBREAKER, bearing: 'around', distance: 1800 };
    for (const { callsign, tag } of FLEET_FRIGATES) {
        if (shipByTag(ctx, tag)) continue;
        spawnShips(ctx, 'harrier', { callsign, tags: [TAG.FLEET, tag], persistent: true, at: near, warpIn });
    }
    const darts = world.ships.filter((ship) => ship.alive && ship.classId === 'dart' && ship.tags.has(TAG.FLEET)).length;
    if (darts < FLEET_DARTS) {
        spawnShips(ctx, 'dart', { count: FLEET_DARTS - darts, group: 'darts', tags: [TAG.FLEET], persistent: true, at: near, warpIn });
    }
}

/** After a reload at a Muster checkpoint (not on the way through), the fleet is whole again. */
const reviveFleetOnReload = () => run((ctx) => {
    if (ctx.director.resumed) completeFleet(ctx, { warpIn: true });
});

/** The warden leading Lantern's attackers, while it is still in the fight. */
const vanguardCruiser = (ctx) => ctx.world.getGroup('vanguard').find((ship) => ship.classId === 'warden' && ship.ai.mode !== 'flee') ?? null;

/**
 * Holds the player's ship at `position`, nose along `facing`, with the helm locked and the
 * engines idle (so it stays put however long the comms run).
 */
function holdPlayerAt(ctx, position, facing) {
    const player = ctx.world.player;
    if (!player) return;
    ctx.world.controlsLocked = true;
    player.position.fromArray(position);
    lookRotation(scratchFleetFacing.fromArray(facing), player.quaternion);
    player.velocity.set(0, 0, 0);
    player.speed = 0;
    player.throttle = 0;
}

/** The ship sits in the arrival hangar, out of sight, while the station's crews work on it. */
function berthPlayer(ctx) {
    holdPlayerAt(ctx, ARRIVAL_HANGAR, [0, 0, 1]);
    ctx.world.screenFade = 1;
}

/** The ship leaves the hangar repaired: full hull, full shields, torpedo tubes reloaded. */
function repairPlayer(ctx) {
    const player = ctx.world.player;
    if (!player) return;
    player.hull = player.maxHull;
    player.shield = player.maxShield;
    for (const weapon of player.weapons) {
        if (weapon.def.capacity) weapon.ammo = weapon.def.capacity;
    }
}

const lantern = [
    // An older save made here, when it was the epilogue's, now carries on into the Barrens.
    checkpoint('eclipse-down'),
    chapter('lantern'),
    music('calm'),
    escort(null),
    say('vega', 'lantern.vega.mayday'),
    say('okoro', 'lantern.okoro.mayday'),
    say('tim', 'lantern.tim.barrens'),
    // The fleet's drives need time after the Eclipse; the Kestrel goes on ahead alone.
    say('tim', 'lantern.tim.goAhead'),
    run(sendFleetAhead),
    warp('lantern', { arrive: dressLantern }),
    wait(2),

    // Dock: the amber lights run towards the station.
    say('okoro', 'lantern.okoro.approach'),
    objective('objective.dock'),
    hint('hint.arrivalLane'),
    waypoint({ anchor: TAG.LANTERN, offset: ARRIVAL_MOUTH }, 'waypoint.dock'),
    say('vega', 'lantern.vega.station', { wait: false }),
    waitUntil((ctx) => ctx.world.player.position.distanceTo(ARRIVAL_MOUTH_POINT) < 450),
    hint(null),
    waypoint(null),
    objective(null),
    say('okoro', 'lantern.okoro.clamps', { wait: false }),
    glide({ to: { anchor: TAG.LANTERN, offset: DOCK_APPROACH }, facing: [0, 0, 1], seconds: 4, release: false }),
    // Through the door: the screen goes dark just as the ship passes it.
    background('dockFade', [wait(1.6), fade(1, 1.8)]),
    glide({ to: { anchor: TAG.LANTERN, offset: ARRIVAL_HANGAR }, facing: [0, 0, 1], seconds: 4.5, release: false }),
    run(berthPlayer),
    hint('hint.docked'),
    say('okoro', 'lantern.okoro.barrens'),
    say('tim', 'lantern.tim.oldPattern'),
    say('okoro', 'lantern.okoro.penumbra'),
    // Refit: the player spends upgrade points on the ship (config/refit.js).
    say('okoro', 'lantern.okoro.refit', { wait: false }),
    refit(REFIT.pointsAtLantern),

    // Losing the Kestrel from here on sends the player back to this point: the whole battle again.
    checkpoint('lantern-docked'),
    run(berthPlayer),
    run(sendFleetAhead),
    music('battle'),
    run((ctx) => ctx.stage.playCue('alarm')),
    say('okoro', 'lantern.okoro.contacts'),
    spawn('warden', { group: 'vanguard', faceTag: TAG.LANTERN, at: { anchor: TAG.LANTERN, offset: [0, 300, -8200] } }),
    spawn('corvette', { count: 2, group: 'vanguard', spacing: 500, faceTag: TAG.LANTERN, at: { anchor: TAG.LANTERN, offset: [-1800, -200, -7200] } }),
    spawn('drone', { count: 4, group: 'vanguard', at: { anchor: TAG.LANTERN, offset: [600, 200, -6200] } }),
    spawn('raider', { count: 2, group: 'vanguard', at: { anchor: TAG.LANTERN, offset: [-600, 400, -6400] } }),
    say('tim', 'lantern.tim.stall'),

    // Undock with Lantern's fighter wing: the white lights run away from the station.
    say('okoro', 'lantern.okoro.undock', { wait: false }),
    hint('hint.departureLane'),
    run((ctx) => {
        holdPlayerAt(ctx, DEPARTURE_HANGAR, [0, 0, -1]);
        repairPlayer(ctx);
    }),
    background('undockFade', [wait(1.6), fade(0, 2)]),
    glide({ to: { anchor: TAG.LANTERN, offset: UNDOCK_EXIT }, facing: [0, 0, -1], seconds: 6, release: false }),
    run(launchLanternWing),
    glide({ to: { anchor: TAG.LANTERN, offset: UNDOCK_CLEAR }, facing: [0, 0, -1], seconds: 9, throttle: 0.8 }),
    hint(null),
    objective('objective.vanguard', remainingIn('vanguard')),
    say('okoro', 'lantern.okoro.wing', { wait: false }),
    // The carrier arrives once its screen is thinning out and the cruiser leading it is gone, or
    // after a while regardless, when a cruiser still standing falls back to it.
    waitUntil((ctx) => ctx.world.countGroup('vanguard') <= 2 && !vanguardCruiser(ctx), { timeout: VANGUARD_SECONDS }),
    run((ctx) => {
        const cruiser = vanguardCruiser(ctx);
        if (cruiser) {
            cruiser.ai.mode = 'flee';
            cruiser.despawnTimer = 6;
        }
    }),

    // The carrier: hold on until the fleet arrives, and crack its shield meanwhile.
    run((ctx) => {
        ctx.stage.playCue('alarm');
        spawnPenumbra(ctx, { tag: TAG.PENUMBRA, at: { anchor: TAG.LANTERN, offset: [2600, 900, -9800] }, faceTag: TAG.LANTERN });
    }),
    bossBar(TAG.PENUMBRA),
    say('umbra', 'lantern.umbra.claim'),
    say('okoro', 'lantern.okoro.carrier'),
    say('tim', 'lantern.tim.holdOn'),
    objective('objective.carrierStall'),
    hint('hint.carrier'),
    run((ctx) => { ctx.vars.carrierFlights = LANTERN_CARRIER_FLIGHTS; }),
    carrierLaunches('carriers'),
    // The fleet comes in only once the player has broken the carrier's shield and its hull has
    // started to go (the "three minutes" in the comms is flavour, not a timer).
    waitUntil(carrierBleeding),
    hint(null),

    // Tim's fleet jumps in to finish it. From here, losing the Dawnbreaker fails the mission.
    run(fleetJumpsIn),
    run((ctx) => ctx.stage.playCue('alarm')),
    escort(TAG.DAWNBREAKER),
    dawnbreakerWarnings(),
    say('tim', 'lantern.tim.arrive'),
    objective('objective.carrier'),
    spawn('corvette', { group: 'vanguard', faceTag: TAG.DAWNBREAKER, at: around(TAG.PENUMBRA, 2800) }),
    spawn('lancer', { count: 2, group: 'vanguard', targetTag: TAG.DAWNBREAKER, at: around(TAG.PENUMBRA, 2200) }),
    waitUntil((ctx) => hullOf(ctx, TAG.PENUMBRA) < 0.5 || !shipByTag(ctx, TAG.PENUMBRA)),
    say('rhea', 'lantern.rhea.bleeding', { wait: false }),
    waitForGroup('carriers'),
    stopBackground('carrierLaunches:carriers'),
    stopBackground(`hullWarnings:${TAG.DAWNBREAKER}`),
    bossBar(null),
    run(umbraRetreats),
    objective(null),
    say('vega', 'lantern.vega.carrierDown'),
    music('calm'),
    wait(5),
    escort(null),
    say('okoro', 'lantern.okoro.thanks'),
    say('okoro', 'lantern.okoro.muster'),
    say('tim', 'lantern.tim.strike'),
    // Lantern's yards patch the fleet up, and the station's four frigates join it for the strike.
    run((ctx) => completeFleet(ctx)),
    say('okoro', 'lantern.okoro.militia'),

    checkpoint('lantern-saved'),
    reviveFleetOnReload(),
    objective('objective.formUp'),
    waypoint({ anchor: TAG.DAWNBREAKER, offset: [0, 420, 0] }, 'waypoint.formUp'),
    waitUntil((ctx) => distanceToTag(ctx, TAG.DAWNBREAKER) < 450),
    waypoint(null),
    objective(null),
    say('tim', 'muster.tim.jump'),
    warp('muster', { bring: [TAG.DAWNBREAKER, TAG.FLEET], arrive: dressMuster }),
];

// ---- Chapter 7: The Muster -------------------------------------------------------------------

/** Where the three carriers wait, in a loose line across the fleet's path. */
const MUSTER_CARRIERS = [
    { tag: 'penumbraA', offset: [-3600, 400, -1600] },
    { tag: 'penumbraB', offset: [3800, -300, -2400] },
    { tag: 'penumbraC', offset: [300, 900, -5200] },
];

function dressMuster(ctx) {
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

const muster = [
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

// ---- Epilogue: Home -----------------------------------------------------------------------

/** The fleet drops out of warp in formation off Earth. */
const arrangeFleetAtEarth = (ctx) => parkFleet(ctx, [0, 0, 0], [0, 0, -1]);

const home = [
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

/** The full campaign, in order. */
export const CAMPAIGN = Object.freeze([...prologue, ...interdiction, ...graveyard, ...theForge, ...holdTheLine, ...eclipse, ...lantern, ...muster, ...home]);

/** The sector a brand new game starts in. */
export const STARTING_SECTOR = 'collapse';
