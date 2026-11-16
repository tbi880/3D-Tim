import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, NPC_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { applyDamage, areHostile, destroyShip } from '../../src/game/core/systems/damage.js';
import { LOYALTY } from '../../src/game/modes/battleRoyale/allegiance.js';
import { BR_EVENT, BR_REQUEST, DOCK_END, DOCK_REFUSAL, JUMP_REFUSAL, VOTE } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { MATCH_ACTION, MATCH_PANEL } from '../../src/game/modes/battleRoyale/BattleRoyalePresenter.js';
import { rosterBySide } from '../../src/game/modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import { EQUIPMENT } from '../../src/game/modes/battleRoyale/equipment.js';
import { GATE_TAG, STATION_TAG } from '../../src/game/modes/battleRoyale/station.js';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { WORLD_EVENT } from '../../src/game/net/protocol.js';
import { createTestMatch, createTestServer } from './support/matchHarness.js';

/**
 * The battle royale's rules, played on a bare server: tests put pilots where a scene needs
 * them and ask for things the way a player's device would (`ask`).
 */

const { DAWN, UMBRA, PIRATE } = FACTION;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [INNERMOST, SECOND, THIRD] = PLANETS;
const FOURTH = PLANETS[3];
const GATE = PLANETS.at(-1);
const NEXT_TO_GATE = PLANETS.at(-2);
const { station: STATION, equipment: GEAR } = BATTLE_ROYALE;

/**
 * A match with every pilot put on a chosen side at a chosen planet, engines stopped:
 *   const game = arrange({ ann: [DAWN, 'haven'], bo: [UMBRA, 'haven'] });
 */
function arrange(seats, settings = {}) {
    const names = Object.keys(seats);
    const game = createTestServer(names, { start: { settings } });
    const { server, mode } = game;
    /** Everything the rules told each pilot, in order: [kind, ...]. */
    const told = new Map();
    for (const [name, [faction, planet]] of Object.entries(seats)) {
        const contestant = mode.contestants.get(name);
        const { pilot } = contestant;
        pilot.zone.world.removeShip(pilot.ship);
        contestant.faction = faction;
        const ship = mode.launch(contestant, mode.places.get(planet), { warpIn: false });
        ship.throttle = 0;
        const heard = [];
        told.set(name, heard);
        const tell = pilot.tell.bind(pilot);
        pilot.tell = (...entry) => { heard.push(entry); tell(...entry); };
    }
    mode.sidesAtStart = new Set(Object.values(seats).map(([faction]) => faction));
    game.pilot = (name) => server.pilots.get(name);
    game.ship = (name) => server.pilots.get(name).ship;
    game.who = (name) => mode.contestants.get(name);
    game.place = (planet) => mode.places.get(planet);
    game.world = (planet) => mode.places.get(planet).zone.world;
    game.npcs = (planet, faction) => game.world(planet).ships.filter((ship) => ship.alive && !ship.isPlayer && ship.faction === faction);
    game.ask = (name, request, data = {}) => mode.onRequest(server.pilots.get(name), request, data);
    game.state = (name) => mode.describeState(server.pilots.get(name));
    /** Destroys every computer-flown ship of `faction` at a planet, credited to `killer`'s ship. */
    game.wipe = (planet, faction, killer = null) => {
        for (const ship of game.npcs(planet, faction)) destroyShip(game.world(planet), ship, killer ? game.ship(killer) : null);
    };
    /** Removes ships without a fight (to set a scene). */
    game.clear = (planet, faction) => { for (const ship of game.npcs(planet, faction)) game.world(planet).removeShip(ship); };
    game.chargeJump = (name) => { game.who(name).jumpReadyAt = 0; };
    /** What the rules announced to a pilot under `event` (BR_EVENT): the data of each announcement. */
    game.told = (name, event) => told.get(name).filter((entry) => entry[0] === WORLD_EVENT.MODE && entry[1] === event).map((entry) => entry[2]);
    /** Stops a pilot's ship in the mouth of the dock of the station where they are. */
    game.park = (name) => {
        const ship = game.ship(name);
        ship.position.copy(mode.placeOf(game.who(name)).station.mouth);
        ship.velocity.set(0, 0, 0);
        ship.throttle = 0;
    };
    /** Parks a pilot's ship and clamps it on. */
    game.dock = (name) => { game.park(name); game.ask(name, BR_REQUEST.DOCK); };
    /** Docks and stays docked until the locks give. */
    game.take = (name) => { game.dock(name); game.run(game.who(name).dock.seconds + 0.2); };
    /** Puts pieces of equipment in a pilot's hold. */
    game.equip = (name, item, count = 1) => { game.who(name).inventory.counts[item] = count; mode.armEmergencyShield(game.who(name)); };
    /** Removes every computer-flown ship from a planet, so nothing shoots while a scene plays. */
    game.empty = (planet) => { game.clear(planet, DAWN); game.clear(planet, UMBRA); };
    /** Jumps the match clock to a moment of the collapse timetable. */
    game.skipTo = (time) => { server.time = time; game.run(0.1); };
    return game;
}

const startsAt = (game, orbit) => game.mode.clock.schedule[orbit].startsAt;
const goneAt = (game, orbit) => game.mode.clock.schedule[orbit].goneAt;

// ---- Setting up ------------------------------------------------------------------------------

test('the match starts with a zone per planet, each with a garrisoned station, and the stargate at the last', () => {
    const { server, mode } = createTestServer(['a', 'b', 'c']);

    assert.deepEqual([...server.zones.keys()], PLANETS);
    for (const place of mode.places.values()) {
        const npcs = place.zone.world.ships.filter((ship) => !ship.isPlayer && ship.faction !== FACTION.NEUTRAL);
        assert.ok(npcs.length > 0, `${place.planet.id} has a garrison`);
        assert.ok(npcs.every((ship) => NPC_FACTIONS.includes(ship.faction)), 'pirates have no ships of their own');
        assert.equal(place.zone.world.friendlyFire, true);
        const station = place.zone.world.findByTag(STATION_TAG);
        assert.ok(station, `${place.planet.id} has a station`);
        assert.equal(station, place.station.ship);
        assert.deepEqual([station.faction, station.invulnerable, station.targetable], [FACTION.NEUTRAL, true, false]);
        assert.equal(place.owner, null, 'which nobody holds yet');
        assert.equal(place.zone.world.difficulty.id, 'versus');
        assert.equal(place.status, PLANET_STATUS.SAFE);
        assert.equal(place.owner, null);
    }
    const gateWorld = mode.places.get(GATE).zone.world;
    assert.ok(gateWorld.findByTag(GATE_TAG), 'the stargate');
    assert.equal(gateWorld.findByTag(GATE_TAG).invulnerable, true);
    assert.ok(NPC_FACTIONS.every((faction) => gateWorld.ships.some((ship) => ship.faction === faction)), 'both fleets wait at the gate');
});

test('players are dealt into sides, each flying for the side they got', () => {
    for (let seed = 1; seed <= 12; seed++) {
        const { server, mode } = createTestServer(['a', 'b', 'c', 'd', 'e', 'f'], { start: { seed } });
        const sides = [...mode.contestants.values()].map((contestant) => contestant.faction);
        assert.deepEqual([DAWN, UMBRA, PIRATE].map((faction) => sides.filter((side) => side === faction).length), [2, 2, 2]);
        for (const contestant of mode.contestants.values()) {
            const { pilot } = contestant;
            assert.equal(pilot.ship.faction, contestant.faction);
            assert.equal(pilot.ship.callsign, pilot.name);
            assert.notEqual(pilot.zone.id, GATE, 'nobody starts at the gate');
        }
        const zoneOf = (faction) => [...mode.contestants.values()].filter((c) => c.faction === faction).map((c) => c.pilot.zone.id);
        assert.equal(new Set(zoneOf(DAWN)).size, 1, 'a side starts together');
        assert.equal(new Set(zoneOf(UMBRA)).size, 1);
        assert.equal(new Set(zoneOf(PIRATE)).size, 2, 'pirates do not');
        assert.ok(server.pilots.size === 6);
    }
});

test('the jump drive starts uncharged', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    assert.equal(game.state('ann').you.jump.cooldown, BATTLE_ROYALE.jump.cooldown);
});

// ---- Jumping ---------------------------------------------------------------------------------

test('a charged drive jumps to the next orbit after spooling up', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.chargeJump('ann');
    const first = game.ship('ann');
    first.hull = first.maxHull * 0.5;
    first.shield = first.maxShield * 0.25;
    // Freshly hit: the shield will not start recharging while the drive spools up.
    first.shieldCooldown = 60;
    first.powerMode = 'defense';

    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.state('ann').you.jump.to, SECOND);
    game.run(BATTLE_ROYALE.jump.spool - 0.5);
    assert.equal(game.pilot('ann').zone.id, THIRD, 'still spooling');
    game.run(1);

    const arrived = game.ship('ann');
    assert.equal(game.pilot('ann').zone.id, SECOND);
    assert.notEqual(arrived, first);
    assert.equal(first.alive, false, 'the ship left the old zone');
    assert.equal(game.world(THIRD).ships.includes(first), false);
    assert.ok(Math.abs(arrived.hullFraction - 0.5) < 0.01, 'damage travels with the ship');
    // (It has been recharging for the half second since the ship arrived.)
    assert.ok(arrived.shieldFraction >= 0.25 && arrived.shieldFraction < 0.4, 'and so does the state of the shield');
    assert.equal(arrived.powerMode, 'defense');
    assert.equal(arrived.faction, DAWN);
    assert.equal(game.state('ann').you.planet, SECOND);
    assert.equal(game.state('ann').you.jump.to, null);
});

test('after a jump the drive needs a minute before the next', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    game.ship('ann').throttle = 0;

    assert.ok(game.state('ann').you.jump.cooldown > BATTLE_ROYALE.jump.cooldown - 2);
    game.ask('ann', BR_REQUEST.JUMP, { to: THIRD });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    assert.equal(game.pilot('ann').zone.id, SECOND, 'refused: still charging');

    game.skipTo(game.server.time + BATTLE_ROYALE.jump.cooldown);
    game.ask('ann', BR_REQUEST.JUMP, { to: THIRD });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    assert.equal(game.pilot('ann').zone.id, THIRD);
});

