import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { BATTLE_ROYALE, NPC_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { World } from '../../src/game/core/World.js';
import { Hangar, berthCarrier, carrierIdOf, carrierTag, restoreHangars, wingTag } from '../../src/game/modes/battleRoyale/carriers.js';
import { shipStrength } from '../../src/game/modes/battleRoyale/strategy.js';
import { GATE_TAG, buildGate, buildStation } from '../../src/game/modes/battleRoyale/station.js';
import { gameModeOf } from '../../src/game/modes/index.js';
import { MatchServer } from '../../src/game/net/server/MatchServer.js';
import { Zone } from '../../src/game/net/server/Zone.js';
import { createTestServer } from './support/matchHarness.js';

/**
 * The Umbra's motherships in a match (BATTLE_ROYALE.carrier, modes/battleRoyale/carriers.js):
 * a Penumbra holding station outside a planet's ring, its gun batteries on, launching fighters
 * while an enemy is near it or the dock.
 */

const { DAWN, UMBRA, PIRATE } = FACTION;
const LAYOUT = BATTLE_ROYALE.carrier;
const STEP = 1 / 30;

/** Roughly the gap between two ships' hulls: from each corner and middle of one's hit boxes to the other's hull. */
function hullGap(a, b) {
    let gap = Infinity;
    for (const [one, other] of [[a, b], [b, a]]) {
        for (const { centre, half } of one.boxes ?? []) {
            for (const corner of [[0, 0, 0], ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))]) {
                const point = new Vector3(...corner).multiply(half).add(centre).applyQuaternion(one.quaternion).add(one.position);
                gap = Math.min(gap, other.distanceToPoint(point));
            }
        }
    }
    return gap;
}

const carrierAt = (sectorId, faction = UMBRA) => {
    const zone = new Zone(sectorId, sectorId, { seed: 3, difficulty: BATTLE_ROYALE.difficulty });
    const station = buildStation(zone, BATTLE_ROYALE.station);
    const ship = berthCarrier(zone, station, faction, LAYOUT, 1);
    return { zone, station, ship, world: zone.world };
};

test('the Umbra garrisons bring a mothership; the Federation\'s do not', () => {
    for (const list of [BATTLE_ROYALE.garrisons[UMBRA], BATTLE_ROYALE.garrisons.gate[UMBRA]]) {
        assert.deepEqual(list.filter(([classId]) => classId === LAYOUT.classId).map(([, count]) => count), [1]);
    }
    for (const list of [BATTLE_ROYALE.garrisons[DAWN], BATTLE_ROYALE.garrisons.gate[DAWN]]) {
        assert.equal(list.some(([classId]) => classId === LAYOUT.classId), false);
    }
    assert.equal(SHIP_CLASSES[LAYOUT.classId].faction, UMBRA);
    assert.ok(BATTLE_ROYALE.score.ships[LAYOUT.classId] > BATTLE_ROYALE.score.ships.warden, 'the biggest prize there is');
});

test('a mothership holds station outside the ring, clear of the hull, the gate and the lane, beyond its guns\' reach of the dock', () => {
    const reach = Math.max(...[...SHIP_CLASSES[LAYOUT.classId].weapons, ...SHIP_CLASSES[LAYOUT.cannonClassId].weapons].map((id) => WEAPONS[id].range));
    for (const planet of STAR_SYSTEM.planets) {
        const { zone, station, ship, world } = carrierAt(planet.sectorId);
        if (planet.gate) buildGate(world, zone.sectorId, BATTLE_ROYALE.station, BATTLE_ROYALE.gate);
        const arrival = new Vector3().fromArray(SECTORS[planet.sectorId].playerStart.position);

        assert.equal(ship.classId, LAYOUT.classId);
        assert.equal(ship.faction, UMBRA);
        assert.equal(ship.ai.mode, 'hold', 'it never moves from there');
        assert.ok(ship.position.length() + ship.boundingRadius < 12000, `${planet.id}: inside the sector`);
        // Turned to face the station.
        const nose = new Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
        assert.ok(nose.dot(station.ship.position.clone().sub(ship.position).normalize()) > 0.999, `${planet.id}: faces the station`);
        // Outside the ring and nowhere near the station's hull.
        assert.ok(hullGap(ship, station.ship) > 1000, `${planet.id}: ${hullGap(ship, station.ship).toFixed(0)} m from the station`);
        // Its guns reach neither the dock nor where ships arrive.
        assert.ok(ship.distanceToPoint(station.mouth) > reach + 1000, `${planet.id}: ${ship.distanceToPoint(station.mouth).toFixed(0)} m from the dock`);
        assert.ok(ship.distanceToPoint(arrival) > reach + 1000, `${planet.id}: from where ships arrive`);
        // Nothing of it in the approach lane, or in the stargate's ring.
        for (let along = 0; along <= arrival.distanceTo(station.mouth); along += 100) {
            const point = arrival.clone().lerp(station.mouth, along / arrival.distanceTo(station.mouth));
            assert.ok(ship.distanceToPoint(point) > 1500, `${planet.id}: in the lane`);
        }
        const gate = world.findByTag(GATE_TAG);
        if (gate) assert.ok(ship.distanceToPoint(gate.closestPoint(ship.position, new Vector3())) > 2000, 'clear of the gate');
        for (const rock of world.obstacles.filter((rock) => rock.alive)) {
            assert.ok(ship.distanceToPoint(rock.position) >= rock.radius + LAYOUT.clearance, `${planet.id}: a rock in the hull`);
        }

        // Its two gun batteries, bolted on its blades.
        const batteries = world.ships.filter((other) => other.parent === ship);
        assert.equal(batteries.length, SHIP_CLASSES[LAYOUT.classId].carrier.cannonMounts.length);
        assert.ok(batteries.every((battery) => battery.classId === LAYOUT.cannonClassId && battery.faction === UMBRA));
        assert.equal(carrierIdOf(ship), 1);
        assert.equal(ship.tags.has(carrierTag(1)), true);
    }
});

