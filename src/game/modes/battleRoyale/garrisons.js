import { Vector3 } from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { SECTORS } from '../../config/sectors.js';
import { randomUnitVector } from '../../core/math.js';

const scratchOffset = new Vector3();

/** Tag on the stargate itself (scenery: it cannot be hurt, locked or owned). */
export const GATE_TAG = 'stargate';
const GATE_CLASS = 'lanternStation';

/**
 * Decides what stands at each planet when the match starts: one side's garrison, or both
 * sides at each other's throats. Sides alternate from a random start so neither holds more
 * than the other, every third planet is a battle, and the stargate's planet always is.
 * @param {{ id: string, gate?: boolean }[]} planets innermost first
 * @param {string[]} factions the sides that have computer-flown ships
 * @param {() => number} rng 0..1
 * @returns {Map<string, string[]>} planet id -> sides present
 */
export function planGarrisons(planets, factions, rng) {
    const plan = new Map();
    const first = Math.floor(rng() * factions.length);
    const battleEvery = 3;
    const battleOffset = Math.floor(rng() * battleEvery);
    planets.forEach((planet, orbit) => {
        const battle = planet.gate || orbit % battleEvery === battleOffset;
        plan.set(planet.id, battle ? [...factions] : [factions[(first + orbit) % factions.length]]);
    });
    return plan;
}

/**
 * Puts one side's ships on station in a zone.
 * @param {import('../../net/server/Zone.js').Zone} zone
 * @param {string} faction
 * @param {[string, number][]} ships `[classId, count]`
 * @param {object} layout BATTLE_ROYALE.garrisons (offsets and spacing)
 * @param {boolean} onGuard true when it has the planet to itself (see `guardRange`)
 */
export function stationGarrison(zone, faction, ships, layout, onGuard) {
    const { world } = zone;
    const start = SECTORS[zone.sectorId].playerStart;
    const centre = new Vector3().fromArray(start.position).add(scratchOffset.fromArray(layout.offsets[faction]));
    const spawned = [];
    for (const [classId, count] of ships) {
        for (let i = 0; i < count; i++) {
            randomUnitVector(world.rng, scratchOffset);
            scratchOffset.y *= 0.4;
            const position = centre.clone().addScaledVector(scratchOffset, layout.spacing * (1 + world.rng() * 2));
            spawned.push(world.spawnShip(classId, {
                faction, position, facing: start.facing, group: garrisonGroup(faction), engageRange: onGuard ? layout.guardRange : Infinity,
            }));
        }
    }
    return spawned;
}

export const garrisonGroup = (faction) => `garrison:${faction}`;

/** The stargate: a ring station at the middle of the last planet's zone, belonging to nobody. */
export function buildStargate(zone) {
    return zone.world.spawnShip(GATE_CLASS, {
        faction: FACTION.NEUTRAL, position: [0, 0, 0], tags: [GATE_TAG], invulnerable: true, targetable: false,
    });
}

/**
 * Brings reinforcements out of warp behind `ship`, on its side.
 * @returns {object[]} the ships that arrived
 */
export function callReinforcements(zone, ship, classId, count, distance) {
    const { world } = zone;
    const behind = new Vector3(0, 0, 1).applyQuaternion(ship.quaternion);
    const spawned = [];
    for (let i = 0; i < count; i++) {
        randomUnitVector(world.rng, scratchOffset);
        const position = ship.position.clone().addScaledVector(behind, distance).addScaledVector(scratchOffset, 120);
        spawned.push(world.spawnShip(classId, {
            faction: ship.faction, position, quaternion: ship.quaternion.toArray(), group: garrisonGroup(ship.faction), warpIn: true,
        }));
    }
    return spawned;
}