test('a jump cannot skip an orbit, go nowhere, or go somewhere that does not exist', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.chargeJump('ann');

    for (const to of [THIRD, INNERMOST, GATE, 'pluto', '', null, undefined, 7, { id: SECOND }, [SECOND]]) {
        game.ask('ann', BR_REQUEST.JUMP, { to });
        assert.equal(game.who('ann').jump, null, `to ${JSON.stringify(to)}`);
    }
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    assert.equal(game.pilot('ann').zone.id, INNERMOST);
});

test('a second request while spooling changes nothing', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: THIRD });
    game.ask('ann', BR_REQUEST.JUMP, { to: INNERMOST });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    assert.equal(game.pilot('ann').zone.id, THIRD);
});

test('a ship shot down while spooling goes nowhere', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(1);

    destroyShip(game.world(THIRD), game.ship('ann'), game.ship('bo'));
    game.run(BATTLE_ROYALE.jump.spool);

    assert.equal(game.who('ann').alive, false);
    assert.equal(game.who('ann').jump, null);
    assert.equal(game.pilot('ann').zone.id, THIRD, 'left watching the wreck');
    assert.equal(game.world(SECOND).ships.some((ship) => ship.pilotId === 'ann'), false);
});

// ---- The collapse ----------------------------------------------------------------------------

test('a planet that is falling in bleeds every ship there, but lets them jump away', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.clear(INNERMOST, UMBRA);
    game.clear(INNERMOST, DAWN);
    game.skipTo(startsAt(game, 0) + 0.1);
    assert.equal(game.place(INNERMOST).status, PLANET_STATUS.COLLAPSING);
    assert.equal(game.state('ann').planets[0].status, PLANET_STATUS.COLLAPSING);

    const before = game.ship('ann').shield + game.ship('ann').hull;
    game.run(10);
    const after = game.ship('ann').shield + game.ship('ann').hull;
    const expected = BATTLE_ROYALE.collapse.collapsingDrain * 10 * (game.ship('ann').maxHull + game.ship('ann').maxShield);
    assert.ok(Math.abs((before - after) - expected) < expected * 0.2, `lost ${(before - after).toFixed(0)}, expected about ${expected.toFixed(0)}`);
    assert.equal(game.ship('ann').alive, true, 'thirty seconds are survivable');

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    assert.equal(game.pilot('ann').zone.id, SECOND, 'out in time');
});

test('a swallowed planet lets nobody go, and an undamaged ship lasts twenty seconds there', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.empty(INNERMOST);
    game.skipTo(goneAt(game, 0));
    assert.equal(game.place(INNERMOST).status, PLANET_STATUS.SWALLOWED);
    assert.equal(game.state('ann').you.jump.trapped, true);

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('ann').jump, null, 'gravity holds the ship');
    assert.equal(BATTLE_ROYALE.collapse.swallowedSeconds, 20);
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds - 1);
    assert.equal(game.who('ann').alive, true, 'not dead a second early');
    game.run(1.5);

    assert.equal(game.who('ann').alive, false);
    assert.equal(game.ship('ann'), null);
});

test('the black hole\'s pull is not softened by anything a pilot can do with their ship', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST] });
    game.empty(INNERMOST);
    game.ship('ann').powerMode = 'defense';
    game.who('bo').points = 3;
    game.ask('bo', BR_REQUEST.REFIT, { added: { hull: 2, shields: 1 } });
    game.skipTo(goneAt(game, 0));
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds / 2);

    for (const name of ['ann', 'bo']) {
        const ship = game.ship(name);
        const left = (ship.hull + ship.shield) / (ship.maxHull + ship.maxShield);
        assert.ok(Math.abs(left - 0.5) < 0.03, `${name} has ${(left * 100).toFixed(0)}% left at half time`);
    }
});

test('twenty seconds are not enough to take a held station by jumping in: the docking alone takes fifteen', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    game.empty(INNERMOST);
    game.place(INNERMOST).owner = UMBRA;
    game.skipTo(goneAt(game, 0) + 1);
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: INNERMOST });
    game.run(BATTLE_ROYALE.jump.spool + 0.2);
    const ship = game.ship('ann');
    assert.equal(game.pilot('ann').zone.id, INNERMOST);

    // Even at the afterburner's speed in a straight line the dock is too far for what is left.
    const flight = ship.position.distanceTo(game.place(INNERMOST).station.mouth) - STATION.range;
    const topSpeed = ship.cls.maxSpeed * 2.4;
    assert.ok(flight / topSpeed + STATION.heldSeconds > BATTLE_ROYALE.collapse.swallowedSeconds + 5,
        `${(flight / topSpeed).toFixed(1)} s of flight and ${STATION.heldSeconds} s docked`);
});

test('jumping into a swallowed planet is allowed, and fatal', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    game.clear(SECOND, UMBRA);
    game.clear(SECOND, DAWN);
    game.skipTo(goneAt(game, 0) + 1);
    game.chargeJump('ann');

    game.ask('ann', BR_REQUEST.JUMP, { to: INNERMOST });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.equal(game.pilot('ann').zone.id, INNERMOST);
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 2);

    assert.equal(game.who('ann').alive, false);
});

test('the computer-flown ships die with their planet too', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bo: [UMBRA, GATE], pip: [PIRATE, GATE] });
    const garrison = [...game.npcs(INNERMOST, DAWN), ...game.npcs(INNERMOST, UMBRA)];
    assert.ok(garrison.length > 0);
    game.skipTo(goneAt(game, 0) + 0.1);
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 2);

    assert.ok(garrison.every((ship) => !ship.alive));
    assert.equal(game.place(INNERMOST).station.ship.alive, true, 'the station itself is past hurting');
});

test('a deserted planet\'s garrison is gone the moment it is swallowed', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    assert.ok(game.npcs(INNERMOST, DAWN).length + game.npcs(INNERMOST, UMBRA).length > 0);
    game.skipTo(goneAt(game, 0) + 0.1);

    assert.equal(game.npcs(INNERMOST, DAWN).length + game.npcs(INNERMOST, UMBRA).length, 0);
});

test('the gate planet never falls in', () => {
    const game = arrange({ ann: [DAWN, GATE] });
    game.clear(GATE, UMBRA);
    game.skipTo(goneAt(game, PLANETS.length - 2) + 5);
    const before = game.ship('ann').hull + game.ship('ann').shield;
    game.run(5);

    assert.equal(game.place(GATE).status, PLANET_STATUS.SAFE);
    assert.ok(game.ship('ann').hull + game.ship('ann').shield >= before);
    assert.ok(game.state('ann').finalStand > 0);
});

// ---- Taking planets --------------------------------------------------------------------------

test('a side takes a planet by docking at its station for ten seconds', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND] });
    game.empty(THIRD);
    assert.deepEqual(game.state('ann').you.dock, { ready: false, left: null, seconds: STATION.seconds }, 'too far away to dock');

    game.park('ann');
    assert.equal(game.state('ann').you.dock.ready, true);
    game.ask('ann', BR_REQUEST.DOCK);
    assert.deepEqual(game.told('ann', BR_EVENT.DOCKED), [{ seconds: STATION.seconds }]);
    assert.equal(STATION.seconds, 10);

    game.run(STATION.seconds - 0.5);
    assert.equal(game.place(THIRD).owner, null, 'not yet');
    const { dock } = game.state('ann').you;
    assert.ok(dock.left > 0 && dock.left < 1 && dock.ready === false, `${dock.left} s to go`);

    game.run(0.7);
    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.state('ann').planets.find((planet) => planet.id === THIRD).owner, DAWN);
    assert.equal(game.who('ann').dock, null, 'the clamps let go');
    assert.equal(game.who('ann').points, BATTLE_ROYALE.capture.points);
    assert.equal(game.who('ann').summons, BATTLE_ROYALE.capture.summons);
    assert.ok(game.who('ann').score >= BATTLE_ROYALE.capture.score);
    assert.equal(game.who('ann').inventory.picks, GEAR.startingPicks + BATTLE_ROYALE.capture.picks, 'and a piece of equipment to choose');
    assert.deepEqual([game.who('cy').points, game.who('cy').inventory.picks], [0, GEAR.startingPicks], 'a comrade who was elsewhere gets nothing');
});

test('a ship can only dock from the mouth of the dock', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    game.ask('ann', BR_REQUEST.DOCK);
    assert.equal(game.who('ann').dock, null);
    assert.deepEqual(game.told('ann', BR_EVENT.DOCK_REFUSED), [{ reason: DOCK_REFUSAL.TOO_FAR }]);

    game.park('ann');
    game.ship('ann').position.y += STATION.range + 5;
    game.ask('ann', BR_REQUEST.DOCK);
    assert.equal(game.who('ann').dock, null, 'just outside its range');
    game.ship('ann').position.y -= 10;
    game.ask('ann', BR_REQUEST.DOCK);
    assert.ok(game.who('ann').dock, 'just inside it');
});

test('a docked ship is drawn to its berth and neither flies nor fires, whatever its pilot holds down', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    const pilot = game.pilot('ann');
    pilot.lastInputAt = Infinity;
    Object.assign(pilot.controls, { firePrimary: true, fireSecondary: true, throttleTarget: 1, yaw: 1 });
    game.dock('ann');
    game.run(3);

    const ship = game.ship('ann');
    const { station } = game.place(THIRD);
    assert.ok(ship.position.distanceTo(station.berth) < 2, `${ship.position.distanceTo(station.berth).toFixed(1)} m from the berth`);
    assert.ok(ship.quaternion.angleTo(station.berthQuaternion) < 0.05, 'nose to the door');
    assert.equal(ship.speed, 0);
    assert.equal(ship.beamFiring, false);
    assert.equal(game.world(THIRD).projectiles.length, 0);

    game.ask('ann', BR_REQUEST.UNDOCK);
    game.run(1);
    assert.equal(ship.beamFiring, true, 'free again: the trigger was never let go');
    assert.ok(ship.speed > 10);
});

