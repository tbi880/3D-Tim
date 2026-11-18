import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { BattleRoyaleMode } from '../../src/game/modes/battleRoyale/BattleRoyaleMode.js';
import { sanitizeBattleRoyaleState } from '../../src/game/modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import { EQUIPMENT } from '../../src/game/modes/battleRoyale/equipment.js';
import { FALL_PHASE, FallClock, dragOf, fallMoment, holeDirection, isFallMoving } from '../../src/game/modes/battleRoyale/planetFall.js';
import { STATION_TAG } from '../../src/game/modes/battleRoyale/station.js';
import { MatchServer } from '../../src/game/net/server/MatchServer.js';
import { paintPlanetFall } from '../../src/game/ui/systemChart.js';
import { drawStarMap, fallFrame } from '../../src/game/xr/vrStarMap.js';
import { createTestMatch, createTestServer } from './support/matchHarness.js';

/**
 * A planet's fall into the black hole as it is shown (modes/battleRoyale/planetFall.js): one
 * choreography, timed by the host's clock, that the star map and the planet's own sky both
 * play - and what the host really does to a swallowed planet's station and computer-flown ships.
 */

const { DAWN, UMBRA } = FACTION;
const SHOW = BATTLE_ROYALE.collapse.show;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [INNERMOST, SECOND] = PLANETS;
const GATE = PLANETS.at(-1);
const TIMETABLE = Object.freeze({ fallsAt: 100, goneAt: 130 });

/** A match with every pilot put on a chosen side at a chosen planet, engines stopped (as in battleRoyale.test.js). */
function arrange(seats) {
    const game = createTestServer(Object.keys(seats));
    const { server, mode } = game;
    for (const [name, [faction, planet]] of Object.entries(seats)) {
        const contestant = mode.contestants.get(name);
        contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        contestant.faction = faction;
        mode.launch(contestant, mode.places.get(planet), { warpIn: false }).throttle = 0;
    }
    mode.sidesAtStart = new Set(Object.values(seats).map(([faction]) => faction));
    game.ship = (name) => server.pilots.get(name).ship;
    game.who = (name) => mode.contestants.get(name);
    game.place = (planet) => mode.places.get(planet);
    game.npcs = (planet) => game.place(planet).zone.world.ships.filter((ship) => ship.alive && !ship.isPlayer && !ship.parent && ship.faction !== FACTION.NEUTRAL);
    game.state = (name) => mode.describeState(server.pilots.get(name));
    game.skipTo = (time) => { server.time = time; game.run(0.1); };
    /** Keeps a pilot's ship whole whatever the black hole takes, to see what else it does. */
    game.mend = (name) => { const ship = game.ship(name); ship.hull = ship.maxHull; ship.shield = ship.maxShield; };
    return game;
}
const fallsAt = (game, orbit) => game.mode.clock.schedule[orbit].startsAt;
const goneAt = (game, orbit) => game.mode.clock.schedule[orbit].goneAt;

/** A 2D context that takes any drawing and keeps count of it. */
function countingContext() {
    const gradient = { addColorStop() {} };
    const state = { calls: 0 };
    const ctx = new Proxy({}, {
        get(target, name) {
            if (name === 'createRadialGradient' || name === 'createLinearGradient') return () => gradient;
            if (name === 'measureText') return (text) => ({ width: String(text).length * 8 });
            if (name in target) return target[name];
            return (...args) => { state.calls += 1; state.last = [name, ...args]; };
        },
        set(target, name, value) { target[name] = value; return true; },
    });
    return { ctx, state };
}

// ---- The choreography ----------------------------------------------------------------------

test('nothing shows before a planet starts to fall in, nor ever at one that never does', () => {
    const before = fallMoment(99.9, TIMETABLE, SHOW);
    assert.deepEqual([before.phase, before.size, before.strain, before.ripped, before.flash], [FALL_PHASE.SAFE, 0, 0, 0, 0]);
    assert.equal(fallMoment(5000, null, SHOW).phase, FALL_PHASE.SAFE, 'the stargate\'s planet has no timetable');
    assert.equal(isFallMoving(before, SHOW), false);
});

