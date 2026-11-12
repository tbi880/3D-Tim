import { FACTION } from './gameConfig.js';

/**
 * Ship class table. Adding a ship means adding one entry here, a model with the same
 * `model` id (see tools/game-models/build_models.py and scene/models/ShipModel.jsx) and
 * its name in both i18n files.
 *
 * Sizes follow EVE-style tiers, in metres: fighters ~15-30, corvette 130, frigate 280,
 * cruiser 520, the Dawnbreaker 1400, the Eclipse 3400.
 *
 * behavior:
 *   'player'  - flown by the human (systems/playerFlight.js)
 *   'fighter' - attack run / break away loop
 *   'bomber'  - approaches capital ships, launches torpedoes, retreats, repeats
 *   'capital' - ship of the line that keeps a stand-off distance; fights with turrets
 *   'module'  - destructible part mounted on a parent ship (generators, turrets, reactors)
 *   'static'  - does nothing (stations, wrecks, the log buoy)
 *
 * kind: 'fighter' | 'capital' | 'station' | 'module' | 'object' - what others treat it as.
 *
 * Hit shape: `radius` alone is a sphere (small craft, modules). Bigger ships use boxes that
 * turn with the ship: `halfExtents` [x, y, z] is one box around the centre; `hitBoxes`
 * [[cx, cy, cz, hx, hy, hz], ...] is several, for hulls a single box would wrap too
 * loosely (the Eclipse's blades, the Forge's dock). Boxes hug the solid hull and leave out
 * antennae and fins, so near misses do not count and modules mounted on the hull stay reachable.
 *
 * ai.prefers lists target kinds in order of preference
 * ('player', 'bomber', 'fighter', 'capital').
 */