test('a docked ship can still be shot - and one shot down at the dock takes nothing', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.empty(THIRD);
    game.dock('ann');
    game.run(4);
    const before = game.ship('ann').shield;
    applyDamage(game.world(THIRD), game.ship('ann'), 30, { source: game.ship('bo') });
    assert.ok(game.ship('ann').shield < before);

    destroyShip(game.world(THIRD), game.ship('ann'), game.ship('bo'));
    assert.equal(game.who('ann').dock, null);
    game.run(STATION.seconds);
    assert.equal(game.place(THIRD).owner, null);
});

test('letting go ends the docking, and the next one starts from nothing', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    game.dock('ann');
    game.run(STATION.seconds - 2);
    game.ask('ann', BR_REQUEST.UNDOCK);

    assert.equal(game.who('ann').dock, null);
    assert.equal(game.pilot('ann').helmHeld, false);
    assert.deepEqual(game.told('ann', BR_EVENT.UNDOCKED), [{ reason: DOCK_END.RELEASED }]);
    game.park('ann');
    game.run(4);
    assert.equal(game.place(THIRD).owner, null);

    game.dock('ann');
    assert.equal(game.who('ann').dock.left, STATION.seconds);
});

test('jumping away lets go of the station; a ship spooling up cannot dock', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    game.dock('ann');
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('ann').dock, null);
    assert.equal(game.who('ann').jump.to, SECOND);

    game.park('ann');
    game.ask('ann', BR_REQUEST.DOCK);
    assert.equal(game.who('ann').dock, null);
    assert.deepEqual(game.told('ann', BR_EVENT.DOCK_REFUSED), [{ reason: DOCK_REFUSAL.JUMPING }]);
});

test('a station another side holds takes fifteen seconds, and that side hears the alarm wherever it is', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, SECOND], bex: [UMBRA, GATE], pip: [PIRATE, THIRD] });
    game.empty(THIRD);
    game.place(THIRD).owner = UMBRA;
    assert.equal(game.state('ann').you.dock.seconds, STATION.heldSeconds);
    assert.equal(STATION.heldSeconds, 15);

    game.dock('ann');
    assert.equal(game.who('ann').dock.seconds, STATION.heldSeconds);
    for (const name of ['bo', 'bex']) assert.deepEqual(game.told(name, BR_EVENT.STATION_ALARM), [{ planet: THIRD, faction: DAWN }]);
    for (const name of ['ann', 'pip']) assert.deepEqual(game.told(name, BR_EVENT.STATION_ALARM), [], 'nobody else\'s business');

    game.run(STATION.seconds + 1);
    assert.equal(game.place(THIRD).owner, UMBRA, 'ten seconds are not enough here');
    game.run(STATION.heldSeconds - STATION.seconds);
    assert.equal(game.place(THIRD).owner, DAWN);
    for (const name of ['bo', 'bex']) assert.deepEqual(game.told(name, BR_EVENT.STATION_LOST), [{ planet: THIRD, faction: DAWN }]);
    assert.deepEqual(game.told('ann', BR_EVENT.STATION_LOST), []);
});

test('nobody docks at a station their own side holds', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    game.place(THIRD).owner = DAWN;
    game.park('ann');
    assert.equal(game.state('ann').you.dock.ready, false);
    game.ask('ann', BR_REQUEST.DOCK);

    assert.equal(game.who('ann').dock, null);
    assert.deepEqual(game.told('ann', BR_EVENT.DOCK_REFUSED), [{ reason: DOCK_REFUSAL.HELD }]);
});

test('when two sides are docked the first to finish takes the station, and the other is thrown off', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.empty(THIRD);
    game.dock('ann');
    game.run(3);
    game.dock('bo');
    game.run(STATION.seconds - 3 + 0.2);

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.who('bo').dock, null);
    assert.equal(game.pilot('bo').helmHeld, false);
    assert.deepEqual(game.told('bo', BR_EVENT.UNDOCKED), [{ reason: DOCK_END.TAKEN }]);
    assert.deepEqual(game.told('ann', BR_EVENT.UNDOCKED), [], 'the winner needs no telling');
    assert.equal(game.who('bo').points, 0);

    game.dock('bo');
    assert.equal(game.who('bo').dock.seconds, STATION.heldSeconds, 'and has to start again, against a held station');
});

test('a station can change hands any number of times', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.empty(THIRD);
    game.take('ann');
    assert.equal(game.place(THIRD).owner, DAWN);
    game.take('bo');
    assert.equal(game.place(THIRD).owner, UMBRA);
    game.take('ann');

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.who('ann').points, 2 * BATTLE_ROYALE.capture.points, 'each taking pays');
    assert.equal(game.who('bo').points, BATTLE_ROYALE.capture.points);
});

test('a garrison does not hold a station: its own side may dock, and so may its enemy under its guns', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.clear(THIRD, UMBRA);
    if (game.npcs(THIRD, DAWN).length === 0) game.world(THIRD).spawnShip('dart', { faction: DAWN, position: [0, 0, -9000] });
    game.take('ann');

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.ok(game.npcs(THIRD, DAWN).length > 0);
});

test('pirates take a station for three times the points and no reinforcements', () => {
    const game = arrange({ pip: [PIRATE, THIRD] });
    game.empty(THIRD);
    game.take('pip');

    assert.equal(game.place(THIRD).owner, PIRATE);
    assert.equal(game.who('pip').points, BATTLE_ROYALE.capture.piratePoints);
    assert.equal(game.who('pip').summons, 0);
});

test('a pilot who turns pirate at the dock takes the station for nobody but themselves', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD] });
    game.empty(THIRD);
    game.dock('ann');
    game.mode.brandPirate(game.who('ann'), game.place(THIRD).zone);
    game.run(STATION.seconds + 0.2);

    assert.equal(game.place(THIRD).owner, PIRATE);
    assert.equal(game.who('cy').points, 0);
});

// ---- The bubble ------------------------------------------------------------------------------

/** Ann (Federation) has just taken the innermost planet; Bo (Umbra) is there too in the bubble tests that need him. */
function withBubble(seats) {
    const game = arrange(seats);
    game.clear(INNERMOST, DAWN);
    game.clear(INNERMOST, UMBRA);
    game.place(INNERMOST).owner = DAWN;
    return game;
}

test('inside its own bubble a side is safe from the collapse and can still jump out of a swallowed planet', () => {
    const game = withBubble({ ann: [DAWN, INNERMOST] });
    game.skipTo(goneAt(game, 0) + 0.1);
    const before = game.ship('ann').hull + game.ship('ann').shield;
    game.run(10);

    assert.equal(game.ship('ann').alive, true);
    assert.ok(game.ship('ann').hull + game.ship('ann').shield >= before - 0.01);
    assert.equal(game.state('ann').you.jump.trapped, false);

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.equal(game.pilot('ann').zone.id, SECOND);
});

test('the bubble protects nobody else', () => {
    const game = withBubble({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST], pip: [PIRATE, INNERMOST] });
    game.skipTo(startsAt(game, 0) + 0.1);
    const start = (name) => game.ship(name).hull + game.ship(name).shield;
    const before = { ann: start('ann'), bo: start('bo'), pip: start('pip') };
    game.run(5);

    assert.ok(start('ann') >= before.ann - 0.01);
    assert.ok(start('bo') < before.bo - 5);
    assert.ok(start('pip') < before.pip - 5);

    game.skipTo(goneAt(game, 0) + 0.1);
    assert.equal(game.state('bo').you.jump.trapped, true);
    game.chargeJump('bo');
    game.ask('bo', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('bo').jump, null);
});

test('a garrison under its side\'s bubble survives the planet being swallowed', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.clear(INNERMOST, UMBRA);
    if (game.npcs(INNERMOST, DAWN).length === 0) game.world(INNERMOST).spawnShip('dart', { position: [0, 0, 0] });
    game.place(INNERMOST).owner = DAWN;
    game.skipTo(goneAt(game, 0) + 0.1);
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 2);

    assert.ok(game.npcs(INNERMOST, DAWN).length > 0);
});

// ---- Reward or revive ------------------------------------------------------------------------

/** Ann and Cy (Federation) at a planet whose station Ann has just taken; Di, of their side, is already dead. */
function captureWithFallen() {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], di: [DAWN, THIRD], bo: [UMBRA, GATE] });
    game.empty(THIRD);
    destroyShip(game.world(THIRD), game.ship('di'), null);
    game.take('ann');
    return game;
}

test('with a pilot down, the side that took the planet is asked: reward, or bring them back', () => {
    const game = captureWithFallen();

    assert.equal(game.place(THIRD).owner, DAWN, 'the bubble is up either way');
    assert.equal(game.who('ann').points, 0, 'nothing is handed out yet');
    const vote = game.state('ann').you.vote;
    assert.equal(vote.planet, THIRD);
    assert.equal(vote.choice, null);
    assert.ok(vote.endsIn > 0 && vote.endsIn <= BATTLE_ROYALE.capture.voteSeconds);
    assert.equal(game.state('di').you.vote, null, 'the dead have no say');
    assert.equal(game.state('bo').you.vote, null, 'nor do other sides');
});

test('choosing to revive brings the fallen back and gives nobody a reward', () => {
    const game = captureWithFallen();
    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    game.ask('cy', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    game.run(0.3);

    assert.equal(game.who('di').alive, true);
    assert.equal(game.ship('di').alive, true);
    assert.equal(game.pilot('di').zone.id, THIRD, 'at the planet that was taken');
    assert.equal(game.ship('di').faction, DAWN);
    assert.deepEqual([game.who('ann').points, game.who('cy').points, game.who('di').points], [0, 0, 0]);
    assert.equal(game.who('ann').summons, 0);
    assert.equal(game.place(THIRD).vote, null);
    const picks = (name) => game.who(name).inventory.picks;
    assert.deepEqual([picks('ann'), picks('cy'), picks('di')], [GEAR.startingPicks + 1, GEAR.startingPicks + 1, GEAR.startingPicks],
        'the equipment was theirs whatever they chose');
});

test('choosing the reward leaves the fallen where they fell', () => {
    const game = captureWithFallen();
    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REWARD });
    game.ask('cy', BR_REQUEST.VOTE, { choice: VOTE.REWARD });
    game.run(0.3);

    assert.equal(game.who('di').alive, false);
    assert.deepEqual([game.who('ann').points, game.who('cy').points], [3, 3]);
    assert.deepEqual([game.who('ann').summons, game.who('cy').summons], [1, 1]);
    assert.equal(game.who('di').points, 0);
});