test('while a planet falls in the hole grows and the pull shows harder, steadily, up to the moment it is swallowed', () => {
    let last = fallMoment(TIMETABLE.fallsAt, TIMETABLE, SHOW);
    assert.equal(last.phase, FALL_PHASE.FALLING);
    assert.ok(Math.abs(last.size - SHOW.size[0]) < 1e-9, 'the hole is there, small, from the first moment');
    for (let time = TIMETABLE.fallsAt + 1; time < TIMETABLE.goneAt; time += 1) {
        const now = fallMoment(time, TIMETABLE, SHOW);
        assert.equal(now.phase, FALL_PHASE.FALLING);
        assert.ok(now.size > last.size && now.strain > last.strain && now.falling > last.falling, `at ${time}`);
        assert.ok(now.beat >= 0 && now.beat < 1);
        assert.deepEqual([now.ripped, now.flash, now.gone], [0, 0, 0], 'the planet is still there');
        assert.equal(isFallMoving(now, SHOW), true);
        last = now;
    }
    assert.ok(last.size < SHOW.size[1] && last.strain < SHOW.strain);
});

test('the moment a planet is swallowed there is a flash; then it is torn away, the pull is at its hardest and the hole takes the sky', () => {
    const moment = fallMoment(TIMETABLE.goneAt, TIMETABLE, SHOW);
    assert.equal(moment.phase, FALL_PHASE.GONE);
    assert.equal(moment.flash, 1);
    assert.equal(moment.ripped, 0);
    assert.ok(Math.abs(moment.size - SHOW.size[1]) < 1e-9 && Math.abs(moment.strain - SHOW.strain) < 1e-9, 'no jump in the picture at the moment itself');

    const halfway = fallMoment(TIMETABLE.goneAt + SHOW.rip / 2, TIMETABLE, SHOW);
    assert.ok(halfway.ripped > 0.4 && halfway.ripped < 0.6 && halfway.flash < 0.5);
    const later = fallMoment(TIMETABLE.goneAt + Math.max(SHOW.rip, SHOW.flash, SHOW.grip) + 0.01, TIMETABLE, SHOW);
    assert.deepEqual([later.ripped, later.flash, later.strain], [1, 0, 1]);
    assert.equal(isFallMoving(later, SHOW), false, 'the map can stop redrawing: the husk is a still picture');
    const end = fallMoment(TIMETABLE.goneAt + SHOW.fills, TIMETABLE, SHOW);
    assert.ok(Math.abs(end.size - SHOW.size[2]) < 1e-9, 'the whole sky');
    assert.equal(fallMoment(TIMETABLE.goneAt + 9999, TIMETABLE, SHOW).size, SHOW.size[2], 'and it stays so for whoever jumps in later');
});

test('a device that looks late sees the moment the clock has reached, not the beginning', () => {
    const early = { phase: 'stale', falling: 0.9, size: 0.9 };
    const late = fallMoment(TIMETABLE.fallsAt + 20, TIMETABLE, SHOW, early);
    assert.equal(late, early, 'written into what was passed');
    assert.deepEqual(late, fallMoment(TIMETABLE.fallsAt + 20, TIMETABLE, SHOW), 'nothing of it depends on what was seen before');
    assert.ok(Math.abs(late.falling - 20 / 30) < 1e-9);
});

test('the hole stands where the planet\'s sun was, and drags big hulls slower than small ones', () => {
    for (const planet of STAR_SYSTEM.planets) {
        const direction = holeDirection(planet.sectorId);
        assert.ok(Math.abs(direction.length() - 1) < 1e-9);
        assert.ok(direction.dot(new Vector3().fromArray(SECTORS[planet.sectorId].light.sunDirection).normalize()) > 0.999);
    }
    const hull = (kind) => ({ cls: { kind } });
    assert.ok(dragOf(hull('station'), SHOW.drag) < dragOf(hull('capital'), SHOW.drag));
    assert.ok(dragOf(hull('capital'), SHOW.drag) < dragOf(hull('fighter'), SHOW.drag));
});

// ---- A device following the host's clock ---------------------------------------------------

/** A match state with only what the clock reads. */
const word = (clock, planets = [{ id: INNERMOST, fallsAt: TIMETABLE.fallsAt, goneAt: TIMETABLE.goneAt }, { id: GATE, fallsAt: null, goneAt: null }]) => ({ clock, planets });

test('a device keeps the host\'s clock running between the host\'s words, and is eased back when it drifts', () => {
    let device = 50;
    const clock = new FallClock(() => device);
    assert.equal(clock.time, null);
    assert.equal(clock.isMoving(SHOW), false);

    clock.hear(word(110));
    assert.equal(clock.time, 110);
    device += 0.1;
    assert.ok(Math.abs(clock.time - 110.1) < 1e-9, 'it runs on by itself');
    assert.equal(clock.momentOf({ id: INNERMOST }, SHOW).phase, FALL_PHASE.FALLING);
    assert.equal(clock.momentOf({ id: GATE }, SHOW).phase, FALL_PHASE.SAFE);
    assert.equal(clock.isMoving(SHOW), true);

    // The host says a little less than the device had reckoned: the picture does not jump back, it is eased.
    device += 0.15;
    clock.hear(word(110.2));
    assert.ok(clock.time > 110.2 && clock.time < 110.25);
    // A big difference (the match went to another host) is simply taken.
    clock.hear(word(140));
    assert.equal(clock.time, 140);
    assert.equal(clock.momentOf({ id: INNERMOST }, SHOW).phase, FALL_PHASE.GONE);
});

