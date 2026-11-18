import { Vector3 } from 'three';
import { forwardOf, randomUnitVector, rightOf, upOf } from '../../core/math.js';

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
 * Brings reinforcements out of warp near `ship`, on its side, where its pilot sees them come:
 * noses along the caller's heading, they streak in past the cockpit and brake in front of it,
 * with the story's arrival effects (scene/effects/WarpArrivalEffects.js; every device that
 * shows the zone plays them, as it does for any ship that arrives).
 * @param {object} layout BATTLE_ROYALE.summon (count and landing spots, see reinforcementSpots)
 * @param {string[]} [tags] given to every ship (a squad's, squads.js)
 * @returns {object[]} the ships that arrived
 */
export function callReinforcements(zone, ship, classId, layout, tags = []) {
    const { world } = zone;
    return reinforcementSpots(world, ship, layout).map((position) => world.spawnShip(classId, {
        faction: ship.faction, position, quaternion: ship.quaternion.toArray(), group: garrisonGroup(ship.faction), tags, warpIn: true,
    }));
}

const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchForward = new Vector3();

/**
 * Where called reinforcements land. In the caller's own axes: `ahead` metres in front, spread
 * over an arc of `arc` radians above its line of sight, `ring` metres out from it (the middle of
 * the arc straight above it), give or take `scatter`. Above, not below, so a
 * cockpit's dashboard never hides them, and off the line of fire. A spot inside or too near a
 * hull or a rock (`clearance` metres: a caller nosing into the station's dock, say) is mirrored
 * behind the caller, where it has just come from.
 * @param {import('../../core/World.js').World} world
 * @param {object} ship the caller's
 * @param {{ count: number, ahead: number, ring: number, arc: number, scatter: number, clearance: number }} layout
 * @returns {Vector3[]}
 */
export function reinforcementSpots(world, ship, { count, ahead, ring, arc, scatter, clearance }) {
    rightOf(ship.quaternion, scratchRight);
    upOf(ship.quaternion, scratchUp);
    forwardOf(ship.quaternion, scratchForward);
    const spots = [];
    for (let i = 0; i < count; i++) {
        const angle = count > 1 ? arc * (i / (count - 1) - 0.5) : 0;
        randomUnitVector(world.rng, scratchOffset);
        const spot = ship.position.clone()
            .addScaledVector(scratchRight, Math.sin(angle) * ring)
            .addScaledVector(scratchUp, Math.cos(angle) * ring)
            .addScaledVector(scratchOffset, scatter);
        const behind = spot.clone().addScaledVector(scratchForward, -ahead);
        spot.addScaledVector(scratchForward, ahead);
        spots.push(isClear(world, spot, clearance, ship) || !isClear(world, behind, clearance, ship) ? spot : behind);
    }
    return spots;
}

/** True when nothing but `except` - no hull, no rock - is within `clearance` metres of `point`. */
function isClear(world, point, clearance, except) {
    for (const other of world.ships) {
        if (other.alive && other !== except && other.distanceToPoint(point, clearance) < clearance) return false;
    }
    for (const rock of world.obstacles) {
        if (rock.alive && rock.position.distanceTo(point) < rock.radius + clearance) return false;
    }
    return true;
}