test('a split vote brings the fallen back', () => {
    const game = captureWithFallen();
    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    game.ask('cy', BR_REQUEST.VOTE, { choice: VOTE.REWARD });
    game.run(0.3);

    assert.equal(game.who('di').alive, true);
    assert.equal(game.who('cy').points, 0);
});

test('if nobody chooses in time, the reward is taken', () => {
    const game = captureWithFallen();
    game.run(BATTLE_ROYALE.capture.voteSeconds + 0.5);

    assert.equal(game.place(THIRD).vote, null);
    assert.equal(game.who('di').alive, false);
    assert.equal(game.who('ann').points, 3);
});

test('only the pilots who took the planet vote, once each, and only for a real choice', () => {
    const game = captureWithFallen();
    game.ask('bo', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    game.ask('di', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    for (const choice of ['both', '', null, 1, { choice: VOTE.REVIVE }]) game.ask('ann', BR_REQUEST.VOTE, { choice });
    game.run(0.3);
    assert.ok(game.place(THIRD).vote, 'still open: nobody entitled has chosen');

    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REWARD });
    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    assert.equal(game.state('ann').you.vote.choice, VOTE.REVIVE, 'a pilot may change their mind while it is open');
});

test('a station lost while its side was still choosing settles the choice at once', () => {
    const game = captureWithFallen();
    game.ask('ann', BR_REQUEST.VOTE, { choice: VOTE.REVIVE });
    game.chargeJump('bo');
    game.who('bo').pilot.zone.world.removeShip(game.ship('bo'));
    game.mode.launch(game.who('bo'), game.place(THIRD), { warpIn: false });
    game.dock('bo');
    game.who('bo').dock.left = 0.05;
    game.run(0.2);

    assert.equal(game.place(THIRD).owner, UMBRA);
    assert.equal(game.who('di').alive, true, 'Ann had asked for Di back');
});

// ---- Spending the reward ---------------------------------------------------------------------

test('refit points make the ship better, and are used up', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.who('ann').points = 3;
    const hullBefore = game.ship('ann').maxHull;
    const speedBefore = game.ship('ann').cls.maxSpeed;

    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 2, speed: 1 } });

    assert.equal(game.who('ann').points, 0);
    assert.ok(game.ship('ann').maxHull > hullBefore);
    assert.ok(game.ship('ann').cls.maxSpeed > speedBefore);
    assert.deepEqual(game.state('ann').you.upgrades, { hull: 2, speed: 1 });
});

test('a pilot cannot spend more than they have, or on things that are not ratings', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.who('ann').points = 2;

    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 50, speed: 50, godMode: 5, shields: -3, firepower: 1.5 } });
    assert.equal(game.who('ann').points, 0);
    const installed = game.pilot('ann').upgrades;
    assert.equal(Object.values(installed).reduce((sum, levels) => sum + levels, 0), 2, 'exactly the two points');
    assert.equal(installed.godMode, undefined);

    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 1 } });
    assert.equal(Object.values(game.pilot('ann').upgrades).reduce((sum, levels) => sum + levels, 0), 2, 'no points, no refit');
    for (const added of [null, 'hull', 5, [], { hull: 'max' }]) game.ask('ann', BR_REQUEST.REFIT, { added });
});

test('a rating already at its cap takes no points', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.pilot('ann').classId = 'bulwark';
    game.who('ann').points = 3;

    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 3 } });

    assert.equal(game.who('ann').points, 3, 'the Bulwark\'s hull is already 10');
});

test('refits survive a jump', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.who('ann').points = 3;
    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 3 } });
    const refitted = game.ship('ann').maxHull;
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);

    assert.equal(game.ship('ann').maxHull, refitted);
});

test('reinforcements arrive on the caller\'s side, once per call earned', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, SECOND] });
    game.who('ann').summons = 1;
    game.who('bo').summons = 1;
    const dawnBefore = game.npcs(THIRD, DAWN).length;
    const umbraBefore = game.npcs(SECOND, UMBRA).length;

    game.ask('ann', BR_REQUEST.SUMMON);
    game.ask('ann', BR_REQUEST.SUMMON);
    game.ask('bo', BR_REQUEST.SUMMON);

    assert.equal(game.npcs(THIRD, DAWN).length, dawnBefore + BATTLE_ROYALE.summon.count);
    assert.equal(game.npcs(SECOND, UMBRA).length, umbraBefore + BATTLE_ROYALE.summon.count);
    assert.equal(game.who('ann').summons, 0);
    const arrivals = game.npcs(THIRD, DAWN).slice(-BATTLE_ROYALE.summon.count);
    assert.ok(arrivals.every((ship) => ship.arriving && ship.position.distanceTo(game.ship('ann').position) < 1000), 'out of warp near the caller');
});

test('pirates and the dead have nobody to call', () => {
    const game = arrange({ pip: [PIRATE, THIRD], ann: [DAWN, THIRD] });
    game.who('pip').summons = 5;
    game.who('ann').summons = 1;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    const before = game.world(THIRD).ships.length;

    game.ask('pip', BR_REQUEST.SUMMON);
    game.ask('ann', BR_REQUEST.SUMMON);

    assert.equal(game.world(THIRD).ships.length, before);
});

// ---- Who can hurt whom -----------------------------------------------------------------------

test('sides are hostile to each other; pirates to everybody, each other included', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], bo: [UMBRA, THIRD], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    const ship = (name) => game.ship(name);

    assert.equal(areHostile(ship('ann'), ship('cy')), false, 'same side');
    assert.equal(areHostile(ship('ann'), ship('bo')), true);
    assert.equal(areHostile(ship('ann'), ship('pip')), true);
    assert.equal(areHostile(ship('bo'), ship('pip')), true);
    assert.equal(areHostile(ship('pip'), ship('pat')), true, 'pirates have no truce');
    assert.equal(areHostile(ship('pip'), ship('pip')), false, 'but a ship is not its own enemy');
    const dart = game.world(THIRD).spawnShip('dart', { position: [0, 0, 0] });
    assert.equal(areHostile(dart, ship('ann')), false);
    assert.equal(areHostile(dart, ship('pip')), true);
});

test('pilots of one side cannot lock or shoot each other; pirates can', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    game.clear(THIRD, DAWN);
    game.clear(THIRD, UMBRA);
    const world = game.world(THIRD);
    // Line everybody up: each looks straight at their partner 300 m ahead.
    const face = (name, x, partner) => {
        game.ship(name).position.set(x, 0, 0);
        game.ship(partner).position.set(x, 0, -300);
        game.ship(name).quaternion.identity();
    };
    face('ann', 0, 'cy');
    face('pip', 5000, 'pat');

    world.targetNearestToCrosshair(null, game.ship('ann'));
    world.targetNearestToCrosshair(null, game.ship('pip'));
    assert.notEqual(game.ship('ann').target, game.ship('cy'), 'no lock on a comrade');
    assert.equal(game.ship('pip').target, game.ship('pat'));

    const cyBefore = game.ship('cy').shield;
    game.ship('ann').controls = { ...game.ship('ann').controls, firePrimary: true };
    game.pilot('ann').lastInputAt = Infinity;
    game.pilot('ann').controls.firePrimary = true;
    game.pilot('pip').lastInputAt = Infinity;
    game.pilot('pip').controls.firePrimary = true;
    const patBefore = game.ship('pat').shield + game.ship('pat').hull;
    game.run(1);

    assert.equal(game.ship('cy').shield, cyBefore, 'beams do not touch a comrade');
    assert.ok(!game.ship('pat')?.alive || game.ship('pat').shield + game.ship('pat').hull < patBefore, 'a pirate\'s beams hit another pirate');
});

// ---- Treason ---------------------------------------------------------------------------------

/** Ann (Federation) beside one of her side's darts, nothing else around. */
function annWithAlly() {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, GATE] });
    game.clear(THIRD, DAWN);
    game.clear(THIRD, UMBRA);
    const ally = game.world(THIRD).spawnShip('harrier', { position: [0, 0, -9000] });
    return { game, ally, hurt: (amount) => applyDamage(game.world(THIRD), ally, amount, { source: game.ship('ann') }) };
}

test('a player can lock their own side\'s ships only by aiming straight at them', () => {
    const { game, ally } = annWithAlly();
    const ann = game.ship('ann');
    ann.position.set(0, 0, 0);
    ann.quaternion.identity();
    ally.position.set(0, 0, -1500);

    game.world(THIRD).cycleTarget(1, ann);
    assert.equal(ann.target, null, 'cycling never picks a friend');
    game.world(THIRD).targetNearestToCrosshair(null, ann);
    assert.equal(ann.target, ally, 'dead ahead, on purpose');

    ann.target = null;
    ally.position.set(900, 0, -1500);
    game.world(THIRD).targetNearestToCrosshair(null, ann);
    assert.equal(ann.target, null, 'not when it is merely nearby');
});

test('firing on one\'s own side brings a warning first', () => {
    const { game, hurt } = annWithAlly();
    hurt(BATTLE_ROYALE.betrayal.warnDamage - 5);
    assert.equal(game.state('ann').you.loyalty, LOYALTY.TRUSTED, 'an accident');

    hurt(10);
    assert.equal(game.state('ann').you.loyalty, LOYALTY.WARNED);
    assert.equal(game.who('ann').faction, DAWN, 'still one of them');
});

test('going on after the warning makes the pilot a pirate, at once', () => {
    const { game, ally, hurt } = annWithAlly();
    game.who('ann').summons = 2;
    hurt(BATTLE_ROYALE.betrayal.treasonDamage + 1);

    assert.equal(game.who('ann').faction, PIRATE);
    assert.equal(game.ship('ann').faction, PIRATE);
    assert.equal(game.state('ann').you.faction, PIRATE);
    assert.equal(game.who('ann').summons, 0, 'nobody answers a pirate\'s call');
    assert.equal(areHostile(ally, game.ship('ann')), true, 'the old side\'s guns are free');
    assert.equal(game.state('bo').players.find((player) => player.id === 'ann').faction, PIRATE, 'and everybody knows');
});

