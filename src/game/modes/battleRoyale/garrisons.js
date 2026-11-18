import { Vector3 } from 'three';
import { randomUnitVector } from '../../core/math.js';

const scratchOffset = new Vector3();

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
 * Puts one side's ships on guard at a zone's station, inside its ring.
 * @param {import('../../net/server/Zone.js').Zone} zone
 * @param {import('./station.js').Station} station
 * @param {string} faction
 * @param {[string, number][]} ships `[classId, count]`
 * @param {object} layout BATTLE_ROYALE.garrisons (offsets and spacing)
 * @param {boolean} onGuard true when it has the planet to itself (see `guardRange`)
 */
export function stationGarrison(zone, station, faction, ships, layout, onGuard) {
    const { world } = zone;
    const centre = station.toWorld(layout.offsets[faction], new Vector3());
    const quaternion = station.berthQuaternion.toArray();
    const spawned = [];
    for (const [classId, count] of ships) {
        for (let i = 0; i < count; i++) {
            randomUnitVector(world.rng, scratchOffset);
            scratchOffset.y *= 0.4;
            const position = centre.clone().addScaledVector(scratchOffset, layout.spacing * (1 + world.rng() * 2));
            spawned.push(world.spawnShip(classId, {
                faction, position, quaternion, group: garrisonGroup(faction), engageRange: onGuard ? layout.guardRange : Infinity,
            }));
        }
    }
    return spawned;
}

export const garrisonGroup = (faction) => `garrison:${faction}`;

/**
 * Brings reinforcements out of warp behind `ship`, on its side.
 * @param {string[]} [tags] given to every ship (a squad's, squads.js)
 * @returns {object[]} the ships that arrived
 */
export function callReinforcements(zone, ship, classId, count, distance, tags = []) {
    const { world } = zone;
    const behind = new Vector3(0, 0, 1).applyQuaternion(ship.quaternion);
    const spawned = [];
    for (let i = 0; i < count; i++) {
        randomUnitVector(world.rng, scratchOffset);
        const position = ship.position.clone().addScaledVector(behind, distance).addScaledVector(scratchOffset, 120);
        spawned.push(world.spawnShip(classId, {
            faction: ship.faction, position, quaternion: ship.quaternion.toArray(), group: garrisonGroup(ship.faction), tags, warpIn: true,
        }));
    }
    return spawned;
}
