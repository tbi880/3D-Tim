import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { GAME_EVENTS } from '../../src/game/core/EventBus.js';
import { World } from '../../src/game/core/World.js';
import { forwardOf, upOf } from '../../src/game/core/math.js';
import { BR_REQUEST } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { callReinforcements, reinforcementSpots } from '../../src/game/modes/battleRoyale/garrisons.js';
import { createTestMatch } from './support/matchHarness.js';

/**
 * Reinforcements a pilot calls (key B) drop out of warp where that pilot sees them come, with
 * the story's arrival effects, on every device that shows the planet.
 */

const { DAWN, UMBRA } = FACTION;
const LAYOUT = BATTLE_ROYALE.summon;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
/** Half the camera's vertical field of view (scene/PlayerCamera.jsx BASE_FOV), in degrees. */
const HALF_VIEW = 34;
const degrees = (radians) => (radians * 180) / Math.PI;

/** A caller in an empty world: nose a little off every axis, so the test does not lean on them. */
function setUp() {
    const world = new World({ seed: 3 });
    const ship = world.spawnShip('kestrel', { faction: DAWN, position: [400, -200, 900], facing: [0.3, 0.2, -1] });
    return { world, zone: { world }, ship };
}

/** Where `point` is seen from `ship`: degrees off its nose, and whether it is in front / above it. */
function seenFrom(ship, point) {
    const to = point.clone().sub(ship.position);
    const forward = forwardOf(ship.quaternion, new Vector3());
    const up = upOf(ship.quaternion, new Vector3());
    return { offNose: degrees(to.angleTo(forward)), ahead: to.dot(forward) > 0, above: to.dot(up) > 0 };
}

test('called reinforcements drop out of warp in front of the caller, above its line of sight, noses along its heading', () => {
    const { world, zone, ship } = setUp();
    const started = [];
    world.events.on(GAME_EVENTS.WARP_IN_STARTED, ({ ship: arriving }) => started.push(arriving));

    const arrived = callReinforcements(zone, ship, 'dart', LAYOUT, ['squad:1']);

    assert.equal(arrived.length, LAYOUT.count);
    assert.deepEqual(started, arrived, 'each one plays the warp-in');
    for (const dart of arrived) {
        const view = seenFrom(ship, dart.position);
        assert.ok(dart.arriving && dart.faction === DAWN && dart.tags.has('squad:1'));
        assert.ok(view.ahead && view.above, 'in front of the cockpit and above its dashboard');
        assert.ok(view.offNose < HALF_VIEW - 4, `in view (${view.offNose.toFixed(1)} degrees off the nose)`);
        assert.ok(view.offNose > 10, 'off the line of fire');
        assert.ok(dart.quaternion.angleTo(ship.quaternion) < 1e-6, 'streaking in along the caller\'s heading');
    }
    const gaps = arrived.flatMap((a, i) => arrived.slice(i + 1).map((b) => a.position.distanceTo(b.position)));
    assert.ok(Math.min(...gaps) > 150, 'spread out, not on top of each other');
});

test('a landing spot blocked by a hull or a rock is used behind the caller instead', () => {
    const { world, ship } = setUp();
    const forward = forwardOf(ship.quaternion, new Vector3());
    const up = upOf(ship.quaternion, new Vector3());
    // A fighter where the middle of the arc would be.
    const blocking = ship.position.clone().addScaledVector(forward, LAYOUT.ahead).addScaledVector(up, LAYOUT.ring);
    world.spawnShip('raider', { faction: UMBRA, position: blocking });

    const spots = reinforcementSpots(world, ship, LAYOUT);
    const ahead = spots.map((spot) => seenFrom(ship, spot).ahead);
    assert.deepEqual(ahead, [true, false, true], 'only the blocked one goes behind');

    // A rock across the whole of the caller's way: all of them behind.
    world.obstacles.push({ alive: true, radius: 500, position: ship.position.clone().addScaledVector(forward, LAYOUT.ahead) });
    assert.ok(reinforcementSpots(world, ship, LAYOUT).every((spot) => !seenFrom(ship, spot).ahead));
});

/**
 * Three players: `host` and `ann` (Federation) at one planet, `bo` (Umbra) at another. Every
 * device's world is watched for warp-ins and landings.
 */
