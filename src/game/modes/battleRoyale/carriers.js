import { Vector3 } from 'three';
import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { areHostile } from '../../core/systems/damage.js';
import { isValidTarget } from '../../core/systems/targeting.js';
import { garrisonGroup } from './garrisons.js';

/**
 * The Umbra's motherships in a match ('penumbra' in a garrison list, BATTLE_ROYALE.carrier).
 * Far too big for a station's ring, a carrier holds station outside it and never moves from
 * there: its own beam and the two gun batteries bolted on its blades guard it, and its hangar
 * puts out flights of fighters - drones, or torpedo bombers when an enemy ship of the line is
 * there - for as long as an enemy is near and the hangar holds out. (In the story the chapters
 * launch the Penumbras' fighters: story/chapters/fleet.js.)
 */

const scratchPoint = new Vector3();
const scratchFacing = new Vector3();

/** Tag of a match's carrier `id`, and of the fighters it has launched. */
export const carrierTag = (id) => `carrier:${id}`;
export const wingTag = (id) => `wing:${id}`;

/**
 * Brings a carrier into a zone at its berth by the station, turned to face the station, with its
 * gun batteries on, and clears the rocks out of its way.
 * @param {import('../../net/server/Zone.js').Zone} zone
 * @param {import('./station.js').Station} station
 * @param {string} faction
 * @param {object} layout BATTLE_ROYALE.carrier
 * @param {number} id the match's number for it (carrierTag)
 * @returns {object} the carrier's hull
 */
export function berthCarrier(zone, station, faction, layout, id) {
    const { world } = zone;
    const position = station.toWorld(layout.berth, new Vector3());
    scratchFacing.copy(station.ship.position).sub(position).normalize();
    const carrier = world.spawnShip(layout.classId, {
        faction, position, facing: scratchFacing.toArray(),
        group: garrisonGroup(faction), tags: [carrierTag(id)], aiMode: 'hold',
    });
    for (const mountOffset of SHIP_CLASSES[layout.classId].carrier.cannonMounts) {
        world.spawnShip(layout.cannonClassId, { faction, parent: carrier, mountOffset, group: garrisonGroup(faction) });
    }
    for (const rock of world.obstacles) {
        if (rock.alive && carrier.distanceToPoint(rock.position) < rock.radius + layout.clearance) zone.clearRock(rock);
    }
    return carrier;
}

/**
 * True when anything `carrier` would fight is within `alertRange` metres of its hull, or
 * within `dockRange` of the dock it guards.
 */
function enemyNear(world, carrier, dock, { alertRange, dockRange }) {
    for (const ship of world.ships) {
        if (!isValidTarget(ship) || ship.arriving || ship.invulnerable || !areHostile(carrier, ship)) continue;
        if (ship.position.distanceToSquared(dock) <= dockRange * dockRange) return true;
        if (carrier.distanceToPoint(ship.position, alertRange) <= alertRange) return true;
    }
    return false;
}

/** True when there is an enemy ship of the line in the zone for torpedo bombers to go after. */
function enemyCapitalIn(world, carrier) {
    return world.ships.some((ship) => isValidTarget(ship) && !ship.invulnerable && ship.cls.kind === 'capital' && areHostile(carrier, ship));
}

/**
 * A carrier's hangar: how many flights it still holds and when the next one goes. It only
 * counts down while an enemy is near the carrier or the dock it guards; when the first one
 * comes, the first flight is out `scramble` seconds later. No flight goes while `wingMax` of
 * its fighters fly.
 */
export class Hangar {
    /**
     * @param {object} options
     * @param {number} options.id the match's number for the carrier (carrierTag)
     * @param {object} options.ship the carrier's hull
     * @param {import('three').Vector3} options.dock the mouth of the dock it guards (station.js Station `mouth`)
     * @param {object} options.layout BATTLE_ROYALE.carrier
     * @param {number} [options.flightsLeft]
     * @param {number} [options.launchIn] seconds (of alert) to the next flight
     */
    constructor({ id, ship, dock, layout, flightsLeft = layout.flights, launchIn = layout.scramble }) {
        this.id = id;
        this.ship = ship;
        this.dock = dock;
        this.layout = layout;
        this.flightsLeft = flightsLeft;
        this.launchIn = launchIn;
    }

