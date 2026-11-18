import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { lookRotation } from '../../core/math.js';
import { background, repeatWhile, run, spawnShips, wait, waitUntil } from '../beats.js';
import { TAG, shipByTag, underBattleBudget } from './common.js';

/**
 * Tim's fleet and the Penumbra carriers, shared by the last chapters (Lantern, the Muster, Home).
 */

/** The Penumbra carriers' gun batteries and hangar (config/shipClasses.js `carrier`). */
const { cannonMounts: PENUMBRA_CANNON_MOUNTS, hangar: PENUMBRA_HANGAR } = SHIP_CLASSES.penumbra.carrier;
/** Seconds between two carrier launches (one carrier launches each time; see launchFromCarriers). */
const CARRIER_LAUNCH_SECONDS = 22;

const scratchFleetOffset = new Vector3();
const scratchFleetFacing = new Vector3();
const scratchFleetHeading = new Quaternion();

/**
 * Parks the Dawnbreaker at `centre`, nose along `facing`, with every ship of the fleet in two
 * columns either side of her. `hold` keeps the escorts in place (no enemies to chase).
 */
export function parkFleet(ctx, centre, facing, { hold = true } = {}) {
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
export function spawnPenumbra(ctx, { tag, at, faceTag, group = 'carriers', cannons = PENUMBRA_CANNON_MOUNTS.length }) {
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
export const carrierLaunches = (group) => background(`carrierLaunches:${group}`, [
    repeatWhile((ctx) => ctx.world.countGroup(group) > 0 && (ctx.vars.carrierFlights ?? 0) > 0, [
        wait(CARRIER_LAUNCH_SECONDS),
        waitUntil((ctx) => underBattleBudget(ctx, 3)),
        run((ctx) => {
            launchFromCarriers(ctx, group);
            ctx.vars.carrierFlights -= 1;
        }),
    ]),
]);

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
export function completeFleet(ctx, { warpIn = false } = {}) {
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
export const reviveFleetOnReload = () => run((ctx) => {
    if (ctx.director.resumed) completeFleet(ctx, { warpIn: true });
});
