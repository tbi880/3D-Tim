import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { SECTORS } from '../../config/sectors.js';
import { lookRotation } from '../../core/math.js';

/** Tag on every planet's station (scenery: it cannot be hurt or locked), and on the one that is the stargate. */
export const STATION_TAG = 'station';
export const GATE_TAG = 'stargate';

const scratchPoint = new Vector3();
const scratchClosest = new Vector3();

/**
 * Where a planet's station stands. The sector's start point is where ships drop out of
 * warp; the station is put straight ahead of it, turned so that its approach lane - the gap
 * in the ring that leads to the dock - runs from there to its door.
 * @param {{ position: number[], facing: number[] }} start the sector's `playerStart`
 * @param {object} layout BATTLE_ROYALE.station
 * @returns {{ position: Vector3, quaternion: Quaternion, lane: Vector3 }} `lane` is the unit direction ships fly in to dock
 */
export function stationPose(start, layout) {
    const lane = new Vector3().fromArray(start.facing).normalize();
    // The dock is on the station's +z side and ships (whose noses are their -z) fly into it along +z.
    const quaternion = lookRotation(lane.clone().negate(), new Quaternion());
    const arrival = new Vector3(layout.mouth[0], layout.mouth[1], -layout.arrival).applyQuaternion(quaternion);
    return { position: new Vector3().fromArray(start.position).sub(arrival), quaternion, lane };
}

/**
 * A planet's station as the rules use it: the hull in the zone's world, and the points of
 * its dock in the world's axes.
 */
export class Station {
    /**
     * @param {import('../../core/Ship.js').Ship} ship the station's hull
     * @param {Vector3} lane unit direction ships fly in to dock
     * @param {object} layout BATTLE_ROYALE.station
     */
    constructor(ship, lane, layout) {
        this.ship = ship;
        this.range = layout.range;
        /** The mouth of the dock: within `range` of it a ship can clamp on. */
        this.mouth = this.toWorld(layout.mouth, new Vector3());
        /** Where a docked ship is held, and how it is turned: nose to the door. */
        this.berth = this.toWorld(layout.berth, new Vector3());
        this.berthQuaternion = lookRotation(lane, new Quaternion());
    }

    /** A point given in the station's own axes, in the world's. */
    toWorld(local, out) {
        return out.fromArray(local).applyQuaternion(this.ship.quaternion).add(this.ship.position);
    }

    /** True when a ship at `position` is close enough to the dock's mouth to clamp on. */
    inRange(position) {
        return position.distanceToSquared(this.mouth) <= this.range * this.range;
    }

    /** Draws a docked ship to its berth and holds it there. */
    hold(ship, pull, dt) {
        const blend = 1 - Math.exp(-pull * dt);
        ship.position.lerp(this.berth, blend);
        ship.quaternion.slerp(this.berthQuaternion, blend);
        ship.velocity.set(0, 0, 0);
        ship.angularVelocity.set(0, 0, 0);
        ship.speed = 0;
        ship.throttle = 0;
    }
}

/**
 * Builds a zone's station (belonging to nobody: who holds it is the rules' business) and
 * clears the rocks out of its hull and its approach lane.
 * @param {import('../../net/server/Zone.js').Zone} zone
 * @param {object} layout BATTLE_ROYALE.station
 * @param {boolean} gate true for the station that is the stargate
 * @returns {Station}
 */
export function buildStation(zone, layout, gate) {
    const start = SECTORS[zone.sectorId].playerStart;
    const pose = stationPose(start, layout);
    const ship = zone.world.spawnShip(layout.classId, {
        faction: FACTION.NEUTRAL, position: pose.position, quaternion: pose.quaternion.toArray(),
        tags: gate ? [STATION_TAG, GATE_TAG] : [STATION_TAG], invulnerable: true, targetable: false,
    });
    const station = new Station(ship, pose.lane, layout);

    const arrival = scratchPoint.fromArray(start.position).clone();
    const laneLength = arrival.distanceTo(station.mouth);
    for (const rock of zone.world.obstacles) {
        const room = rock.radius + layout.clearance;
        // The lane: the straight line from where ships arrive to the mouth of the dock.
        const along = Math.min(laneLength, Math.max(0, scratchPoint.copy(rock.position).sub(arrival).dot(pose.lane)));
        scratchClosest.copy(arrival).addScaledVector(pose.lane, along);
        if (ship.distanceToPoint(rock.position) < room || scratchClosest.distanceTo(rock.position) < room) zone.clearRock(rock);
    }
    return station;
}
