import { FACTION } from '../../config/gameConfig.js';
import { destroyShip } from '../../core/systems/damage.js';
import {
    background, chapter, checkpoint, escort, hint, music, objective, progress, repeatWhile, run, say, spawn, spawnShips,
    stopBackground, wait, waitForGroup, waitUntil, warp,
} from '../beats.js';
import { TAG, hullWarnings, remainingIn, shipByTag, smallHostiles } from './common.js';

/**
 * Chapter 3: The Forge. The Umbra shipyard holding the Osprey, and how it blows up.
 */

/** The Harrier arrives at the Forge with at least this fraction of her hull repaired. */
const HARRIER_PATCHED_HULL = 0.8;
/** Seconds between the Forge's reactors failing and the shipyard exploding. */
const FORGE_FUSE_SECONDS = 22;
const TRACTOR_COLOR = '#c04dff';

// Mount points on the shipyard model, in metres (the `markers` in scene/models/modelManifest.json,
// lifted a little so modules sit on the hull instead of in it).
const FORGE_SLIPWAY = [0, 670, 0];
const FORGE_TRACTOR_MOUNTS = [[0, 1177, -765], [507, 670, 0], [-507, 670, 765]];
const FORGE_REACTOR_MOUNTS = [[-823, 0, 1224], [823, 0, 1224]];
const FORGE_TURRET_MOUNTS = [[0, 250, -1052], [0, -250, 0], [0, 430, 1435]];

/** The shipyard with its defences, the captive Osprey in the slipway, and the Harrier at our side. */
export function dressForge(ctx) {
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

export const theForge = [
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