test('a host that falls silent stops the fall on the device too', () => {
    let device = 0;
    const clock = new FallClock(() => device);
    clock.hear(word(100));
    device += 60;
    assert.ok(clock.time < 102, 'not a minute on: the host has not counted one');
});

test('without the host\'s clock the fall is read off the planet\'s status: a still picture, but the right one', () => {
    const clock = new FallClock(() => 0);
    clock.hear(word(null));
    assert.equal(clock.momentOf({ id: INNERMOST, status: PLANET_STATUS.SAFE }, SHOW).phase, FALL_PHASE.SAFE);
    assert.equal(clock.momentOf({ id: INNERMOST, status: PLANET_STATUS.COLLAPSING }, SHOW).phase, FALL_PHASE.FALLING);
    const gone = clock.momentOf({ id: INNERMOST, status: PLANET_STATUS.SWALLOWED }, SHOW);
    assert.deepEqual([gone.phase, gone.ripped, gone.flash], [FALL_PHASE.GONE, 1, 0]);
    assert.equal(clock.isMoving(SHOW), false);
});

// ---- What the host sends, and does --------------------------------------------------------

test('the match state carries the collapse clock and every planet\'s two times on it', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.run(1);
    const state = sanitizeBattleRoyaleState(JSON.parse(JSON.stringify(game.state('ann'))));
    assert.ok(Math.abs(state.clock - game.mode.clock.time) < 0.011);
    state.planets.forEach((planet, orbit) => {
        if (planet.id === GATE) assert.deepEqual([planet.fallsAt, planet.goneAt], [null, null], 'the last planet never falls in');
        else assert.deepEqual([planet.fallsAt, planet.goneAt], [fallsAt(game, orbit), goneAt(game, orbit)]);
    });

    const waiting = createTestServer(['ann'], { start: { settings: { intro: 'play' } } });
    waiting.run(1);
    assert.equal(sanitizeBattleRoyaleState(waiting.mode.describeState(waiting.server.pilots.get('ann'))).clock, null, 'nothing counts before anybody is in the system');
});

test('while a planet is falling in nothing there is moved: the station can still be docked at where it stands', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    const place = game.place(INNERMOST);
    const home = place.station.ship.position.clone();
    game.skipTo(fallsAt(game, 0) + 0.1);
    game.run(BATTLE_ROYALE.collapse.collapsing - 1);

    assert.equal(place.status, PLANET_STATUS.COLLAPSING);
    assert.ok(place.station.ship.position.distanceTo(home) < 1e-6);
    assert.equal(place.stationFell, false);
});

test('once the planet is swallowed its station and the computer-flown ships are dragged towards the hole, and pilots are not', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    const place = game.place(INNERMOST);
    const home = place.station.ship.position.clone();
    game.skipTo(goneAt(game, 0) + 0.05);
    const garrison = game.npcs(INNERMOST);
    assert.ok(garrison.length > 0);
    const before = new Map(garrison.map((ship) => [ship, ship.position.clone()]));
    const pilotBefore = game.ship('ann').position.clone();
    // The garrison is kept from dying of the pull for these seconds, to see where it goes.
    for (let step = 0; step < 30; step++) {
        for (const ship of garrison) { ship.hull = ship.maxHull; ship.shield = ship.maxShield; }
        game.mend('ann');
        game.run(0.1);
    }

    const along = (from, to) => to.clone().sub(from).dot(place.hole);
    for (const ship of garrison) assert.ok(along(before.get(ship), ship.position) > 40, `${ship.classId} has been dragged ${along(before.get(ship), ship.position)} m`);
    const stationFell = along(home, place.station.ship.position);
    assert.ok(Math.abs(stationFell - 0.5 * SHOW.drag.station * 3.15 ** 2) < 8, `the station is where the clock says: ${stationFell} m in`);
    assert.ok(Math.abs(along(pilotBefore, game.ship('ann').position)) < 5, 'a pilot flies as before');
});

