import { FACTION } from './gameConfig.js';

/**
 * Ship class table. Adding a new ship means adding one entry here plus (optionally) a
 * model builder in scene/models/shipModels.js with the same `model` id.
 *
 * behavior:
 *   'player'  - flown by the human (systems/playerFlight.js)
 *   'fighter' - attack run / break away loop
 *   'bomber'  - approaches capital ships, launches torpedoes, retreats, repeats
 *   'capital' - slow ship of the line that keeps a stand-off distance; fights with turrets
 *   'module'  - destructible part mounted on a parent ship (shield generators)
 *   'static'  - does nothing (scenery such as the log buoy)
 *
 * radius / halfLength describe the hit shape: a capsule along the ship's nose axis.
 * ai.prefers lists target kinds in order of preference
 * ('player', 'bomber', 'fighter', 'capital').
 */
export const SHIP_CLASSES = Object.freeze({
    // ---- Dawn fleet ---------------------------------------------------------------------
    kestrel: {
        nameKey: 'ship.kestrel', faction: FACTION.DAWN, behavior: 'player', kind: 'fighter',
        model: null, radius: 9, halfLength: 0,
        hull: 130, shield: 120, shieldRegen: 12, shieldDelay: 3.5,
        maxSpeed: 115, turnRate: 1.2, acceleration: 85,
        weapons: ['playerBeam', 'playerTorpedo'],
    },
    dawnbreaker: {
        nameKey: 'ship.dawnbreaker', faction: FACTION.DAWN, behavior: 'capital', kind: 'capital',
        model: 'dawnbreaker', radius: 95, halfLength: 250,
        hull: 3000, shield: 0, shieldRegen: 14, shieldDelay: 8,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: ['pointDefenseBeam', 'pointDefenseBeam'],
        ai: { mode: 'hold' },
    },
    harrier: {
        nameKey: 'ship.harrier', faction: FACTION.DAWN, behavior: 'capital', kind: 'capital',
        model: 'harrier', radius: 32, halfLength: 55,
        hull: 520, shield: 320, shieldRegen: 9, shieldDelay: 6,
        maxSpeed: 42, turnRate: 0.3, acceleration: 14,
        weapons: ['frigateBeam', 'frigateBeam', 'frigateTorpedo'],
        ai: { standoff: 750, prefers: ['capital', 'fighter'] },
    },
    dart: {
        nameKey: 'ship.dart', faction: FACTION.DAWN, behavior: 'fighter', kind: 'fighter',
        model: 'dart', radius: 7, halfLength: 0,
        hull: 60, shield: 40, shieldRegen: 5, shieldDelay: 5,
        maxSpeed: 110, turnRate: 1.5, acceleration: 70,
        weapons: ['dartBolt'],
        ai: { attackRange: 700, breakDistance: 110, prefers: ['bomber', 'fighter', 'capital'] },
    },
    buoy: {
        nameKey: 'ship.buoy', faction: FACTION.NEUTRAL, behavior: 'static', kind: 'object',
        model: 'buoy', radius: 10, halfLength: 0,
        hull: 1, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [], invulnerable: true, targetable: false,
    },

    // ---- Umbra --------------------------------------------------------------------------
    drone: {
        nameKey: 'ship.drone', faction: FACTION.UMBRA, behavior: 'fighter', kind: 'fighter',
        model: 'drone', radius: 6.5, halfLength: 0,
        hull: 30, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 100, turnRate: 1.45, acceleration: 65,
        weapons: ['droneBolt'],
        ai: { attackRange: 560, breakDistance: 95, prefers: ['player', 'fighter', 'capital'] },
    },
    raider: {
        nameKey: 'ship.raider', faction: FACTION.UMBRA, behavior: 'fighter', kind: 'fighter',
        model: 'raider', radius: 9, halfLength: 0,
        hull: 48, shield: 36, shieldRegen: 4, shieldDelay: 5,
        maxSpeed: 92, turnRate: 1.15, acceleration: 55,
        weapons: ['raiderBolt'],
        ai: { attackRange: 660, breakDistance: 120, prefers: ['player', 'fighter', 'capital'] },
    },
    lancer: {
        nameKey: 'ship.lancer', faction: FACTION.UMBRA, behavior: 'bomber', kind: 'fighter',
        model: 'lancer', radius: 11, halfLength: 0,
        hull: 58, shield: 28, shieldRegen: 3, shieldDelay: 5,
        maxSpeed: 76, turnRate: 0.85, acceleration: 40,
        weapons: ['lancerTorpedo'],
        ai: { prefers: ['capital'], retreatTime: 7 },
    },
    warden: {
        nameKey: 'ship.warden', faction: FACTION.UMBRA, behavior: 'capital', kind: 'capital',
        model: 'warden', radius: 38, halfLength: 85,
        hull: 430, shield: 260, shieldRegen: 7, shieldDelay: 6,
        maxSpeed: 26, turnRate: 0.16, acceleration: 8,
        weapons: ['turretBolt', 'turretBolt', 'cruiserBeam'],
        ai: { standoff: 800, prefers: ['capital', 'player'] },
    },
    eclipse: {
        nameKey: 'ship.eclipse', faction: FACTION.UMBRA, behavior: 'capital', kind: 'capital',
        model: 'eclipse', radius: 150, halfLength: 420,
        hull: 4000, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0.02, acceleration: 0,
        weapons: ['eclipseLance', 'turretBolt', 'turretBolt', 'turretBolt', 'cruiserBeam'],
        ai: { mode: 'hold', prefers: ['capital'] },
    },
    shieldGenerator: {
        nameKey: 'ship.shieldGenerator', faction: FACTION.UMBRA, behavior: 'module', kind: 'module',
        model: 'shieldGenerator', radius: 30, halfLength: 0,
        hull: 210, shield: 0, shieldRegen: 0, shieldDelay: 0,
        maxSpeed: 0, turnRate: 0, acceleration: 0,
        weapons: [],
    },
});