test('holding fire after the warning is forgiven', () => {
    const { game, hurt } = annWithAlly();
    hurt(BATTLE_ROYALE.betrayal.warnDamage + 5);
    game.run(BATTLE_ROYALE.betrayal.warnDamage / BATTLE_ROYALE.betrayal.forgivePerSecond);

    assert.equal(game.state('ann').you.loyalty, LOYALTY.TRUSTED);
    hurt(BATTLE_ROYALE.betrayal.warnDamage - 5);
    assert.equal(game.who('ann').faction, DAWN);
});

test('damage to enemies, by enemies, or by computer-flown ships is nobody\'s treason', () => {
    const { game, ally } = annWithAlly();
    const world = game.world(THIRD);
    const raider = world.spawnShip('raider', { position: [0, 500, -9000] });
    applyDamage(world, raider, 1000, { source: game.ship('ann') });
    applyDamage(world, ally, 1000, { source: raider });
    applyDamage(world, ally, 100, { source: null });

    assert.equal(game.who('ann').loyalty.damage, 0);
    assert.equal(game.who('ann').faction, DAWN);
});

// ---- Winning ---------------------------------------------------------------------------------

test('the last side with a pilot flying wins', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], pip: [PIRATE, SECOND] });
    destroyShip(game.world(THIRD), game.ship('bo'), game.ship('ann'));
    game.run(0.2);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING, 'the pirate is still out there');

    destroyShip(game.world(SECOND), game.ship('pip'), null);
    game.run(0.2);

    assert.equal(game.state('ann').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('ann').winner, DAWN);
    assert.equal(game.state('bo').winner, DAWN, 'everybody is told the same');
});

test('everybody dead is nobody\'s win', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    const world = game.world(THIRD);
    const [ann, bo] = [game.ship('ann'), game.ship('bo')];
    destroyShip(world, ann, bo);
    destroyShip(world, bo, ann);
    game.run(0.2);

    assert.equal(game.state('ann').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('ann').winner, null);
});

test('taking the stargate once it is the last planet wins the match for the whole side', () => {
    const game = arrange({ ann: [DAWN, GATE], cy: [DAWN, NEXT_TO_GATE], bo: [UMBRA, NEXT_TO_GATE] });
    game.place(NEXT_TO_GATE).owner = UMBRA;
    game.clear(NEXT_TO_GATE, DAWN);
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    assert.ok(game.state('ann').finalStand > 0);
    game.empty(GATE);
    game.take('ann');

    assert.equal(game.state('bo').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('bo').winner, DAWN);
    const cy = game.state('cy').players.find((player) => player.id === 'cy');
    assert.equal(cy.faction, DAWN, 'a comrade who was not even there wins too');
});

test('taking the stargate before the final stand is only a capture', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, THIRD] });
    game.empty(GATE);
    game.take('ann');

    assert.equal(game.place(GATE).owner, DAWN);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING);
    assert.equal(game.who('ann').points, 3);
});

test('a stargate held when the last stand begins can still be taken from its holder - in fifteen seconds', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, GATE] });
    game.empty(GATE);
    game.place(GATE).owner = UMBRA;
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    game.dock('ann');
    game.run(STATION.seconds + 1);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING);
    game.run(STATION.heldSeconds - STATION.seconds);

    assert.equal(game.state('bo').winner, DAWN);
});

test('when the last stand runs out, the side that holds the stargate goes through, however few they are', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, GATE], bex: [UMBRA, GATE] });
    game.empty(GATE);
    game.place(GATE).owner = DAWN;
    game.server.time = game.mode.clock.finalStandEndsAt - 0.05;
    game.run(0.3);

    assert.equal(game.state('bo').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('bo').winner, DAWN);
});

test('a holder with no pilot left flying holds nothing', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, GATE], pip: [PIRATE, GATE] });
    game.empty(GATE);
    game.place(GATE).owner = DAWN;
    destroyShip(game.world(GATE), game.ship('ann'), null);
    destroyShip(game.world(GATE), game.ship('pip'), null);
    game.server.time = game.mode.clock.finalStandEndsAt - 0.05;
    game.run(0.3);

    assert.equal(game.state('bo').winner, UMBRA);
});

test('when the last stand runs out and nobody holds the stargate, the side with the most ships at it goes through', () => {
    const game = arrange({ ann: [DAWN, GATE], cy: [DAWN, GATE], bo: [UMBRA, GATE], pip: [PIRATE, NEXT_TO_GATE] });
    game.clear(GATE, DAWN);
    game.clear(GATE, UMBRA);
    game.place(NEXT_TO_GATE).owner = PIRATE;
    game.clear(NEXT_TO_GATE, DAWN);
    game.clear(NEXT_TO_GATE, UMBRA);
    // Park everybody far apart so nobody settles it early.
    game.ship('ann').position.set(9000, 0, 0);
    game.ship('cy').position.set(9000, 300, 0);
    game.ship('bo').position.set(-9000, 0, 0);
    game.server.time = game.mode.clock.finalStandEndsAt - 0.05;
    game.run(0.3);

    assert.equal(game.state('pip').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('pip').winner, DAWN);
});

test('once the match is decided nothing more can be asked for', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    destroyShip(game.world(THIRD), game.ship('bo'), game.ship('ann'));
    game.run(0.2);
    game.who('ann').points = 3;
    game.chargeJump('ann');

    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 1 } });
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });

    assert.equal(game.who('ann').points, 3);
    assert.equal(game.who('ann').jump, null);
});

test('a solo match (for trying things out) ends only with the pilot', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.run(1);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING);

    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(0.2);
    assert.equal(game.state('ann').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('ann').winner, null);
});

// ---- Score -----------------------------------------------------------------------------------

test('kills score for the pilot who made them: ships by class, players most of all', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], pip: [PIRATE, THIRD] });
    const world = game.world(THIRD);
    const drone = world.spawnShip('drone', { position: [0, 0, -9000] });
    destroyShip(world, drone, game.ship('ann'));
    destroyShip(world, game.ship('bo'), game.ship('ann'));

    const ann = game.state('pip').players.find((player) => player.id === 'ann');
    assert.equal(ann.kills, 2);
    assert.equal(ann.score, BATTLE_ROYALE.score.ships.drone + BATTLE_ROYALE.score.playerKill);
    const bo = game.state('pip').players.find((player) => player.id === 'bo');
    assert.deepEqual([bo.alive, bo.deaths, bo.score], [false, 1, 0]);
});

test('a ship lost to the collapse or to a computer-flown ship is nobody\'s kill', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    const world = game.world(THIRD);
    destroyShip(world, game.ship('bo'), world.spawnShip('dart', { position: [0, 0, -9000] }));

    assert.equal(game.who('ann').kills, 0);
    assert.equal(game.who('ann').score, 0);
});

// ---- What each player is told ----------------------------------------------------------------

test('the map names comrades only to their own side', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, SECOND], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    const comradesAt = (viewer, planet) => game.state(viewer).planets.find((entry) => entry.id === planet).comrades;

    assert.deepEqual(comradesAt('ann', SECOND), ['cy']);
    assert.deepEqual(comradesAt('ann', THIRD), [], 'not herself, and not the pirates beside her');
    assert.deepEqual(comradesAt('bo', SECOND), [], 'the Umbra pilot is not told where the Federation\'s are');
    assert.deepEqual(comradesAt('pip', THIRD), [], 'pirates have no comrades');
    assert.equal(game.state('ann').you.planet, THIRD);
    assert.equal(JSON.stringify(game.state('bo')).includes('"planet":"' + THIRD + '"'), false, 'nothing in an enemy\'s state says where Ann is');
});

test('what is at a planet is known only to a side with eyes on it; the collapse is known to all', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, SECOND], pip: [PIRATE, THIRD] });
    game.place(FOURTH).owner = UMBRA;
    game.place(GATE).owner = DAWN;
    const seen = (viewer, planet) => game.state(viewer).planets.find((entry) => entry.id === planet);

    const here = seen('ann', THIRD);
    assert.equal(here.known, true, 'where she is');
    assert.equal(here.forces[DAWN], game.npcs(THIRD, DAWN).length + 1, 'her own ship counts');
    assert.equal(here.forces[PIRATE], 1);
    const withComrade = seen('ann', SECOND);
    assert.equal(withComrade.known, true, 'where a comrade is');
    assert.equal(withComrade.forces[UMBRA], game.npcs(SECOND, UMBRA).length + 1, 'Bo\'s ship among them');
    assert.deepEqual([seen('ann', GATE).known, seen('ann', GATE).owner], [true, DAWN], 'a station her side holds reports in');

    const dark = seen('ann', FOURTH);
    assert.deepEqual([dark.known, dark.owner, dark.forces, dark.docking], [false, null, null, null], 'the Umbra\'s station does not');
    assert.equal(seen('pip', SECOND).known, false);
    assert.equal(seen('bo', FOURTH).owner, UMBRA);
    for (const viewer of ['ann', 'bo', 'pip']) {
        assert.ok(game.state(viewer).planets.every((entry) => entry.status === PLANET_STATUS.SAFE && (entry.id === GATE || entry.changesIn > 0)));
    }
});

test('a side with eyes on a planet sees a docking in progress there', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], cy: [DAWN, SECOND], bex: [UMBRA, GATE] });
    game.empty(THIRD);
    game.dock('bo');
    const third = (viewer) => game.state(viewer).planets.find((entry) => entry.id === THIRD);

    assert.equal(third('ann').docking, UMBRA);
    assert.equal(third('cy').docking, UMBRA, 'through Ann\'s eyes');
    assert.equal(third('bex').docking, UMBRA, 'through Bo\'s');
});

// ---- Equipment -------------------------------------------------------------------------------