test('the station of a swallowed planet breaks up some seconds later, and for good', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    const place = game.place(INNERMOST);
    const hull = place.station.ship;
    game.skipTo(goneAt(game, 0) + SHOW.stationBreaks - 0.5);
    assert.equal(hull.alive, true);
    game.mend('ann');
    game.run(1);

    assert.equal(hull.alive, false);
    assert.equal(place.stationFell, true);
    assert.equal(place.zone.world.findByTag(STATION_TAG), null);
    assert.ok(hull.velocity.dot(place.hole) > 100, 'its wreck keeps falling in');
});

test('a deserted planet\'s station goes the same way with nobody there, and whoever jumps in later finds none', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    const place = game.place(INNERMOST);
    game.skipTo(goneAt(game, 0) + SHOW.stationBreaks + 1);

    assert.equal(place.zone.active, false);
    assert.equal(place.stationFell, true);
    assert.equal(place.zone.world.findByTag(STATION_TAG), null);
});

test('a match taken over after a station has broken up does not get the station back', () => {
    const game = arrange({ ann: [DAWN, SECOND], bo: [UMBRA, SECOND] });
    game.skipTo(goneAt(game, 0) + SHOW.stationBreaks + 1);
    const checkpoint = JSON.parse(JSON.stringify(game.server.capture()));
    const server = new MatchServer({ info: game.info, mode: new BattleRoyaleMode(game.info), hostPlayerId: 'bo', checkpoint, now: () => 0 });
    server.start();

    const gone = server.mode.places.get(INNERMOST);
    assert.equal(gone.zone.world.findByTag(STATION_TAG), null);
    assert.equal(gone.stationFell, true);
    assert.equal(gone.station.ship.alive, false);
    const standing = server.mode.places.get(SECOND);
    assert.ok(standing.zone.world.findByTag(STATION_TAG), 'the others are as they were');
    assert.equal(standing.stationFell, false);
    server.update(1 / 30);
});

test('a pilot is told whose gravity shields are on where they are: the pull does not show on those ships', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bo: [DAWN, INNERMOST], cy: [DAWN, SECOND] });
    game.who('ann').inventory.counts[EQUIPMENT.GRAVITY_SHIELD] = 1;
    game.run(0.5);
    assert.deepEqual(game.state('bo').you.shielded, [], 'nothing pulls yet');

    game.skipTo(fallsAt(game, 0) + 0.5);
    assert.deepEqual(game.state('bo').you.shielded, ['ann']);
    assert.deepEqual(game.state('ann').you.shielded, ['ann']);
    assert.deepEqual(game.state('cy').you.shielded, [], 'only of the planet one is at');
    assert.deepEqual(sanitizeBattleRoyaleState(game.state('bo')).you.shielded, ['ann']);
});

// ---- On the devices ------------------------------------------------------------------------

/** Brings the innermost planet's fall forward on a whole test match: it starts `lead` seconds from now. */
function bringFallForward(match, lead) {
    const { clock } = match.server.mode;
    clock.schedule[0].startsAt = clock.time + lead;
    clock.schedule[0].goneAt = clock.schedule[0].startsAt + BATTLE_ROYALE.collapse.collapsing;
    clock.schedule.slice(1).forEach((entry, index) => { entry.startsAt = 50000 + index * 1000; entry.goneAt = entry.startsAt + 30; });
}

/** Puts every player of a test match at a planet, engines stopped, and keeps them from dying there. */
function gather(match, planet) {
    const { mode } = match.server;
    for (const contestant of mode.contestants.values()) {
        contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        mode.launch(contestant, mode.places.get(planet), { warpIn: false }).throttle = 0;
    }
    return () => {
        for (const contestant of mode.contestants.values()) {
            const ship = contestant.pilot.ship;
            if (ship?.alive) { ship.hull = ship.maxHull; ship.shield = ship.maxShield; }
        }
    };
}

test('every device at a falling planet shows the same moment of its fall: the hole in the sun\'s place, and the strain', () => {
    const match = createTestMatch(['host', 'ann'], { latency: 0.04 });
    const mend = gather(match, INNERMOST);
    match.run(1);
    for (const device of match.devices) assert.deepEqual([device.world.singularity.size, device.world.tide.strain], [0, 0]);
    bringFallForward(match, 0.5);
    for (let step = 0; step < 20; step++) { mend(); match.run(0.5); }

    const expected = fallMoment(match.server.mode.clock.time, match.server.mode.clock.timetableOf(0), SHOW);
    assert.equal(expected.phase, FALL_PHASE.FALLING);
    const hole = holeDirection(STAR_SYSTEM.planets[0].sectorId);
    for (const device of match.devices) {
        const { tide, singularity } = device.world;
        assert.ok(Math.abs(tide.falling - expected.falling) < 0.02, `${device.id}: ${tide.falling} against the host's ${expected.falling}`);
        assert.ok(Math.abs(singularity.size - expected.size) < 0.01 && Math.abs(tide.strain - expected.strain) < 0.02);
        assert.ok(singularity.direction.dot(hole) > 0.999);
        assert.equal(tide.ripped, 0);
    }
});