test('the batteries count with the ship they are on; the mothership as a ship of the line', () => {
    const { ship, world } = carrierAt('cinder');
    assert.equal(shipStrength(ship), BATTLE_ROYALE.strategy.strength.capital);
    for (const battery of world.ships.filter((other) => other.parent === ship)) assert.equal(shipStrength(battery), 0);
});

/** A carrier with its hangar, and an enemy pilot put wherever a test wants them. */
function hangarScene() {
    const scene = carrierAt('cinder');
    const hangar = new Hangar({ id: 1, ship: scene.ship, dock: scene.station.mouth, layout: LAYOUT });
    const wing = () => scene.world.ships.filter((ship) => ship.alive && ship.tags.has(wingTag(1)));
    const step = (seconds) => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP) {
            // The wing only counts here: it is not let loose on the pilot.
            for (const ship of wing()) ship.weaponsOnline = false;
            scene.world.update(STEP);
            hangar.update(scene.world, STEP);
        }
    };
    /** A pilot's ship sitting still, out of harm's way of anything but a test. */
    const enemy = (faction, position, classId = 'kestrel') => {
        const ship = scene.world.spawnShip(classId, { faction, position: position.toArray(), facing: [0, 0, 1], local: false, maxShield: 1e7 });
        ship.throttle = 0;
        ship.speed = 0;
        return ship;
    };
    return { ...scene, hangar, wing, step, enemy };
}

test('a mothership launches nothing while nobody comes near it or the dock', () => {
    const { hangar, wing, step, enemy, ship, station } = hangarScene();
    step(LAYOUT.launchSeconds * 2);
    assert.equal(wing().length, 0);
    // An enemy keeping its distance from both - and its own side right next to the dock - change nothing.
    const away = station.mouth.clone().sub(ship.position).normalize();
    enemy(DAWN, station.mouth.clone().addScaledVector(away, LAYOUT.dockRange + 400));
    enemy(UMBRA, station.mouth.clone(), 'kestrel');
    step(LAYOUT.launchSeconds * 2);
    assert.equal(wing().length, 0);
    assert.equal(hangar.flightsLeft, LAYOUT.flights);
});

test('an enemy at the dock scrambles the hangar: the first flight after the scramble, then one every interval', () => {
    const { hangar, wing, step, enemy, station } = hangarScene();
    enemy(PIRATE, station.mouth.clone());
    step(LAYOUT.scramble - 0.5);
    assert.equal(wing().length, 0, 'not yet');
    step(1);
    assert.equal(wing().length, LAYOUT.drones, 'a flight of drones: there is no ship of the line to bomb');
    assert.ok(wing().every((ship) => ship.classId === 'drone' && ship.faction === UMBRA));
    assert.equal(hangar.flightsLeft, LAYOUT.flights - 1);
    step(LAYOUT.launchSeconds - 1);
    assert.equal(hangar.flightsLeft, LAYOUT.flights - 1);
    step(1.2);
    assert.equal(hangar.flightsLeft, LAYOUT.flights - 2);
    // No more than its wing's worth fly at once: the hangar waits for them to fall.
    step(LAYOUT.launchSeconds * 4);
    assert.ok(wing().length <= LAYOUT.wingMax + LAYOUT.drones - 1);
    assert.ok(wing().length >= LAYOUT.wingMax);
    const left = hangar.flightsLeft;
    step(LAYOUT.launchSeconds * 2);
    assert.equal(hangar.flightsLeft, left, 'while the wing is full');
});

test('an enemy close to the mothership itself scrambles it too, and its fighters come out from under its hull', () => {
    const { wing, step, enemy, ship } = hangarScene();
    const out = new Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    enemy(DAWN, ship.closestPoint(ship.position.clone().addScaledVector(out, 5000), new Vector3()).addScaledVector(out, LAYOUT.alertRange - 300));
    step(LAYOUT.scramble + 0.2);
    assert.equal(wing().length, LAYOUT.drones);
    for (const fighter of wing()) assert.ok(ship.distanceToPoint(fighter.position) < 400, 'by the hangar');
});