    /** False once the carrier is gone (destroyed, or swallowed with its planet). */
    get alive() {
        return this.ship.alive;
    }

    /** The fighters of this carrier's that are flying. */
    wingIn(world) {
        const tag = wingTag(this.id);
        let count = 0;
        for (const ship of world.ships) if (ship.alive && ship.tags.has(tag)) count += 1;
        return count;
    }

    /** @param {import('../../core/World.js').World} world the carrier's zone's */
    update(world, dt) {
        const { ship, layout } = this;
        if (!ship.alive || this.flightsLeft <= 0) return;
        if (!enemyNear(world, ship, this.dock, layout)) {
            this.launchIn = Math.max(this.launchIn, layout.scramble);
            return;
        }
        this.launchIn -= dt;
        if (this.launchIn > 0 || this.wingIn(world) >= layout.wingMax) return;
        this.launch(world);
    }

    /** One flight out of the hangar, under the aft hull, dropping clear of it. */
    launch(world) {
        const { ship, layout } = this;
        const bombers = enemyCapitalIn(world, ship) && world.rng() < layout.lancerChance;
        const [classId, count] = bombers ? ['lancer', layout.lancers] : ['drone', layout.drones];
        scratchPoint.fromArray(SHIP_CLASSES[layout.classId].carrier.hangar).applyQuaternion(ship.quaternion).add(ship.position);
        scratchFacing.set(0, -1, 0).applyQuaternion(ship.quaternion);
        for (let i = 0; i < count; i++) {
            const position = scratchPoint.clone().addScaledVector(scratchFacing, 40 * i);
            position.x += (world.rng() - 0.5) * 80;
            position.z += (world.rng() - 0.5) * 80;
            world.spawnShip(classId, {
                faction: ship.faction, position, facing: scratchFacing.toArray(), group: garrisonGroup(ship.faction), tags: [wingTag(this.id)],
            });
        }
        this.flightsLeft -= 1;
        this.launchIn = layout.launchSeconds;
    }

    /** For a checkpoint. */
    save() {
        return { id: this.id, flightsLeft: this.flightsLeft, launchIn: this.launchIn };
    }
}

/**
 * The hangars of a zone rebuilt from a checkpoint: one for each carrier still there, with what
 * the checkpoint says of it (one it says nothing of gets a full hangar).
 * @param {import('../../core/World.js').World} world the zone's, rebuilt
 * @param {import('./station.js').Station} station the zone's
 * @param {object[]} saved Hangar.save()'s, as the checkpoint has them (unchecked)
 * @param {object} layout BATTLE_ROYALE.carrier
 * @returns {Hangar[]}
 */
export function restoreHangars(world, station, saved, layout) {
    const notes = new Map((Array.isArray(saved) ? saved : []).filter((note) => Number.isInteger(note?.id)).map((note) => [note.id, note]));
    const hangars = [];
    for (const ship of world.ships) {
        if (!ship.alive || ship.classId !== layout.classId) continue;
        const id = carrierIdOf(ship);
        if (id === null) continue;
        const note = notes.get(id) ?? {};
        const count = (value, fallback) => (Number.isFinite(value) ? value : fallback);
        hangars.push(new Hangar({
            id, ship, layout, dock: station.mouth,
            flightsLeft: Math.max(0, Math.min(layout.flights, Math.floor(count(note.flightsLeft, layout.flights)))),
            launchIn: Math.max(0, Math.min(layout.launchSeconds, count(note.launchIn, layout.scramble))),
        }));
    }
    return hangars;
}

/** The match's number for a carrier, from its tag; null for any other ship. */
export function carrierIdOf(ship) {
    for (const tag of ship.tags) {
        const match = /^carrier:(\d+)$/.exec(tag);
        if (match) return Number(match[1]);
    }
    return null;
}