test('every pilot has one piece of equipment to choose, and can choose it before the ships are even in the system', () => {
    const game = createTestServer(['ann', 'bo'], { start: { settings: { intro: 'play' } } });
    const ask = (name, item) => game.mode.onRequest(game.server.pilots.get(name), BR_REQUEST.PICK, { item });
    const hold = (name) => game.mode.contestants.get(name).inventory;
    assert.equal(game.mode.describeState(game.server.pilots.get('ann')).you.picks, 1);

    for (const junk of ['nuke', '', null, 7, ['beacon'], { item: EQUIPMENT.BEACON }]) ask('ann', junk);
    assert.equal(hold('ann').picks, 1, 'only real equipment');
    ask('ann', EQUIPMENT.OVERDRIVE);
    ask('ann', EQUIPMENT.BEACON);

    assert.deepEqual(hold('ann').describe(), { beacon: 0, gravityShield: 0, emergencyShield: 0, overdrive: 1 });
    assert.equal(hold('ann').picks, 0, 'one choice, one piece');
    assert.equal(hold('bo').picks, 1, 'which can wait: Bo has not chosen yet');

    game.run(BATTLE_ROYALE.intro.seconds + 1);
    ask('bo', EQUIPMENT.EMERGENCY_SHIELD);
    const state = game.mode.describeState(game.server.pilots.get('bo'));
    assert.deepEqual([state.you.picks, state.you.equipment.emergencyShield], [0, 1]);
    assert.ok(game.server.pilots.get('bo').ship.minHull > 0, 'and is armed the moment it is chosen');
});

test('a beacon launched at a neighbouring planet shows it to the pilot\'s side from then on', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, INNERMOST], pip: [PIRATE, THIRD] });
    game.equip('ann', EQUIPMENT.BEACON, 2);
    game.place(FOURTH).owner = UMBRA;
    const fourth = (viewer) => game.state(viewer).planets.find((entry) => entry.id === FOURTH);
    assert.equal(fourth('ann').known, false);

    for (const to of [GATE, INNERMOST, THIRD, 'pluto', null, 4]) game.ask('ann', BR_REQUEST.BEACON, { to });
    assert.equal(game.who('ann').inventory.counts.beacon, 2, 'a beacon only reaches the next orbit');

    game.ask('ann', BR_REQUEST.BEACON, { to: FOURTH });
    assert.deepEqual(game.told('ann', BR_EVENT.BEACON_SET), [{ planet: FOURTH }]);
    const seen = fourth('ann');
    assert.deepEqual([seen.known, seen.beacon, seen.owner], [true, true, UMBRA]);
    assert.equal(seen.forces[DAWN] + seen.forces[UMBRA], game.npcs(FOURTH, DAWN).length + game.npcs(FOURTH, UMBRA).length);
    assert.equal(fourth('cy').known, true, 'her side sees through it too');
    assert.equal(fourth('pip').known, false, 'nobody else does');

    game.ask('ann', BR_REQUEST.BEACON, { to: FOURTH });
    assert.equal(game.who('ann').inventory.counts.beacon, 1, 'a planet already watched costs no second beacon');
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.equal(fourth('ann').known, true, 'it goes on watching after she has left');
});

test('a pirate\'s beacon is nobody else\'s, and a traitor loses sight of their old side\'s', () => {
    const game = arrange({ pip: [PIRATE, THIRD], pat: [PIRATE, THIRD], ann: [DAWN, THIRD], cy: [DAWN, THIRD] });
    game.empty(THIRD);
    game.equip('pip', EQUIPMENT.BEACON);
    game.equip('cy', EQUIPMENT.BEACON);
    const fourth = (viewer) => game.state(viewer).planets.find((entry) => entry.id === FOURTH);
    game.ask('pip', BR_REQUEST.BEACON, { to: FOURTH });
    assert.deepEqual([fourth('pip').known, fourth('pat').known, fourth('ann').known], [true, false, false]);

    game.ask('cy', BR_REQUEST.BEACON, { to: FOURTH });
    assert.equal(fourth('ann').known, true);
    game.mode.brandPirate(game.who('ann'), game.place(THIRD).zone);
    assert.equal(fourth('ann').known, false);
});

test('the gravity shield comes on by itself and keeps the black hole off for thirty seconds - but not the guns', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST], bex: [UMBRA, GATE] });
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.run(2);
    assert.equal(game.who('ann').inventory.counts.gravityShield, 1, 'nothing to shield against yet');

    game.skipTo(goneAt(game, 0));
    assert.equal(game.who('ann').inventory.counts.gravityShield, 0);
    assert.deepEqual(game.told('ann', BR_EVENT.EQUIPMENT_USED), [{ item: EQUIPMENT.GRAVITY_SHIELD }]);
    assert.equal(GEAR.gravityShieldSeconds, 30);
    assert.ok(game.state('ann').you.effects.gravityShield >= GEAR.gravityShieldSeconds - 1);

    const ship = game.ship('ann');
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 2);
    assert.deepEqual([ship.hull, ship.shield], [ship.maxHull, ship.maxShield], 'untouched');
    assert.equal(game.who('bo').alive, false, 'Bo, beside her, had none');
    applyDamage(game.world(INNERMOST), ship, 40, {});
    assert.ok(ship.shield < ship.maxShield, 'a hit is still a hit');
    assert.equal(game.state('ann').you.jump.trapped, true, 'and the shield does not make the drive work');

    game.run(GEAR.gravityShieldSeconds - BATTLE_ROYALE.collapse.swallowedSeconds - 2 + 1);
    assert.equal(game.state('ann').you.effects.gravityShield, 0);
    assert.ok(ship.hull + ship.shield < ship.maxHull + ship.maxShield - 5, 'then the pull is back');
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds);
    assert.equal(game.who('ann').alive, false);
});

test('a gravity shield is not spent where the pilot\'s own bubble already holds the pull off', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.place(INNERMOST).owner = DAWN;
    game.skipTo(goneAt(game, 0));
    game.run(5);

    assert.equal(game.who('ann').inventory.counts.gravityShield, 1);
});

test('thirty shielded seconds are enough to take a swallowed station from its holder', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.place(INNERMOST).owner = UMBRA;
    game.skipTo(goneAt(game, 0));
    game.take('ann');

    assert.equal(game.place(INNERMOST).owner, DAWN);
    assert.equal(game.state('ann').you.jump.trapped, false, 'and under her own bubble the drive works again');
    game.run(GEAR.gravityShieldSeconds);
    assert.equal(game.ship('ann').alive, true);
});

test('the emergency shield catches the hit that would have killed and holds the hull at a sliver for ten seconds', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.empty(THIRD);
    game.equip('ann', EQUIPMENT.EMERGENCY_SHIELD);
    const ship = game.ship('ann');
    const world = game.world(THIRD);
    const sliver = ship.maxHull * GEAR.emergencyHull;

    applyDamage(world, ship, 60, { source: game.ship('bo') });
    game.run(0.1);
    assert.equal(game.who('ann').inventory.counts.emergencyShield, 1, 'an ordinary hit does not set it off');

    applyDamage(world, ship, 100000, { source: game.ship('bo') });
    assert.equal(ship.alive, true);
    assert.ok(Math.abs(ship.hull - sliver) < 1e-9 && ship.shield === 0, `hull ${ship.hull}`);
    game.run(0.1);
    assert.equal(game.who('ann').inventory.counts.emergencyShield, 0);
    assert.deepEqual(game.told('ann', BR_EVENT.EQUIPMENT_USED), [{ item: EQUIPMENT.EMERGENCY_SHIELD }]);
    assert.equal(GEAR.emergencyShieldSeconds, 10);
    assert.equal(game.state('ann').you.effects.emergencyShield, GEAR.emergencyShieldSeconds);

    for (let second = 0; second < GEAR.emergencyShieldSeconds - 1; second++) {
        applyDamage(world, ship, 100000, { source: game.ship('bo') });
        game.run(1);
    }
    assert.equal(ship.alive, true, 'nothing gets through while it is on');
    assert.ok(Math.abs(ship.hull - sliver) < 1e-9);
    game.run(0.8);
    assert.equal(ship.shield, 0, 'and nothing mends: not after ten quiet seconds either');

    game.run(0.5);
    assert.equal(game.state('ann').you.effects.emergencyShield, 0);
    game.run(ship.cls.shieldDelay + 1);
    assert.ok(ship.shield > 0, 'once it is off the shield comes back');
    applyDamage(world, ship, 100000, { source: game.ship('bo') });
    assert.equal(ship.alive, false, 'and the next such hit kills');
});

test('a second emergency shield is a second life, not a longer first one', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.empty(THIRD);
    game.equip('ann', EQUIPMENT.EMERGENCY_SHIELD, 2);
    const ship = game.ship('ann');
    applyDamage(game.world(THIRD), ship, 100000, {});
    game.run(GEAR.emergencyShieldSeconds + 1);
    assert.equal(game.who('ann').inventory.counts.emergencyShield, 1, 'the second waits for the next blow');
    assert.equal(game.state('ann').you.effects.emergencyShield, 0);

    applyDamage(game.world(THIRD), ship, 100000, {});
    game.run(0.1);
    assert.equal(ship.alive, true);
    assert.equal(game.who('ann').inventory.counts.emergencyShield, 0);
});

test('the emergency shield holds against the black hole too, and survives a jump unspent', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    game.empty(SECOND);
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.EMERGENCY_SHIELD);
    game.skipTo(goneAt(game, 0) + 1);
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: INNERMOST });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.ok(game.ship('ann').minHull > 0, 'the new ship is armed like the old one');

    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + GEAR.emergencyShieldSeconds - 2);
    assert.equal(game.who('ann').alive, true, 'ten seconds longer than anybody else');
    game.run(4);
    assert.equal(game.who('ann').alive, false);
});

test('an overdrive chip lets one jump cross two orbits; a jump to the next orbit leaves it alone', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST] });
    game.equip('ann', EQUIPMENT.OVERDRIVE);
    assert.equal(game.state('ann').you.jump.reach, GEAR.overdriveReach);
    assert.equal(game.state('bo').you.jump.reach, 1);
    game.chargeJump('ann');
    game.chargeJump('bo');

    game.ask('bo', BR_REQUEST.JUMP, { to: THIRD });
    assert.deepEqual(game.told('bo', BR_EVENT.JUMP_REFUSED), [{ reason: JUMP_REFUSAL.NOT_ADJACENT }], 'not without the chip');
    game.ask('ann', BR_REQUEST.JUMP, { to: FOURTH });
    assert.equal(game.who('ann').jump, null, 'three orbits are too many even with it');

    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.equal(game.pilot('ann').zone.id, SECOND);
    assert.equal(game.who('ann').inventory.counts.overdrive, 1, 'an ordinary jump: the chip is untouched');

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: FOURTH });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    assert.equal(game.pilot('ann').zone.id, FOURTH);
    assert.equal(game.who('ann').inventory.counts.overdrive, 0);
    assert.deepEqual(game.told('ann', BR_EVENT.EQUIPMENT_USED), [{ item: EQUIPMENT.OVERDRIVE }]);

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('ann').jump, null, 'one chip, one long jump');
});