function arrangeMatch(latency) {
    const match = createTestMatch(['host', 'ann', 'bo'], { latency });
    const { mode } = match.server;
    const [here, elsewhere] = [mode.places.get(PLANETS[2]), mode.places.get(PLANETS[3])];
    const seat = (id, faction, place) => {
        const contestant = mode.contestants.get(id);
        contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        contestant.faction = faction;
        mode.launch(contestant, place, { warpIn: false }).throttle = 0;
        return contestant;
    };
    seat('host', DAWN, here);
    const ann = seat('ann', DAWN, here);
    seat('bo', UMBRA, elsewhere);
    mode.sidesAtStart = new Set([DAWN, UMBRA]);
    match.run(1);

    const watch = (device) => {
        device.warpIns = new Map();
        device.landings = [];
        device.world.events.on(GAME_EVENTS.WARP_IN_STARTED, ({ ship, duration }) => {
            if (!ship.isPlayer) device.warpIns.set(ship, duration);
        });
        device.world.events.on(GAME_EVENTS.WARP_FLASH, ({ ship }) => { if (ship && !ship.isPlayer) device.landings.push(ship); });
    };
    match.devices.forEach(watch);
    const [host, annDevice, boDevice] = match.devices;
    return { match, mode, here, ann, host, annDevice, boDevice, watch };
}

for (const [network, latency] of [['LAN', 0], ['internet', 0.09]]) {
    test(`every device at the planet sees the reinforcements warp in and land, the caller's and the host's alike (${network})`, () => {
        const { match, here, ann, host, annDevice, boDevice } = arrangeMatch(latency);
        ann.summons = 1;
        const before = new Set(here.zone.world.ships);

        annDevice.match.request(BR_REQUEST.SUMMON);
        match.run(0.3);

        const called = here.zone.world.ships.filter((ship) => !before.has(ship) && ship.tags.has('squad:1'));
        assert.equal(called.length, LAYOUT.count);
        for (const device of [host, annDevice]) {
            const durations = [...device.warpIns.entries()].map(([ship, duration]) => [ship.classId, duration]).sort((a, b) => a[1] - b[1]);
            const expected = called.map((ship) => [ship.classId, ship.warpDuration]).sort((a, b) => a[1] - b[1]);
            assert.equal(durations.length, LAYOUT.count, `${device.id}: one warp-in per ship`);
            durations.forEach(([classId, duration], i) => {
                assert.equal(classId, expected[i][0]);
                assert.ok(Math.abs(duration - expected[i][1]) <= 0.01, `${device.id}: the host's timing`);
            });
            // Where the host put them, so the streaks land on the ships the host simulates.
            for (const ship of device.warpIns.keys()) {
                assert.ok(called.some((real) => real.position.distanceTo(ship.position) < 1), `${device.id}: landed where the host has it`);
            }
        }
        assert.equal(boDevice.warpIns.size, 0, 'nothing shown at a planet the device is not at');

        match.run(2);
        assert.equal(host.landings.length, LAYOUT.count, 'the host device sees them land');
        assert.equal(annDevice.landings.length, LAYOUT.count, 'the caller sees them land');
        assert.ok(called.every((ship) => !ship.arriving));
    });
}

test('a device that comes to the planet while they are still arriving sees the rest of the arrival', () => {
    const { match, here, ann, boDevice } = arrangeMatch(0.05);
    ann.summons = 1;
    match.server.mode.summon(ann);
    const called = here.zone.world.ships.filter((ship) => ship.tags.has('squad:1'));
    match.run(0.4);

    // Bo's device now shows this planet (as when watching a comrade there): it is welcomed with the ships as they are.
    match.server.moveToZone(match.server.pilots.get('bo'), here.zone);
    match.run(0.2);

    const stillArriving = called.filter((ship) => ship.arriving);
    assert.ok(stillArriving.length > 0, 'the scene needs a ship still arriving');
    const shown = [...boDevice.warpIns.entries()];
    assert.equal(shown.length, stillArriving.length, 'each ship still arriving plays its warp-in');
    for (const [, duration] of shown) {
        assert.ok(duration > 0 && duration < Math.max(...called.map((ship) => ship.warpDuration)), 'only what is left of it');
    }
    match.run(2);
    assert.equal(boDevice.landings.length, stillArriving.length);
});