test('with an enemy ship of the line about, some flights are torpedo bombers', () => {
    const { world, ship, station } = hangarScene();
    world.spawnShip('harrier', { faction: DAWN, position: station.mouth.toArray(), facing: [0, 0, 1], aiMode: 'hold', weaponsOnline: false });
    const hangar = new Hangar({ id: 2, ship, dock: station.mouth, layout: { ...LAYOUT, flights: 40, wingMax: 1000, scramble: 0, launchSeconds: 0 } });
    for (let flight = 0; flight < 40; flight++) hangar.update(world, STEP);
    const launched = world.ships.filter((other) => other.tags.has(wingTag(2)));
    const lancers = launched.filter((other) => other.classId === 'lancer').length / LAYOUT.lancers;
    const drones = launched.filter((other) => other.classId === 'drone').length / LAYOUT.drones;
    assert.equal(lancers + drones, 40);
    assert.ok(lancers > 40 * LAYOUT.lancerChance * 0.5 && lancers < 40 * LAYOUT.lancerChance * 1.6, `${lancers} bomber flights of 40`);
});

test('the hangar runs dry, and a dead mothership launches nothing', () => {
    const { hangar, step, enemy, station, ship, wing } = hangarScene();
    enemy(PIRATE, station.mouth.clone());
    hangar.flightsLeft = 1;
    step(LAYOUT.scramble + 0.2);
    assert.equal(hangar.flightsLeft, 0);
    for (const fighter of wing()) fighter.alive = false;
    step(LAYOUT.launchSeconds * 2);
    assert.equal(wing().filter((fighter) => fighter.alive).length, 0, 'nothing left in it');

    hangar.flightsLeft = 5;
    ship.alive = false;
    assert.equal(hangar.alive, false);
    step(LAYOUT.launchSeconds * 2);
    assert.equal(hangar.flightsLeft, 5);
});

test('in a match every Umbra garrison has its mothership, hangar and all; a checkpoint keeps what is left in it', () => {
    const game = createTestServer(['ann'], { start: { seed: 4 } });
    const umbraPlaces = [...game.mode.places.values()].filter((place) => place.zone.world.ships.some((ship) => ship.faction === UMBRA && !ship.isPlayer));
    assert.ok(umbraPlaces.length > 0);
    const ids = new Set();
    for (const place of umbraPlaces) {
        const carriers = place.zone.world.ships.filter((ship) => ship.classId === LAYOUT.classId);
        assert.equal(carriers.length, 1, place.planet.id);
        assert.equal(place.hangars.length, 1);
        assert.equal(place.hangars[0].ship, carriers[0]);
        ids.add(place.hangars[0].id);
    }
    assert.equal(ids.size, umbraPlaces.length, 'each has a number of its own');

    const [place] = umbraPlaces;
    place.hangars[0].flightsLeft = 3;
    place.hangars[0].launchIn = 4.5;
    // A second server for the match, going on from the checkpoint as it would arrive: as JSON text.
    const checkpoint = JSON.parse(JSON.stringify(game.server.capture()));
    const resumed = new MatchServer({ info: game.info, mode: gameModeOf(game.info).createRules(game.info), checkpoint, term: 1, now: () => 0 });
    resumed.start();
    const again = resumed.mode.places.get(place.planet.id);
    assert.equal(again.hangars.length, 1);
    assert.equal(again.hangars[0].id, place.hangars[0].id);
    assert.equal(again.hangars[0].flightsLeft, 3);
    assert.equal(again.hangars[0].launchIn, 4.5);
    assert.equal(again.hangars[0].ship.classId, LAYOUT.classId);
    assert.ok(again.hangars[0].dock.distanceTo(place.station.mouth) < 0.1, 'it guards the same dock');
    assert.ok(resumed.mode.carrierSerial >= Math.max(...ids), 'a new mothership would get a new number');
});

test('a hangar from a checkpoint that says nothing of it is full; nonsense is clamped', () => {
    const { world, station, ship } = carrierAt('cinder');
    const [fresh] = restoreHangars(world, station, null, LAYOUT);
    assert.equal(fresh.ship, ship);
    assert.equal(fresh.flightsLeft, LAYOUT.flights);
    const [odd] = restoreHangars(world, station, [{ id: 1, flightsLeft: 1e9, launchIn: -5 }, { id: 'x' }], LAYOUT);
    assert.equal(odd.flightsLeft, LAYOUT.flights);
    assert.equal(odd.launchIn, 0);
    assert.deepEqual(restoreHangars(new World({ seed: 1 }), station, [{ id: 1 }], LAYOUT), []);
});

test('the ending leaves the mothership out of the fleets at the gate', () => {
    for (const faction of NPC_FACTIONS) {
        const shown = BATTLE_ROYALE.garrisons.gate[faction].filter(([classId]) => classId !== LAYOUT.classId);
        assert.ok(shown.length > 0, 'there is still a fleet to show');
    }
});