test('a chip is not burnt by a long jump that never happens', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.equip('ann', EQUIPMENT.OVERDRIVE);
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: THIRD });
    destroyShip(game.world(INNERMOST), game.ship('ann'), null);
    game.run(BATTLE_ROYALE.jump.spool + 0.3);

    assert.equal(game.who('ann').inventory.counts.overdrive, 1);
});

test('a player who leaves is out of the match and off the board', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], pip: [PIRATE, SECOND] });
    game.server.removePlayer('bo');
    game.run(0.2);

    assert.deepEqual(game.state('ann').players.map((player) => player.id), ['ann', 'pip']);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING);
    game.server.removePlayer('pip');
    game.run(0.2);
    assert.equal(game.state('ann').winner, DAWN, 'the last side left wins');
});

// ---- With real clients -----------------------------------------------------------------------

test('on a player\'s device a jump is a new sky, a warp, and the same ship', () => {
    const match = createTestMatch(['host', 'ann'], { start: { settings: { pace: 'quick' } } });
    match.run(0.5);
    const [ann] = match.clients;
    const mode = match.server.mode;
    const from = match.server.pilots.get('ann').zone.id;
    const to = mode.map.neighbours(from)[0];
    assert.equal(ann.ui.match.you.planet, from);
    assert.equal(ann.world.sectorId, mode.map.planet(from).sectorId);
    const warps = [];
    ann.session.events.on('warp', ({ stage }) => warps.push(stage));
    mode.contestants.get('ann').jumpReadyAt = 0;

    ann.match.request(BR_REQUEST.JUMP, { to });
    match.run(1);
    assert.ok(ann.world.warpFactor > 0.2, 'the warp is spooling up on screen');
    match.run(BATTLE_ROYALE.jump.spool + 1.5);

    assert.equal(ann.ui.match.you.planet, to);
    assert.equal(ann.world.sectorId, mode.map.planet(to).sectorId);
    assert.equal(ann.world.player.pilotId, 'ann');
    assert.equal(ann.world.player.alive, true);
    assert.deepEqual(warps, ['spool', 'arrive']);
    assert.ok(ann.world.warpFactor < 0.2, 'and lets go on arrival');
    assert.ok(ann.ui.match.you.jump.cooldown > 0);
});

test('on a player\'s device one key docks and lets go; while docked the helm is the station\'s', () => {
    const match = createTestMatch(['host', 'ann'], { start: { settings: { pace: 'quick' } } });
    match.run(0.5);
    const [ann] = match.clients;
    const mode = match.server.mode;
    const contestant = mode.contestants.get('ann');
    const place = mode.placeOf(contestant);
    for (const ship of [...place.zone.world.ships]) if (!ship.isPlayer && ship.faction !== FACTION.NEUTRAL) place.zone.world.removeShip(ship);
    const { presenter } = ann.match;
    const toasts = [];
    const showToast = ann.session.showToast.bind(ann.session);
    ann.session.showToast = (key, params) => { toasts.push(key); showToast(key, params); };
    match.run(0.3);
    assert.equal(ann.session.waypoint?.labelKey, 'mp.waypoint.dock', 'the dock is marked');
    assert.ok(ann.session.waypoint.position.distanceTo(place.station.mouth) < 1, 'where the host has it');
    assert.equal(ann.session.missionHud().objective.key, 'mp.objective.station');

    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(0.5);
    assert.deepEqual(toasts, ['mp.dock.refused.tooFar'], 'too far away: the host says so');

    const ship = match.server.pilots.get('ann').ship;
    ship.position.copy(place.station.mouth);
    ship.velocity.set(0, 0, 0);
    match.run(0.5);
    assert.equal(ann.ui.match.you.dock.ready, true);
    ann.controls.firePrimary = true;
    ann.controls.throttleTarget = 1;
    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(2);

    assert.ok(ann.ui.match.you.dock.left > 0);
    assert.equal(presenter.holdsAttention(), true);
    assert.equal(ann.session.waypoint, null, 'no marker while docked');
    assert.equal(ann.session.missionHud().objective.key, 'mp.objective.docking');
    assert.ok(ann.world.player.position.distanceTo(place.station.berth) < 5, 'the device shows the ship at its berth');
    assert.equal(ann.world.player.beamFiring, false);
    assert.equal(ship.beamFiring, false);

    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(0.5);
    assert.equal(ann.ui.match.you.dock.left, null, 'the same key lets go');
    assert.equal(ship.beamFiring, true);
    assert.ok(toasts.includes('mp.dock.ended.released'));

    ann.controls.firePrimary = false;
    ship.position.copy(place.station.mouth);
    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(BATTLE_ROYALE.station.seconds + 1);
    const here = ann.ui.match.planets.find((planet) => planet.id === ann.ui.match.you.planet);
    assert.equal(here.owner, ann.ui.match.you.faction);
    assert.equal(ann.ui.match.you.picks, 2, 'one from the start, one for the station');
    assert.ok(toasts.includes('mp.captured') && toasts.includes('mp.equipment.earned'));
    assert.equal(ann.session.waypoint, null, 'nothing more to fly to here');
});

test('equipment is chosen and used from the pilot\'s own windows', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    const [ann] = match.clients;
    const { presenter } = ann.match;
    const mode = match.server.mode;

    ann.session.handleAction(MATCH_ACTION.EQUIPMENT);
    assert.equal(ann.ui.matchPanel, MATCH_PANEL.EQUIPMENT);
    assert.equal(presenter.holdsAttention(), true);
    presenter.pickEquipment(EQUIPMENT.BEACON);
    match.run(0.5);
    assert.deepEqual([ann.ui.match.you.equipment.beacon, ann.ui.match.you.picks], [1, 0]);
    ann.session.handleAction(MATCH_ACTION.EQUIPMENT);
    assert.equal(ann.ui.matchPanel, null, 'the same key closes it');

    const here = ann.ui.match.you.planet;
    const [next] = mode.map.neighbours(here);
    const unseen = () => ann.ui.match.planets.find((planet) => planet.id === next);
    mode.places.get(next).owner = FACTION.UMBRA;
    for (const other of mode.contestants.values()) {
        if (other.pilot.id !== 'ann' && other.pilot.zone.id === next) mode.launch(other, mode.places.get(GATE), { warpIn: false });
    }
    match.run(0.5);
    if (ann.ui.match.you.faction === FACTION.UMBRA) mode.places.get(next).owner = FACTION.DAWN;
    match.run(0.5);
    assert.equal(unseen().known, false);
    presenter.launchBeacon(next);
    match.run(0.5);
    assert.deepEqual([unseen().known, unseen().beacon, ann.ui.match.you.equipment.beacon], [true, true, 0]);
    assert.ok(unseen().owner);
});

test('every device learns its side, the map and the result', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { start: { settings: { pace: 'quick' } } });
    match.run(0.5);
    const mode = match.server.mode;

    for (const device of match.devices) {
        const state = device.ui.match;
        assert.equal(state.mode, 'battleRoyale');
        assert.equal(state.localId, device.id);
        assert.equal(state.you.faction, mode.contestants.get(device.id).faction);
        assert.equal(device.world.player.faction, state.you.faction, 'and flies in its colours');
        assert.equal(state.planets.length, PLANETS.length);
        assert.equal(state.players.length, 3);
    }

    mode.finish(DAWN);
    match.run(BATTLE_ROYALE.outro.seconds + 0.5);
    for (const device of match.devices) {
        assert.equal(device.ui.match.phase, MATCH_PHASE.OVER);
        assert.equal(device.ui.match.winner, DAWN);
        assert.equal(device.session.phase, 'matchover');
    }
});

test('a refit and a change of sides show on the other devices too', () => {
    const match = createTestMatch(['host', 'ann'], { start: { settings: { pace: 'quick' } } });
    const mode = match.server.mode;
    // Put both at one planet so each sees the other.
    const annSeat = mode.contestants.get('ann');
    const hostSeat = mode.contestants.get('host');
    hostSeat.pilot.zone.world.removeShip(hostSeat.pilot.ship);
    mode.launch(hostSeat, mode.placeOf(annSeat), { warpIn: false });
    match.run(0.5);
    const [ann] = match.clients;
    const annOnHost = match.host.world.ships.find((ship) => ship.pilotId === 'ann');
    const hullBefore = annOnHost.maxHull;

    annSeat.points = 2;
    ann.match.request(BR_REQUEST.REFIT, { added: { hull: 2 } });
    match.run(0.3);
    assert.ok(annOnHost.maxHull > hullBefore, 'the host\'s copy of Ann\'s ship is refitted');
    assert.ok(ann.world.player.maxHull > hullBefore, 'and her own');
    assert.equal(ann.ui.match.you.points, 0);

    mode.brandPirate(annSeat, annSeat.pilot.zone);
    match.run(0.3);
    assert.equal(annOnHost.faction, PIRATE);
    assert.equal(ann.world.player.faction, PIRATE);
    assert.equal(ann.ui.match.you.faction, PIRATE);
});

// ---- The introduction ------------------------------------------------------------------------

const withIntro = { settings: { intro: 'play' } };