test('the planet\'s end is seen on every device there - a flash, the planet torn away - and nothing of it elsewhere', () => {
    const match = createTestMatch(['host', 'ann']);
    const mend = gather(match, INNERMOST);
    match.run(0.5);
    // One of them is somewhere else when it happens.
    const { mode } = match.server;
    const away = mode.contestants.get('ann');
    away.pilot.zone.world.removeShip(away.pilot.ship);
    mode.launch(away, mode.places.get(SECOND), { warpIn: false }).throttle = 0;
    bringFallForward(match, 0.2);
    const cues = [];
    match.host.session.events.on('cue', ({ id }) => cues.push(id));
    for (let step = 0; step < 62; step++) { mend(); match.run(0.5); }

    const [host, ann] = match.devices;
    assert.equal(host.world.tide.flash > 0 || host.world.tide.ripped > 0, true);
    assert.ok(host.world.singularity.size >= SHOW.size[1]);
    assert.ok(cues.includes('swallowed'), 'whoever saw it go heard it go');
    assert.deepEqual([ann.world.singularity.size, ann.world.tide.strain, ann.world.tide.flash], [0, 0, 0], 'the next planet out is as it was');
});

test('a pilot who jumps to a planet half-way through its fall finds it half-way through, and the shielded ship is marked', () => {
    const match = createTestMatch(['host', 'ann']);
    const mend = gather(match, SECOND);
    const { mode } = match.server;
    mode.contestants.get('host').inventory.counts[EQUIPMENT.GRAVITY_SHIELD] = 1;
    match.run(0.5);
    bringFallForward(match, 0.2);
    for (let step = 0; step < 30; step++) { mend(); match.run(0.5); }
    for (const device of match.devices) assert.equal(device.world.tide.strain, 0, 'nobody is there to see it yet');

    for (const contestant of mode.contestants.values()) {
        contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        mode.launch(contestant, mode.places.get(INNERMOST), { warpIn: false }).throttle = 0;
    }
    for (let step = 0; step < 4; step++) { mend(); match.run(0.5); }

    const expected = fallMoment(mode.clock.time, mode.clock.timetableOf(0), SHOW);
    assert.ok(expected.falling > 0.5);
    for (const device of match.devices) {
        assert.ok(Math.abs(device.world.tide.falling - expected.falling) < 0.03, 'what is left of it, not the beginning');
        const proof = device.world.ships.filter((ship) => ship.tideProof).map((ship) => ship.pilotId);
        assert.deepEqual(proof, ['host'], `${device.id} draws the shielded ship unshaken, and only that one`);
    }
});

// ---- On the star map -----------------------------------------------------------------------

test('the map paints a planet at every moment of its fall, and a swallowed one as its husk', () => {
    const look = { light: '#ffffff', mid: '#888888', dark: '#000000', size: 1 };
    for (const time of [0, 100, 101, 115, 129.9, 130, 130.4, 131, 132.5, 133, 200]) {
        const { ctx, state } = countingContext();
        const moment = fallMoment(time, TIMETABLE, SHOW);
        assert.doesNotThrow(() => paintPlanetFall(ctx, { x: 200, y: 40, radius: 12, look, sunEdge: 30, moment, time: 7.3 }), `at ${time}`);
        assert.ok(state.calls > 0);
    }
});

test('the headset\'s map is drawn again several times a second while a planet falls in, and not otherwise', () => {
    let device = 0;
    const clock = new FallClock(() => device);
    clock.hear(word(50));
    assert.equal(fallFrame(clock), 0);
    assert.equal(fallFrame(null), 0);
    clock.hear(word(110));
    const first = fallFrame(clock);
    device += 0.5;
    assert.ok(fallFrame(clock) - first >= 5, 'a new picture is due');
    clock.hear(word(400));
    assert.equal(fallFrame(clock), 0, 'long gone: the picture is still');

    // And the map itself draws with the clock in hand.
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.skipTo(fallsAt(game, 0) + 10);
    const match = sanitizeBattleRoyaleState(game.state('ann'));
    const follower = new FallClock(() => 0);
    follower.hear(match);
    const { ctx, state } = countingContext();
    assert.doesNotThrow(() => drawStarMap(ctx, 40, 20, 944, match, (key) => key, { clock: follower }));
    assert.ok(state.calls > 100);
});