export const SHIP_CLASSES = Object.freeze({
    // ---- Dawn fleet ---------------------------------------------------------------------
    kestrel: {
        nameKey: 'ship.kestrel', faction: FACTION.DAWN, behavior: 'player', kind: 'fighter',
        model: 'kestrel', radius: 9,
        hull: 130, shield: 120, shieldRegen: 12, shieldDelay: 3.5,
        maxSpeed: 150, turnRate: 1.2, acceleration: 110,
        weapons: ['playerBeam', 'playerTorpedo'],
    },
    dawnbreaker: {
        nameKey: 'ship.dawnbreaker', faction: FACTION.DAWN, behavior: 'capital', kind: 'capital',
        model: 'dawnbreaker', radius: 640, halfExtents: [215, 80, 640],
        hull: 3000, shield: 0, shieldRegen: 14, shieldDelay: 8,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: ['pointDefenseBeam', 'pointDefenseBeam', 'pointDefenseBeam'],
        ai: { mode: 'hold' },
    },
    harrier: {
        nameKey: 'ship.harrier', faction: FACTION.DAWN, behavior: 'capital', kind: 'capital',
        model: 'harrier', radius: 140,
        hitBoxes: [[0, 0, 0, 30, 22, 135], [-68, 10, 75, 12, 11, 66], [68, 10, 75, 12, 11, 66]],
        hull: 1400, shield: 340, shieldRegen: 9, shieldDelay: 6,
        maxSpeed: 55, turnRate: 0.28, acceleration: 16,
        weapons: ['frigateBeam', 'frigateBeam', 'frigateTorpedo'],
        ai: { standoff: 1300, prefers: ['capital', 'fighter'] },
    },
    dart: {
        nameKey: 'ship.dart', faction: FACTION.DAWN, behavior: 'fighter', kind: 'fighter',
        model: 'dart', radius: 7,
        hull: 60, shield: 40, shieldRegen: 5, shieldDelay: 5,
        maxSpeed: 140, turnRate: 1.5, acceleration: 90,
        weapons: ['dartBolt'],
        ai: { attackRange: 800, breakDistance: 130, prefers: ['bomber', 'fighter', 'capital'] },
    },
    buoy: {
        nameKey: 'ship.buoy', faction: FACTION.NEUTRAL, behavior: 'static', kind: 'object',
        model: 'buoy', radius: 12,
        hull: 1, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [], invulnerable: true, targetable: false,
    },
    wreck: {
        nameKey: 'ship.wreck', faction: FACTION.NEUTRAL, behavior: 'static', kind: 'object',
        model: 'wreck', radius: 95, halfExtents: [28, 18, 92],
        hull: 1, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [], invulnerable: true, targetable: false,
    },

    // ---- Umbra --------------------------------------------------------------------------
    drone: {
        nameKey: 'ship.drone', faction: FACTION.UMBRA, behavior: 'fighter', kind: 'fighter',
        model: 'drone', radius: 6.5,
        hull: 30, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 130, turnRate: 1.45, acceleration: 85,
        weapons: ['droneBolt'],
        ai: { attackRange: 650, breakDistance: 110, prefers: ['player', 'fighter', 'capital'] },
    },
    raider: {
        nameKey: 'ship.raider', faction: FACTION.UMBRA, behavior: 'fighter', kind: 'fighter',
        model: 'raider', radius: 9,
        hull: 48, shield: 36, shieldRegen: 4, shieldDelay: 5,
        maxSpeed: 120, turnRate: 1.15, acceleration: 70,
        weapons: ['raiderBolt'],
        ai: { attackRange: 760, breakDistance: 140, prefers: ['player', 'fighter', 'capital'] },
    },
    lancer: {
        nameKey: 'ship.lancer', faction: FACTION.UMBRA, behavior: 'bomber', kind: 'fighter',
        model: 'lancer', radius: 12,
        hull: 58, shield: 28, shieldRegen: 3, shieldDelay: 5,
        maxSpeed: 100, turnRate: 0.85, acceleration: 50,
        weapons: ['lancerTorpedo'],
        ai: { prefers: ['capital'], retreatTime: 7 },
    },
    corvette: {
        nameKey: 'ship.corvette', faction: FACTION.UMBRA, behavior: 'capital', kind: 'capital',
        model: 'corvette', radius: 65, halfExtents: [26, 12, 62],
        hull: 240, shield: 150, shieldRegen: 6, shieldDelay: 6,
        maxSpeed: 70, turnRate: 0.4, acceleration: 22,
        weapons: ['turretBolt', 'turretBolt'],
        ai: { standoff: 700, prefers: ['player', 'capital'] },
    },
    warden: {
        nameKey: 'ship.warden', faction: FACTION.UMBRA, behavior: 'capital', kind: 'capital',
        model: 'warden', radius: 260,
        hitBoxes: [[0, -11, 65, 43, 38, 190], [-50, -11, -95, 18, 25, 135], [50, -11, -95, 18, 25, 135]],
        hull: 460, shield: 280, shieldRegen: 7, shieldDelay: 6,
        maxSpeed: 34, turnRate: 0.14, acceleration: 9,
        weapons: ['turretBolt', 'turretBolt', 'cruiserBeam'],
        ai: { standoff: 1400, prefers: ['capital', 'player'] },
    },
    eclipse: {
        nameKey: 'ship.eclipse', faction: FACTION.UMBRA, behavior: 'capital', kind: 'capital',
        model: 'eclipse', radius: 1700,
        // Aft hull, fore hull, the two blades, the citadel.
        hitBoxes: [
            [0, -147, 722, 543, 388, 920], [0, -147, -586, 330, 252, 388],
            [-795, -147, -199, 155, 349, 1017], [795, -147, -199, 155, 349, 1017],
            [0, 483, 722, 213, 252, 368],
        ],
        hull: 4000, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: ['eclipseLance', 'turretBolt', 'turretBolt', 'cruiserBeam'],
        ai: { mode: 'hold', prefers: ['capital'] },
    },
    shieldGenerator: {
        nameKey: 'ship.shieldGenerator', faction: FACTION.UMBRA, behavior: 'module', kind: 'module',
        model: 'shieldGenerator', radius: 75,
        hull: 230, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [],
    },
    forge: {
        nameKey: 'ship.forge', faction: FACTION.UMBRA, behavior: 'static', kind: 'station',
        model: 'forge', radius: 1500,
        // The keel dock and the habitat drum; the slipway arches can be flown through.
        hitBoxes: [[0, 0, -290, 175, 155, 1210], [0, 0, 1235, 350, 330, 270]],
        hull: 1, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [], invulnerable: true, targetable: false,
    },
    tractorEmitter: {
        nameKey: 'ship.tractorEmitter', faction: FACTION.UMBRA, behavior: 'module', kind: 'module',
        model: 'tractorEmitter', radius: 55,
        hull: 200, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [],
    },
    reactor: {
        nameKey: 'ship.reactor', faction: FACTION.UMBRA, behavior: 'module', kind: 'module',
        model: 'reactor', radius: 85,
        hull: 520, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [],
    },
    stationTurret: {
        nameKey: 'ship.stationTurret', faction: FACTION.UMBRA, behavior: 'module', kind: 'module',
        model: 'stationTurret', radius: 42,
        hull: 150, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: ['turretBolt'],
    },
});