test('during the introduction nobody is in the system, and nothing there moves', () => {
    const { server, mode, run } = createTestServer(['a', 'b', 'c'], { start: withIntro });
    run(BATTLE_ROYALE.intro.seconds - 1);

    for (const pilot of server.pilots.values()) {
        assert.equal(pilot.ship, null);
        assert.equal(pilot.zone, null);
    }
    for (const zone of server.zones.values()) {
        assert.equal(zone.world.ships.some((ship) => ship.isPlayer), false);
        assert.equal(zone.world.time, 0, 'no zone is being simulated: nothing can happen to anybody');
    }
    const state = mode.describeState(server.pilots.get('a'));
    assert.ok(state.intro >= 1 && state.intro <= 2, 'counting down in whole seconds');
    assert.equal(state.phase, MATCH_PHASE.PLAYING);
    assert.equal(state.you.planet, null);
    assert.equal(state.you.alive, true);
    assert.equal(state.players.length, 3, 'but everybody already knows who is on which side');
    assert.ok(state.players.every((player) => [DAWN, UMBRA, PIRATE].includes(player.faction)));
});

test('when the introduction ends every ship drops out of warp, and only then do the clocks start', () => {
    const { server, mode, run } = createTestServer(['a', 'b', 'c'], { start: withIntro });
    run(BATTLE_ROYALE.intro.seconds + 0.2);

    for (const contestant of mode.contestants.values()) {
        const { pilot } = contestant;
        assert.ok(pilot.ship?.alive, `${pilot.id} has a ship`);
        assert.equal(pilot.zone.id, contestant.start.planet.id);
        assert.equal(pilot.ship.faction, contestant.faction);
        // The jump drive charges from arrival, not from the start of the story.
        assert.ok(contestant.jumpReadyAt >= BATTLE_ROYALE.intro.seconds + BATTLE_ROYALE.jump.cooldown - 0.1);
    }
    assert.equal(mode.describeState(server.pilots.get('a')).intro, null);
    assert.ok(Math.abs(mode.startedAt - BATTLE_ROYALE.intro.seconds) < 0.1);

    // The first planet starts to fall in `firstAfter` seconds after the ships arrived.
    const first = mode.clock.schedule[0].startsAt;
    server.time = mode.startedAt + first - 1;
    run(0.1);
    assert.equal(mode.places.get(INNERMOST).status, PLANET_STATUS.SAFE);
    server.time = mode.startedAt + first + 1;
    run(0.1);
    assert.equal(mode.places.get(INNERMOST).status, PLANET_STATUS.COLLAPSING);
});

test('ships arrive out of warp, which nothing can hit', () => {
    const { server, run } = createTestServer(['a', 'b'], { start: withIntro });
    run(BATTLE_ROYALE.intro.seconds + 0.1);

    for (const pilot of server.pilots.values()) assert.equal(pilot.ship.arriving, true);
});

test('nothing can be asked for during the introduction', () => {
    const { server, mode, run } = createTestServer(['a', 'b'], { start: withIntro });
    run(1);
    const pilot = server.pilots.get('a');
    mode.contestants.get('a').points = 3;

    mode.onRequest(pilot, BR_REQUEST.JUMP, { to: SECOND });
    mode.onRequest(pilot, BR_REQUEST.REFIT, { added: { hull: 1 } });
    mode.onRequest(pilot, BR_REQUEST.SUMMON, {});

    assert.equal(mode.contestants.get('a').jump, null);
    assert.equal(mode.contestants.get('a').points, 3);
    assert.equal(pilot.ship, null);
});

test('a player who leaves during the introduction never enters the system', () => {
    const { server, mode, run } = createTestServer(['a', 'b', 'c'], { start: withIntro });
    run(2);
    server.removePlayer('b');
    run(BATTLE_ROYALE.intro.seconds);

    assert.equal(server.pilots.get('b').ship, null);
    assert.ok(server.pilots.get('a').ship?.alive);
    assert.deepEqual(mode.describeState(server.pilots.get('a')).players.map((player) => player.id).sort(), ['a', 'c']);
});

test('the introduction is not shortened by a quick match', () => {
    const { mode } = createTestServer(['a'], { start: { settings: { intro: 'play', pace: 'quick' } } });
    assert.equal(mode.introLeft, BATTLE_ROYALE.intro.seconds);
    assert.equal(BATTLE_ROYALE.intro.seconds, 10);
});

test('on each device the introduction shows the sides and their pilots before any ship exists', () => {
    const match = createTestMatch(['host', 'ann', 'bo', 'cy'], { start: withIntro });
    const cues = [];
    const music = [];
    match.clients[0].session.events.on('cue', ({ id }) => cues.push(id));
    match.clients[0].session.events.on('music', ({ id }) => music.push(id));
    match.run(2);

    for (const device of match.devices) {
        const state = device.ui.match;
        assert.ok(state.intro >= 8 && state.intro <= 9, `${device.id} is counting down`);
        assert.equal(device.world.player, null, 'not in the system');
        assert.equal(device.world.ships.length, 0);
        assert.equal(device.world.sectorId, BATTLE_ROYALE.intro.sectorId, 'looking at the dying sun');
        assert.equal(device.session.phase, 'playing');
        const roster = rosterBySide(state);
        assert.deepEqual(roster.map((side) => side.faction), [DAWN, UMBRA, PIRATE]);
        assert.equal(roster.reduce((sum, side) => sum + side.players.length, 0), 4, 'every pilot is listed under a side');
        assert.ok(roster.every((side) => side.players.length >= 1));
        const own = roster.find((side) => side.faction === state.you.faction);
        assert.ok(own.players.some((player) => player.id === device.id), 'each under their own');
    }
    assert.deepEqual(cues, ['matchIntro']);
    assert.deepEqual(music, ['calm']);

    match.run(BATTLE_ROYALE.intro.seconds - 2 + 0.5);
    for (const device of match.devices) {
        assert.equal(device.ui.match.intro, null);
        assert.equal(device.world.player?.pilotId, device.id, `${device.id} is in a ship now`);
        assert.equal(device.ui.match.you.planet, match.server.pilots.get(device.id).zone.id);
    }
    assert.deepEqual(music, ['calm', 'battle']);
});

test('the map and the refit window do not open over the introduction', () => {
    const match = createTestMatch(['host', 'ann'], { start: withIntro });
    match.run(1);
    const [ann] = match.clients;

    ann.session.handleAction('match:map');
    ann.session.handleAction('match:refit');
    match.run(0.2);

    assert.equal(ann.ui.matchPanel ?? null, null);
    assert.equal(ann.ui.refit ?? null, null);
    assert.equal(match.server.pilots.get('ann').guard.strikes, 0, 'and nothing was sent to the host about it');
});

// ---- The ending ------------------------------------------------------------------------------

/** A three-player match that has just been won by the side of `winnerId`. */
function decided(winnerId = 'host') {
    const match = createTestMatch(['host', 'ann', 'bo']);
    match.run(0.5);
    const mode = match.server.mode;
    const winner = mode.contestants.get(winnerId).faction;
    mode.finish(winner);
    return { match, mode, winner, winners: match.devices.filter((device) => mode.contestants.get(device.id).faction === winner), losers: match.devices.filter((device) => mode.contestants.get(device.id).faction !== winner) };
}

test('a decided match plays its ending before the result', () => {
    const { match, winner } = decided();
    match.run(1);

    for (const device of match.devices) {
        assert.equal(device.ui.match.phase, MATCH_PHASE.OVER);
        assert.equal(device.session.phase, 'playing', 'the result screen is not up yet');
        assert.deepEqual(device.ui.matchOutro, { winner, won: device.ui.match.you.faction === winner });
        assert.equal(device.world.controlsLocked, true, 'nobody flies during it');
    }

    match.run(BATTLE_ROYALE.outro.seconds);
    for (const device of match.devices) {
        assert.equal(device.session.phase, 'matchover');
        assert.equal(device.ui.matchOutro, null);
    }
});

test('the winners jump through the gate; everybody else is left to the dark', () => {
    const { match, winners, losers } = decided();
    assert.ok(winners.length >= 1 && losers.length >= 1);
    const heard = new Map(match.devices.map((device) => [device, { cues: [], music: [], warps: [] }]));
    for (const [device, log] of heard) {
        device.session.events.on('cue', ({ id }) => log.cues.push(id));
        device.session.events.on('music', ({ id }) => log.music.push(id));
        device.session.events.on('warp', ({ stage }) => log.warps.push(stage));
    }
    match.run(BATTLE_ROYALE.outro.seconds / 2);

    for (const device of winners) {
        assert.ok(device.world.warpFactor > 0.1, 'the jump is building');
        assert.equal(device.world.screenFade, 0);
        assert.deepEqual(heard.get(device).cues, ['victory']);
        assert.deepEqual(heard.get(device).music, ['finale']);
    }
    for (const device of losers) {
        assert.ok(device.world.screenFade > 0.2, 'the dark is closing in');
        assert.equal(device.world.warpFactor, 0);
        assert.deepEqual(heard.get(device).cues, ['defeat']);
    }

    match.run(BATTLE_ROYALE.outro.seconds / 2 + 0.3);
    for (const device of winners) assert.deepEqual(heard.get(device).warps, ['arrive'], 'and they are through');
    for (const device of losers) assert.deepEqual(heard.get(device).warps, []);
});

test('a match nobody won ends in the dark for everyone', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    match.server.mode.finish(null);
    match.run(1);

    for (const device of match.devices) {
        assert.deepEqual(device.ui.matchOutro, { winner: null, won: false });
        assert.ok(device.world.screenFade > 0);
    }
});

test('the ending closes whatever window was open', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    const [ann] = match.clients;
    ann.session.handleAction('match:map');
    assert.equal(ann.ui.matchPanel, 'map');

    match.server.mode.finish(DAWN);
    match.run(0.5);
    ann.session.handleAction('match:map');

    assert.equal(ann.ui.matchPanel, null);
});

test('losing the link skips the ending: there is nothing to celebrate or mourn', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    const [ann] = match.clients;

    ann.link.close();
    match.run(0.2);

    assert.equal(ann.ui.match.phase, MATCH_PHASE.DISCONNECTED);
    assert.equal(ann.session.phase, 'matchover');
    assert.equal(ann.ui.matchOutro ?? null, null);
});

test('leaving during the ending leaves nothing of it behind', () => {
    const { match, losers } = decided();
    match.run(2);
    const device = losers[0];

    device.session.enterTitle();

    assert.equal(device.world.screenFade, 0);
    assert.equal(device.world.warpFactor, 0);
    assert.equal(device.ui.matchOutro, null);
    assert.equal(device.session.phase, 'title');
});
