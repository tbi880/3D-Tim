import { Vector3 } from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { REFIT } from '../../config/refit.js';
import { lookRotation } from '../../core/math.js';
import {
    background, bossBar, chapter, checkpoint, escort, fade, glide, hint, music, objective, refit, run, say, spawn,
    spawnShips, stopBackground, wait, waitForGroup, waitUntil, warp, waypoint,
} from '../beats.js';
import { TAG, around, dawnbreakerWarnings, distanceToTag, hullOf, remainingIn, shipByTag, umbraRetreats } from './common.js';
import { carrierLaunches, completeFleet, reviveFleetOnReload, spawnPenumbra } from './fleet.js';
import { dressMuster } from './muster.js';

/**
 * Chapter 6: Lantern. The station, docking for repairs, and the carrier battle Tim's fleet
 * jumps into.
 */

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
/** Flights the lone carrier's hangars hold, for the whole battle. */
const LANTERN_CARRIER_FLIGHTS = 6;
/** Longest the carrier at Lantern waits for its vanguard to be broken before it comes in anyway. */
const VANGUARD_SECONDS = 150;

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

/** The warden leading Lantern's attackers, while it is still in the fight. */
const vanguardCruiser = (ctx) => ctx.world.getGroup('vanguard').find((ship) => ship.classId === 'warden' && ship.ai.mode !== 'flee') ?? null;

const scratchFacing = new Vector3();

/**
 * Holds the player's ship at `position`, nose along `facing`, with the helm locked and the
 * engines idle (so it stays put however long the comms run).
 */
function holdPlayerAt(ctx, position, facing) {
    const player = ctx.world.player;
    if (!player) return;
    ctx.world.controlsLocked = true;
    player.position.fromArray(position);
    lookRotation(scratchFacing.fromArray(facing), player.quaternion);
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

export const lantern = [
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
