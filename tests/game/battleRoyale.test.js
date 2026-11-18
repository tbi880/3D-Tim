import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { BATTLE_ROYALE, NPC_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { PLAYER_SHIPS } from '../../src/game/config/playerShips.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { applyDamage, areHostile, destroyShip, mayAttack } from '../../src/game/core/systems/damage.js';
import { LOYALTY } from '../../src/game/modes/battleRoyale/allegiance.js';
import { BR_EVENT, BR_REQUEST, DOCK_END, DOCK_REFUSAL, JUMP_REFUSAL, RESPAWN_REFUSAL } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
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
/** The whole ending: through the gate, then the system's fall. */
const ENDING_SECONDS = BATTLE_ROYALE.outro.seconds + BATTLE_ROYALE.outro.fall.seconds;

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
    const gate = gateWorld.findByTag(GATE_TAG);
    assert.ok(gate, 'the stargate');
    assert.equal(gate.classId, BATTLE_ROYALE.gate.classId);
    assert.deepEqual([gate.faction, gate.invulnerable, gate.targetable], [FACTION.NEUTRAL, true, false]);
    assert.notEqual(gate, mode.places.get(GATE).station.ship, 'it is not the station: that is what is fought over');
    for (const place of mode.places.values()) {
        assert.equal(place.zone.world.ships.filter((ship) => ship.tags.has(GATE_TAG)).length, place.planet.id === GATE ? 1 : 0);
    }
    assert.ok(NPC_FACTIONS.every((faction) => gateWorld.ships.some((ship) => ship.faction === faction)), 'both fleets wait at the gate');
});

test('players are dealt into sides, each flying for the side they got: ten of them four, four and two', () => {
    for (let seed = 1; seed <= 12; seed++) {
        const names = Array.from({ length: 10 }, (_, index) => `p${index}`);
        const { server, mode } = createTestServer(names, { start: { seed } });
        const sides = [...mode.contestants.values()].map((contestant) => contestant.faction);
        assert.deepEqual([DAWN, UMBRA, PIRATE].map((faction) => sides.filter((side) => side === faction).length), [4, 4, 2]);
        for (const contestant of mode.contestants.values()) {
            const { pilot } = contestant;
            assert.equal(pilot.ship.faction, contestant.faction);
            assert.equal(pilot.ship.callsign, pilot.name);
            assert.notEqual(pilot.zone.id, GATE, 'nobody starts at the gate');
        }
        const zoneOf = (faction) => [...mode.contestants.values()].filter((c) => c.faction === faction).map((c) => c.pilot.zone.id);
        assert.equal(new Set(zoneOf(DAWN)).size, 1, 'a side starts together');
        assert.equal(new Set(zoneOf(UMBRA)).size, 1);
        assert.equal(new Set(zoneOf(PIRATE)).size, 1, 'the pirates too');
        assert.ok(server.pilots.size === 10);
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

// ---- No shelter from the collapse --------------------------------------------------------------

/** Ann (Federation) has just taken the innermost planet; Bo (Umbra) and Pip (pirate) are there too in the tests that need them. */
function heldInnermost(seats) {
    const game = arrange(seats);
    game.clear(INNERMOST, DAWN);
    game.clear(INNERMOST, UMBRA);
    game.place(INNERMOST).owner = DAWN;
    return game;
}

test('holding a planet\'s station is no shelter: the side that holds it bleeds as the planet falls in, like everybody', () => {
    const game = heldInnermost({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST], pip: [PIRATE, INNERMOST] });
    game.skipTo(startsAt(game, 0) + 0.1);
    const whole = (name) => game.ship(name).hull + game.ship(name).shield;
    const before = { ann: whole('ann'), bo: whole('bo'), pip: whole('pip') };
    game.run(5);

    const lost = (name) => before[name] - whole(name);
    assert.ok(lost('ann') > 5, `Ann, who holds it, lost ${lost('ann')}`);
    assert.ok(lost('bo') > 5 && lost('pip') > 5);
});

test('once the countdown runs out nobody leaves a swallowed planet, and nobody there survives - its holders included', () => {
    const game = heldInnermost({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST], bex: [UMBRA, GATE] });
    game.skipTo(goneAt(game, 0) + 0.1);
    assert.equal(game.state('ann').you.jump.trapped, true);
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('ann').jump, null);
    assert.deepEqual(game.told('ann', BR_EVENT.JUMP_REFUSED), [{ reason: JUMP_REFUSAL.TRAPPED }]);

    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 1);
    assert.deepEqual([game.who('ann').alive, game.who('bo').alive], [false, false]);
});

test('a swallowed planet\'s station goes down with it: nobody holds it, whoever was docked is let go, nobody docks again', () => {
    const game = heldInnermost({ ann: [DAWN, INNERMOST], bo: [UMBRA, INNERMOST], bex: [UMBRA, GATE] });
    game.skipTo(goneAt(game, 0) - 2);
    game.dock('bo');
    assert.ok(game.who('bo').dock, 'Bo starts taking it while the planet is still falling in');
    game.run(2.2);

    assert.equal(game.place(INNERMOST).status, PLANET_STATUS.SWALLOWED);
    assert.equal(game.place(INNERMOST).owner, null);
    assert.equal(game.who('bo').dock, null);
    assert.deepEqual(game.told('bo', BR_EVENT.UNDOCKED), [{ reason: DOCK_END.SWALLOWED }]);
    assert.equal(game.state('ann').planets.find((planet) => planet.id === INNERMOST).owner, null, 'and the map says so');

    game.dock('ann');
    assert.equal(game.who('ann').dock, null);
    assert.deepEqual(game.told('ann', BR_EVENT.DOCK_REFUSED), [{ reason: DOCK_REFUSAL.SWALLOWED }]);
});

test('a garrison at its side\'s station dies with the planet like anybody', () => {
    // (Ann's gravity shield keeps her there to watch - and the planet's ships in play - a little longer than the garrison lasts.)
    const game = arrange({ ann: [DAWN, INNERMOST], cy: [DAWN, GATE], bex: [UMBRA, GATE] });
    game.clear(INNERMOST, UMBRA);
    if (game.npcs(INNERMOST, DAWN).length === 0) game.world(INNERMOST).spawnShip('dart', { position: [0, 0, 0] });
    game.place(INNERMOST).owner = DAWN;
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.skipTo(goneAt(game, 0) + 0.1);
    game.run(BATTLE_ROYALE.collapse.swallowedSeconds + 2);

    assert.equal(game.npcs(INNERMOST, DAWN).length, 0);
});

test('a deserted planet is swept clean when it is swallowed, its holder\'s garrison too; the station itself is scenery and stays', () => {
    const game = arrange({ ann: [DAWN, GATE], bex: [UMBRA, GATE] });
    game.place(INNERMOST).owner = DAWN;
    if (game.npcs(INNERMOST, DAWN).length === 0) game.world(INNERMOST).spawnShip('dart', { position: [0, 0, 0] });
    assert.equal(game.place(INNERMOST).zone.active, false, 'nobody is there');
    game.skipTo(goneAt(game, 0) + 0.1);

    assert.equal(game.npcs(INNERMOST, DAWN).length + game.npcs(INNERMOST, UMBRA).length, 0);
    assert.ok(game.world(INNERMOST).findByTag(STATION_TAG), 'the station model is left to the scenery');
});

// ---- Taking a planet brings the fallen back ----------------------------------------------------

const { respawn: RESPAWN } = BATTLE_ROYALE;

/**
 * True when a ship is where pilots coming back start: in front of the door of the station's
 * departure hangar, nose out along the lane, throttle open, no warp - and not knocked about.
 */
function leftTheStation(game, ship, planet) {
    const { station } = game.place(planet);
    const exit = station.toWorld(RESPAWN.exit, new Vector3());
    const out = new Vector3(0, 0, -1).applyQuaternion(station.ship.quaternion);
    const heading = new Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    // (A few metres more than the spread: it may have been under way for a frame or two.)
    return ship.position.distanceTo(exit) <= Math.hypot(...RESPAWN.spread) + 60 && heading.dot(out) > 0.99
        && ship.throttle === 1 && !ship.arriving && ship.hull === ship.maxHull;
}

/** Ann and Cy (Federation) at a planet whose station Ann has just taken; Di, of their side, was shot down elsewhere. */
function captureWithFallen() {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], di: [DAWN, SECOND], bo: [UMBRA, GATE] });
    game.empty(THIRD);
    destroyShip(game.world(SECOND), game.ship('di'), null);
    game.take('ann');
    return game;
}

test('taking a planet brings every fallen pilot of the side back to it at once', () => {
    const game = captureWithFallen();

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.who('di').alive, true);
    assert.equal(game.ship('di').alive, true);
    assert.equal(game.pilot('di').zone.id, THIRD, 'at the planet that was taken, wherever they fell');
    assert.equal(game.ship('di').faction, DAWN);
    assert.ok(leftTheStation(game, game.ship('di'), THIRD), 'out of its departure hangar, under full throttle');
    assert.deepEqual(game.told('di', BR_EVENT.REVIVED), [{ planet: THIRD }]);
    assert.equal(game.state('di').you.respawn, null, 'nothing more to wait for');
    assert.equal(game.who('di').respawns, 0, 'being brought back does not lengthen the next wait');
    assert.ok(game.who('di').jumpReadyAt > game.server.time, 'the jump drive starts uncharged, as on arriving anywhere');
});

test('and the side that took it is paid all the same: there is nothing to choose between', () => {
    const game = captureWithFallen();

    assert.deepEqual([game.who('ann').points, game.who('cy').points], [3, 3]);
    assert.deepEqual([game.who('ann').summons, game.who('cy').summons], [1, 1]);
    assert.deepEqual([game.who('di').points, game.who('di').summons], [0, 0], 'only those who were there are paid');
    const picks = (name) => game.who(name).inventory.picks;
    assert.deepEqual([picks('ann'), picks('cy'), picks('di')], [GEAR.startingPicks + 1, GEAR.startingPicks + 1, GEAR.startingPicks]);
    assert.equal('vote' in game.state('ann').you, false, 'nobody is asked anything');
});

test('the fallen of other sides, and players who have left, stay where they are', () => {
    const game = arrange({ ann: [DAWN, THIRD], di: [DAWN, THIRD], bo: [UMBRA, SECOND], pip: [PIRATE, GATE] });
    game.empty(THIRD);
    destroyShip(game.world(SECOND), game.ship('bo'), null);
    destroyShip(game.world(THIRD), game.ship('di'), null);
    game.server.removePlayer('di');
    game.take('ann');

    assert.equal(game.who('bo').alive, false);
    assert.equal(game.who('di').alive, false);
    assert.equal(game.pilot('di').ship, null);
});

test('a station taken back from a side brings back that side\'s fallen too', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], cy: [UMBRA, SECOND] });
    game.empty(THIRD);
    game.place(THIRD).owner = DAWN;
    destroyShip(game.world(SECOND), game.ship('cy'), null);
    game.ship('ann').position.set(0, 0, 9000);
    game.take('bo');

    assert.equal(game.place(THIRD).owner, UMBRA);
    assert.equal(game.who('cy').alive, true);
    assert.equal(game.pilot('cy').zone.id, THIRD);
});

// ---- Coming back at a station -------------------------------------------------------------------

test('a pilot shot down waits ten seconds, then comes back at a station their side holds', () => {
    // (Cy keeps the Federation in the match meanwhile: a side with nobody flying is out.)
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD], cy: [DAWN, SECOND] });
    game.empty(SECOND);
    game.place(FOURTH).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), game.ship('bo'));
    game.run(0.1);

    const waiting = game.state('ann').you.respawn;
    assert.equal(waiting.wait, RESPAWN.wait);
    assert.deepEqual(waiting.stations, [FOURTH]);
    assert.equal(waiting.choose, null, 'no clock to choose while the wait is on');
    assert.equal(waiting.next, RESPAWN.wait + RESPAWN.waitStep, 'the wait after this comeback');
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    assert.equal(game.who('ann').alive, false);
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.WAITING }]);

    game.run(RESPAWN.wait);
    const ready = game.state('ann').you.respawn;
    assert.equal(ready.wait, 0);
    assert.ok(ready.choose > 0 && ready.choose <= RESPAWN.choose);
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });

    assert.equal(game.who('ann').alive, true);
    assert.equal(game.pilot('ann').zone.id, FOURTH);
    assert.equal(game.ship('ann').faction, DAWN);
    assert.equal(game.ship('ann').hull, game.ship('ann').maxHull, 'a new ship');
    assert.ok(leftTheStation(game, game.ship('ann'), FOURTH), 'out of the departure hangar, throttle open, the helm hers');
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWNED), [{ planet: FOURTH }]);
    assert.equal(game.state('ann').you.respawn, null);
    assert.ok(game.who('ann').jumpReadyAt > game.server.time, 'the jump drive starts uncharged');
});

test('every comeback makes the next wait ten seconds longer: 10, 20, 30', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, GATE], cy: [DAWN, SECOND] });
    game.empty(GATE);
    game.empty(SECOND);
    game.place(THIRD).owner = DAWN;
    const waits = [];
    for (let round = 0; round < 3; round++) {
        destroyShip(game.world(THIRD), game.ship('ann'), null);
        game.run(0.1);
        waits.push(game.state('ann').you.respawn.wait);
        game.run(game.state('ann').you.respawn.wait);
        game.ask('ann', BR_REQUEST.RESPAWN, { at: THIRD });
        assert.equal(game.who('ann').alive, true, `round ${round + 1}`);
    }
    assert.deepEqual(waits, [10, 20, 30]);
    assert.equal(game.who('ann').respawns, 3);
});

test('a ship can only come back at a station its side holds, and only once it is down', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, SECOND], cy: [DAWN, INNERMOST] });
    game.empty(INNERMOST);
    game.place(FOURTH).owner = DAWN;
    game.place(SECOND).owner = UMBRA;
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.FLYING }], 'a pilot still flying cannot');

    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + 0.1);
    for (const at of [SECOND, THIRD, 'pluto', '__proto__', 5, null, { at: FOURTH }]) game.ask('ann', BR_REQUEST.RESPAWN, { at });
    game.ask('ann', BR_REQUEST.RESPAWN);

    assert.equal(game.who('ann').alive, false);
    assert.equal(game.told('ann', BR_EVENT.RESPAWN_REFUSED).filter(({ reason }) => reason === RESPAWN_REFUSAL.NOT_HELD).length, 8);
});

test('a pilot who does not choose is sent to the first station offered when the clock runs out', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, GATE] });
    game.empty(SECOND);
    game.empty(GATE);
    for (const planet of [SECOND, FOURTH]) game.place(planet).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + 0.1);
    assert.deepEqual(game.state('ann').you.respawn.stations, [SECOND, FOURTH], 'where a comrade is flying first');

    game.run(RESPAWN.choose - 0.5);
    assert.equal(game.who('ann').alive, false, 'not before the clock has run out');
    game.run(1);
    assert.equal(game.who('ann').alive, true);
    assert.equal(game.pilot('ann').zone.id, SECOND);
    assert.equal(game.who('ann').respawns, 1, 'it counts as a comeback like any');
});

test('the first station offered is one on a planet that is not falling in, then where comrades are, then the outermost', () => {
    // (At the quick pace the drive charges fast enough to get away from a planet that has only just started to fall in.)
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, INNERMOST], bo: [UMBRA, GATE] }, { pace: 'quick' });
    for (const planet of [INNERMOST, SECOND, FOURTH]) game.place(planet).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    assert.deepEqual(game.mode.respawnStations(game.who('ann')).map((place) => place.planet.id), [INNERMOST, FOURTH, SECOND]);

    game.skipTo(startsAt(game, 0) + 0.5);
    assert.equal(game.place(INNERMOST).status, PLANET_STATUS.COLLAPSING);
    assert.deepEqual(game.mode.respawnStations(game.who('ann')).map((place) => place.planet.id), [FOURTH, SECOND, INNERMOST],
        'Cy is there, but the planet is going');
});

test('nobody comes back where the planet will be swallowed before a new ship\'s drive could get it away', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, INNERMOST], bo: [UMBRA, GATE] });
    for (const planet of [INNERMOST, SECOND]) game.place(planet).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    const away = game.mode.jumpCooldown + BATTLE_ROYALE.jump.spool;
    game.skipTo(goneAt(game, 0) - away - 1);
    assert.deepEqual(game.mode.respawnStations(game.who('ann')).map((place) => place.planet.id), [INNERMOST, SECOND], 'just in time, still - and Cy is there');

    game.skipTo(goneAt(game, 0) - away + 1);
    assert.deepEqual(game.mode.respawnStations(game.who('ann')).map((place) => place.planet.id), [SECOND]);
    assert.deepEqual(game.state('ann').you.respawn.falling, [INNERMOST], 'shown, not to be chosen');
    game.who('ann').respawnAt = 0;
    game.ask('ann', BR_REQUEST.RESPAWN, { at: INNERMOST });
    assert.equal(game.who('ann').alive, false);
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.FALLING }]);

    game.place(SECOND).owner = null;
    game.run(RESPAWN.choose + 2);
    assert.equal(game.who('ann').alive, false, 'with nothing else held there is nowhere to go: no clock sends her there');
    assert.equal(game.state('ann').you.respawn.choose, null);
});

test('taking a station whose planet is about to be swallowed pays, but brings nobody back to it', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], di: [DAWN, THIRD], bo: [UMBRA, GATE] });
    game.empty(INNERMOST);
    destroyShip(game.world(THIRD), game.ship('di'), null);
    game.skipTo(startsAt(game, 0) + 0.5);
    game.take('ann');

    assert.equal(game.place(INNERMOST).owner, DAWN);
    assert.equal(game.who('ann').points, BATTLE_ROYALE.capture.points);
    assert.equal(game.who('di').alive, false, 'Di would have come out with an uncharged drive on a planet about to be swallowed');
    assert.deepEqual(game.told('di', BR_EVENT.REVIVED), []);
});

test('with no station held the wait ends and the pilot waits on, until their side takes one', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, FOURTH], bo: [UMBRA, GATE] });
    game.empty(FOURTH);
    game.empty(GATE);
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + RESPAWN.choose + 5);

    assert.deepEqual(game.state('ann').you.respawn, { wait: 0, stations: [], contested: [], falling: [], choose: null, next: RESPAWN.wait + RESPAWN.waitStep });
    assert.equal(game.who('ann').alive, false);

    game.take('cy');
    assert.equal(game.who('ann').alive, true, 'taking a station brings them straight back');
    assert.equal(game.pilot('ann').zone.id, FOURTH);
});

test('a station lost while a pilot was choosing it is refused, and the clock to choose stops with the last one', () => {
    // (Cy keeps the Federation in the match once its last station is gone.)
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, FOURTH] });
    game.empty(SECOND);
    game.place(FOURTH).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + 0.1);
    assert.ok(game.state('ann').you.respawn.choose > 0);

    game.empty(FOURTH);
    game.take('bo');
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    game.run(0.1);
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.NOT_HELD }]);
    assert.equal(game.state('ann').you.respawn.choose, null);
});

test('nobody comes back at a station another side is docked at, taking it; the first one offered is another', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, GATE], bo: [UMBRA, FOURTH] });
    game.empty(FOURTH);
    game.empty(GATE);
    for (const planet of [SECOND, FOURTH]) game.place(planet).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait - 1);
    assert.deepEqual(game.state('ann').you.respawn.stations, [FOURTH, SECOND], 'the outermost first, while nobody is taking it');

    game.dock('bo');
    game.run(1.1);
    const { respawn } = game.state('ann').you;
    assert.deepEqual([respawn.stations, respawn.contested], [[SECOND], [FOURTH]], 'shown, but not to be chosen');
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    assert.equal(game.who('ann').alive, false, 'the host checks it, whatever a device sends');
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.CONTESTED }]);

    game.run(RESPAWN.choose);
    assert.equal(game.who('ann').alive, true, 'the clock ran out: sent to a station nobody is taking');
    assert.equal(game.pilot('ann').zone.id, SECOND);
});

test('with every station of the side being taken there is nowhere to come back to until that is settled', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, FOURTH], cy: [DAWN, SECOND] });
    game.empty(FOURTH);
    game.empty(SECOND);
    game.place(FOURTH).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.dock('bo');
    game.run(RESPAWN.wait + 1);

    assert.deepEqual(game.state('ann').you.respawn, { wait: 0, stations: [], contested: [FOURTH], falling: [], choose: null, next: RESPAWN.wait + RESPAWN.waitStep });
    assert.equal(game.place(FOURTH).owner, DAWN, 'a station being taken is still held');

    game.ask('bo', BR_REQUEST.UNDOCK);
    game.run(0.2);
    const { respawn } = game.state('ann').you;
    assert.deepEqual([respawn.stations, respawn.contested], [[FOURTH], []], 'free again once the attacker lets go');
    assert.ok(respawn.choose > 0, 'and the clock to choose starts');
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    assert.equal(game.who('ann').alive, true);
});

test('the dead have no ship to jump, dock, refit or call for help with', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, GATE], cy: [DAWN, SECOND] });
    game.empty(SECOND);
    game.place(THIRD).owner = DAWN;
    game.who('ann').points = 3;
    game.who('ann').summons = 1;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: FOURTH });
    game.ask('ann', BR_REQUEST.DOCK);
    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 1 } });
    game.ask('ann', BR_REQUEST.SUMMON);
    game.run(0.2);

    assert.deepEqual([game.who('ann').points, game.who('ann').summons], [3, 1], 'what they had is kept for the next ship');
    assert.equal(game.who('ann').jump, null);
    assert.equal(game.who('ann').dock, null);
});

test('a comeback keeps the pilot\'s refits, score and equipment', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, GATE], cy: [DAWN, SECOND] });
    game.empty(SECOND);
    game.empty(GATE);
    game.place(THIRD).owner = DAWN;
    game.who('ann').points = 2;
    game.ask('ann', BR_REQUEST.REFIT, { added: { hull: 2 } });
    game.equip('ann', EQUIPMENT.BEACON, 2);
    game.who('ann').score = 900;
    const maxHull = game.ship('ann').maxHull;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + 0.1);
    game.ask('ann', BR_REQUEST.RESPAWN, { at: THIRD });

    assert.equal(game.ship('ann').maxHull, maxHull);
    assert.equal(game.who('ann').inventory.counts[EQUIPMENT.BEACON], 2);
    assert.equal(game.who('ann').score, 900);
    assert.equal(game.who('ann').deaths, 1);
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

test('sides are hostile to each other; the pirates are a side, comrades to each other', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], bo: [UMBRA, THIRD], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    const ship = (name) => game.ship(name);

    assert.equal(areHostile(ship('ann'), ship('cy')), false, 'same side');
    assert.equal(areHostile(ship('ann'), ship('bo')), true);
    assert.equal(areHostile(ship('ann'), ship('pip')), true);
    assert.equal(areHostile(ship('bo'), ship('pip')), true);
    assert.equal(areHostile(ship('pip'), ship('pat')), false, 'pirates are no enemies of pirates');
    const world = game.world(THIRD);
    assert.equal(mayAttack(world, ship('pip'), ship('pat')), true, 'though one may fire on another on purpose');
    assert.equal(mayAttack(world, ship('pip'), ship('pip')), false);
    assert.equal(mayAttack(world, ship('ann'), ship('cy')), false, 'which no other side\'s pilots may');
    const dart = game.world(THIRD).spawnShip('dart', { position: [0, 0, 0] });
    assert.equal(areHostile(dart, ship('ann')), false);
    assert.equal(areHostile(dart, ship('pip')), true);
});

test('pilots of one side cannot lock or shoot each other; pirates can, by aiming straight at their comrade', () => {
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

test('a pirate is never fired on by a comrade\'s guns by accident', () => {
    const game = arrange({ pip: [PIRATE, THIRD], pat: [PIRATE, THIRD], bo: [UMBRA, THIRD] });
    game.empty(THIRD);
    const world = game.world(THIRD);
    const [pip, pat, bo] = [game.ship('pip'), game.ship('pat'), game.ship('bo')];
    pip.position.set(0, 0, 0);
    pip.quaternion.identity();
    // Pat a little off the nose - inside the beams' arc, not under the crosshair - and Bo far off to the side.
    pat.position.set(40, 0, -300);
    bo.position.set(6000, 0, 0);

    world.targetNearestToCrosshair(null, pip);
    assert.notEqual(pip.target, pat, 'not locked without aiming straight at them');
    world.cycleTarget(1, pip);
    assert.notEqual(pip.target, pat, 'and cycling targets passes a comrade by');

    pip.target = null;
    const before = pat.shield + pat.hull;
    game.pilot('pip').lastInputAt = Infinity;
    game.pilot('pip').controls.firePrimary = true;
    game.run(1);
    assert.equal(pat.shield + pat.hull, before, 'beams fired past a comrade do not swing onto them');

    const dart = world.spawnShip('dart', { faction: DAWN, position: [0, 0, 9000] });
    assert.equal(areHostile(dart, pat), true, 'to the fleets a pirate is a pirate');
});

test('a torpedo locked on a fellow pirate hits them; a kill among pirates scores like any other', () => {
    const game = arrange({ pip: [PIRATE, THIRD], pat: [PIRATE, THIRD], bo: [UMBRA, GATE] });
    game.empty(THIRD);
    const world = game.world(THIRD);
    const [pip, pat] = [game.ship('pip'), game.ship('pat')];
    pip.position.set(0, 0, 0);
    pip.quaternion.identity();
    pat.position.set(0, 0, -400);
    world.targetNearestToCrosshair(null, pip);
    assert.equal(pip.target, pat);

    const before = pat.shield + pat.hull;
    game.pilot('pip').lastInputAt = Infinity;
    game.pilot('pip').controls.fireSecondary = true;
    game.run(0.2);
    game.pilot('pip').controls.fireSecondary = false;
    game.run(4);
    assert.ok(pat.shield + pat.hull < before, 'the torpedo found its mark');

    destroyShip(world, pat, pip);
    assert.equal(game.who('pip').score, BATTLE_ROYALE.score.playerKill);
    assert.equal(game.who('pip').loyalty.status, LOYALTY.TRUSTED, 'and nobody calls it treason');
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

test('a side whose pilots are all down at once is out: nobody of it comes back, and its stations are nobody\'s', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, FOURTH], bo: [UMBRA, GATE], pip: [PIRATE, SECOND] });
    for (const planet of [SECOND, FOURTH, GATE]) game.empty(planet);
    for (const planet of [FOURTH, INNERMOST]) game.place(planet).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(RESPAWN.wait + 1);
    assert.equal(game.state('ann').you.out, false, 'Cy is still flying');
    assert.equal(game.state('ann').you.respawn.wait, 0, 'and Ann could come back now');

    destroyShip(game.world(FOURTH), game.ship('cy'), null);
    game.run(0.1);

    assert.equal(game.state('ann').you.out, true);
    assert.equal(game.state('ann').you.respawn, null);
    assert.deepEqual(game.state('bo').out, [DAWN], 'everybody is told');
    assert.deepEqual([game.place(FOURTH).owner, game.place(INNERMOST).owner], [null, null], 'its stations are nobody\'s again');
    assert.deepEqual(game.told('bo', BR_EVENT.SIDE_OUT), [{ faction: DAWN }]);
    game.ask('ann', BR_REQUEST.RESPAWN, { at: FOURTH });
    assert.deepEqual(game.told('ann', BR_EVENT.RESPAWN_REFUSED), [{ reason: RESPAWN_REFUSAL.OUT }]);
    game.run(RESPAWN.wait * 4 + RESPAWN.choose);
    assert.deepEqual([game.who('ann').alive, game.who('cy').alive], [false, false], 'nobody of it comes back, ever');
    assert.equal(game.state('bo').phase, MATCH_PHASE.PLAYING, 'the Umbra and the pirates fight on');

    // Nor does taking a station bring anybody of theirs back: there is nobody of theirs to take it.
    game.take('pip');
    assert.equal(game.who('ann').alive, false);
});

test('the last side with a pilot flying wins at once, whatever stations the others hold', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.place(SECOND).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), game.ship('bo'));
    game.run(0.2);

    assert.equal(game.state('ann').winner, UMBRA, 'the Federation held a station, but nobody of it was flying');
});

test('holding the stargate when the last stand runs out wins the match for the whole side - taking it does not end it early', () => {
    const game = arrange({ ann: [DAWN, GATE], cy: [DAWN, NEXT_TO_GATE], bo: [UMBRA, NEXT_TO_GATE] });
    game.place(NEXT_TO_GATE).owner = UMBRA;
    game.clear(NEXT_TO_GATE, DAWN);
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    assert.ok(game.state('ann').finalStand > 0);
    game.empty(GATE);
    game.take('ann');
    assert.equal(game.place(GATE).owner, DAWN);
    assert.equal(game.state('bo').phase, MATCH_PHASE.PLAYING, 'the countdown still has to run out');
    assert.equal(game.who('ann').points, BATTLE_ROYALE.capture.points, 'it pays like any other station');

    game.server.time = game.mode.clock.finalStandEndsAt - 0.05;
    game.run(0.3);
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

test('the stargate can change hands during the last stand; whoever holds it at the end goes through', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, GATE] });
    game.empty(GATE);
    game.place(GATE).owner = UMBRA;
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    game.take('ann');
    assert.equal(game.place(GATE).owner, DAWN);
    game.take('bo');
    assert.equal(game.place(GATE).owner, UMBRA);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING, 'nobody has won by taking it');

    game.server.time = game.mode.clock.finalStandEndsAt - 0.05;
    game.run(0.3);
    assert.equal(game.state('ann').winner, UMBRA);
});

test('the last stand ends early only when every enemy is dead', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, GATE], pip: [PIRATE, GATE] });
    game.empty(GATE);
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    game.take('ann');
    destroyShip(game.world(GATE), game.ship('bo'), game.ship('ann'));
    game.run(0.2);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING, 'the pirate is still flying');

    destroyShip(game.world(GATE), game.ship('pip'), game.ship('ann'));
    game.run(0.2);
    assert.equal(game.state('ann').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('ann').winner, DAWN);
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

test('the map names comrades only to their own side - the pirates being a side too', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, SECOND], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    const comradesAt = (viewer, planet) => game.state(viewer).planets.find((entry) => entry.id === planet).comrades;

    assert.deepEqual(comradesAt('ann', SECOND), ['cy']);
    assert.deepEqual(comradesAt('ann', THIRD), [], 'not herself, and not the pirates beside her');
    assert.deepEqual(comradesAt('bo', SECOND), [], 'the Umbra pilot is not told where the Federation\'s are');
    assert.deepEqual(comradesAt('pip', THIRD), ['pat'], 'pirates are told where pirates are');
    assert.deepEqual(comradesAt('pat', THIRD), ['pip']);
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
    const held = seen('ann', GATE);
    assert.deepEqual([held.known, held.owner], [true, DAWN], 'a station her side holds reports in');
    assert.equal(held.forces[DAWN] + held.forces[UMBRA], game.npcs(GATE, DAWN).length + game.npcs(GATE, UMBRA).length);

    const dark = seen('ann', FOURTH);
    assert.deepEqual([dark.known, dark.owner, dark.forces, dark.docking], [false, null, null, null], 'of the Umbra\'s station she knows nothing');
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

test('the pirates share what their beacons see like any side, and a traitor trades their old side\'s eyes for the pirates\'', () => {
    const game = arrange({ pip: [PIRATE, THIRD], pat: [PIRATE, GATE], ann: [DAWN, THIRD], cy: [DAWN, THIRD] });
    game.empty(THIRD);
    game.equip('pip', EQUIPMENT.BEACON);
    game.equip('cy', EQUIPMENT.BEACON);
    const seen = (viewer, planet) => game.state(viewer).planets.find((entry) => entry.id === planet).known;
    game.ask('pip', BR_REQUEST.BEACON, { to: FOURTH });
    assert.deepEqual([seen('pip', FOURTH), seen('pat', FOURTH), seen('ann', FOURTH)], [true, true, false]);
    assert.equal(seen('pat', THIRD), true, 'and where one pirate is, the others see');

    game.ask('cy', BR_REQUEST.BEACON, { to: SECOND });
    assert.deepEqual([seen('ann', SECOND), seen('pip', SECOND)], [true, false]);
    game.mode.brandPirate(game.who('ann'), game.place(THIRD).zone);
    assert.deepEqual([seen('ann', SECOND), seen('ann', FOURTH)], [false, true]);
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

test('holding the station is no reason for the gravity shield to stay off: it comes on all the same', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bex: [UMBRA, GATE] });
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.place(INNERMOST).owner = DAWN;
    game.skipTo(startsAt(game, 0) + 0.1);

    assert.equal(game.who('ann').inventory.counts.gravityShield, 0);
    assert.deepEqual(game.told('ann', BR_EVENT.EQUIPMENT_USED), [{ item: EQUIPMENT.GRAVITY_SHIELD }]);
});

test('a gravity shield buys time at a swallowed planet, never a way out: its station cannot be taken and the drive stays locked', () => {
    const game = arrange({ ann: [DAWN, INNERMOST], bex: [UMBRA, GATE] });
    game.empty(INNERMOST);
    game.equip('ann', EQUIPMENT.GRAVITY_SHIELD);
    game.place(INNERMOST).owner = UMBRA;
    game.skipTo(goneAt(game, 0));
    game.dock('ann');

    assert.equal(game.who('ann').dock, null);
    assert.equal(game.place(INNERMOST).owner, null);
    assert.equal(game.state('ann').you.jump.trapped, true);
    game.run(GEAR.gravityShieldSeconds + BATTLE_ROYALE.collapse.swallowedSeconds + 1);
    assert.equal(game.who('ann').alive, false);
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

// ---- Computer-flown players ------------------------------------------------------------------

const BOTS = BATTLE_ROYALE.bots;

/**
 * A match made up with bots: `game.bots` are their seats in the rules. `game.alone(bot, planet)`
 * puts one at a planet with nothing else there but the station, everybody else out of the way.
 */
function withBots(names = ['ann'], settings = {}) {
    const game = createTestServer(names, { start: { settings: { bots: 'fill', ...settings } } });
    const { mode, server } = game;
    game.bots = [...mode.contestants.values()].filter((contestant) => contestant.pilot.bot);
    game.people = [...mode.contestants.values()].filter((contestant) => !contestant.pilot.bot);
    const moveTo = (contestant, planet) => {
        if (contestant.pilot.ship?.alive) contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        return mode.launch(contestant, mode.places.get(planet), { warpIn: false });
    };
    game.alone = (bot, planet, parking = GATE) => {
        for (const other of mode.contestants.values()) {
            if (other !== bot) moveTo(other, parking);
        }
        const ship = moveTo(bot, planet);
        const { world } = mode.places.get(planet).zone;
        for (const other of [...world.ships]) {
            if (other !== ship && other.faction !== FACTION.NEUTRAL) world.removeShip(other);
        }
        // The people's ships are parked: nobody is at their controls in these tests.
        for (const person of game.people) server.pilots.get(person.pilot.id).lastInputAt = -Infinity;
        return ship;
    };
    game.place = (planet) => mode.places.get(planet);
    game.skipTo = (time) => { server.time = time; game.run(0.1); };
    return game;
}

test('a match short of players is made up with computer-flown ones, dealt into the sides like everybody else', () => {
    for (let seed = 1; seed <= 6; seed++) {
        const { server, mode } = createTestServer(['ann', 'bo'], { start: { seed, settings: { bots: 'fill' } } });
        const pilots = [...server.pilots.values()];
        assert.equal(pilots.length, BOTS.fillTo);
        assert.equal(BOTS.fillTo, 10, 'every seat of a full match');
        assert.deepEqual(pilots.map((pilot) => pilot.bot), [false, false, ...Array(8).fill(true)]);

        const sides = [...mode.contestants.values()].map((contestant) => contestant.faction);
        assert.deepEqual([DAWN, UMBRA, PIRATE].map((faction) => sides.filter((side) => side === faction).length), [4, 4, 2], 'four, four and two, bots included');
        const names = pilots.filter((pilot) => pilot.bot).map((pilot) => pilot.name);
        assert.equal(new Set(names).size, names.length, 'each under its own name');
        assert.ok(names.every((name) => name.startsWith(BOTS.namePrefix)), 'which says what it is');

        const listed = mode.describeState(server.pilots.get('ann')).players;
        assert.deepEqual(listed.map((player) => player.bot), pilots.map((pilot) => pilot.bot), 'and every player is told who is a bot');
    }
});

test('no bots where the room wants none, or where every seat is taken', () => {
    assert.equal(createTestServer(['ann'], { start: { settings: { bots: 'none' } } }).server.pilots.size, 1);
    const names = Array.from({ length: BOTS.fillTo }, (_, index) => `p${index}`);
    assert.equal(createTestServer(names, { start: { settings: { bots: 'fill' } } }).server.pilots.size, BOTS.fillTo);
    assert.equal(createTestServer([...names, 'one-more'], { start: { settings: { bots: 'fill' } } }).server.pilots.size, BOTS.fillTo + 1, 'never fewer players than there are people');
    assert.equal(createTestServer(['ann'], { start: { settings: {} } }).server.pilots.size, 1, '(these tests\' own default is none)');
});

test('a bot flies one of the players\' ships, exactly as a player\'s is', () => {
    const game = withBots(['ann']);
    const offered = PLAYER_SHIPS.map((ship) => ship.classId);
    for (const bot of game.bots) {
        const ship = bot.pilot.ship;
        const cls = SHIP_CLASSES[bot.pilot.classId];
        assert.ok(offered.includes(bot.pilot.classId), bot.pilot.classId);
        assert.equal(ship.isPlayer, true);
        assert.equal(ship.pilotId, bot.pilot.id);
        assert.equal(ship.callsign, bot.pilot.name);
        assert.deepEqual([ship.maxHull, ship.maxShield, ship.cls.maxSpeed], [cls.hull, cls.shield, cls.maxSpeed], 'the class\'s own numbers, nothing added');
        assert.deepEqual(ship.weapons.map((weapon) => weapon.id), cls.weapons);
        assert.equal(bot.inventory.picks + Object.values(bot.inventory.counts).reduce((sum, count) => sum + count, 0), BATTLE_ROYALE.equipment.startingPicks,
            'one piece of equipment, like everybody');
    }
    const classes = new Set();
    for (let seed = 1; seed <= 12; seed++) {
        for (const pilot of createTestServer(['ann'], { start: { seed, settings: { bots: 'fill' } } }).server.pilots.values()) {
            if (pilot.bot) classes.add(pilot.classId);
        }
    }
    assert.ok(classes.size >= 3, `bots fly different ships: ${[...classes]}`);
});

test('a bot\'s ship is flown through a pilot\'s controls: it is never left drifting like a player who stopped sending', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    const ship = game.alone(bot, THIRD);
    game.place(THIRD).owner = bot.faction;
    const enemy = game.place(THIRD).zone.world.spawnShip('drone', { faction: bot.faction === UMBRA ? DAWN : UMBRA, position: ship.position.clone().add({ x: 0, y: 0, z: -1500 }), aiMode: 'hold' });
    game.run(1);
    assert.equal(ship.target, enemy, 'locked like a player locks');
    assert.ok(ship.controls === bot.pilot.controls, 'the helm is the bot\'s own controls, not the idle ones');

    game.run(3);
    assert.ok(ship.speed > 20, `under way at ${ship.speed.toFixed(0)} m/s`);
});

test('a bot fights what is hostile to it and scores like any pilot', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    const ship = game.alone(bot, THIRD);
    game.place(THIRD).owner = bot.faction;
    const world = game.place(THIRD).zone.world;
    const enemyFaction = bot.faction === UMBRA ? DAWN : UMBRA;
    const drone = world.spawnShip('drone', { faction: enemyFaction, position: ship.position.clone().add({ x: 200, y: 0, z: -1200 }) });
    let fired = false;
    for (let second = 0; second < 60 && drone.alive; second++) {
        game.run(1);
        fired ||= ship.beamFiring;
    }

    assert.equal(drone.alive, false, 'shot down');
    assert.equal(fired, true, 'with the ship\'s own beams');
    assert.equal(bot.kills, 1);
    assert.equal(bot.score, BATTLE_ROYALE.score.ships.drone);
});

/** A bot put alone at a planet its side holds, in the ship named, with one hostile ship in front of it. */
function botIn(classId, enemyClass, offset, enemyOptions = {}) {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    bot.pilot.classId = classId;
    const ship = game.alone(bot, THIRD);
    game.place(THIRD).owner = bot.faction;
    const world = game.place(THIRD).zone.world;
    const abilities = [];
    world.events.on('ability', (event) => abilities.push(event));
    const enemy = world.spawnShip(enemyClass, { faction: bot.faction === UMBRA ? DAWN : UMBRA, position: ship.position.clone().add(offset), ...enemyOptions });
    return { game, bot, ship, world, enemy, abilities };
}

test('a bot uses its ship\'s ability as a pilot would: the Kestrel\'s breach torpedo at a shielded target', () => {
    const { game, ship, enemy, abilities } = botIn('kestrel', 'harrier', { x: 0, y: 0, z: -1500 }, { aiMode: 'hold' });
    assert.equal(ship.ability.def.id, 'breachTorpedo');
    for (let second = 0; second < 30 && enemy.shieldDown <= 0; second++) game.run(1);
    assert.deepEqual(abilities.slice(0, 1).map((event) => [event.ship, event.phase]), [[ship, 'start']]);
    assert.ok(enemy.shieldDown > 0, 'the frigate\'s shield was breached');
    assert.equal(abilities.filter((event) => event.phase === 'start').length, 1, 'once: then it has to recharge like anybody\'s');
});

test('a bot uses its ship\'s ability as a pilot would: the Shrike\'s lance with a target ahead', () => {
    const { game, ship, enemy, abilities } = botIn('shrike', 'harrier', { x: 0, y: 0, z: -2500 }, { aiMode: 'hold' });
    const before = enemy.hull + enemy.shield;
    let lanced = false;
    for (let second = 0; second < 20 && !lanced; second++) {
        game.run(1);
        lanced = Boolean(ship.effect('lance')) && ship.beamFiring;
    }
    assert.equal(abilities[0]?.ability, 'focusLance');
    assert.ok(lanced, 'fired with the beam trigger while it lasts');
    assert.ok(enemy.hull + enemy.shield < before);
});

test('a bot uses its ship\'s ability as a pilot would: the dash and the cloak to get away, never while docked', () => {
    for (const [classId, abilityId] of [['swift', 'overdrive'], ['peregrine', 'cloak']]) {
        const { game, bot, ship, abilities } = botIn(classId, 'raider', { x: 0, y: 0, z: -600 });
        game.run(1);
        assert.equal(abilities.length, 0, `${classId}: not with its shield whole`);
        ship.shield = ship.maxShield * 0.1;
        ship.shieldCooldown = 30;
        for (let tick = 0; tick < 40 && abilities.length === 0; tick++) game.run(0.1);
        assert.equal(abilities[0]?.ability, abilityId, classId);
        assert.equal(abilities[0].ship, ship);

        // Clamped to a station, the ship is not the bot's to throw about.
        ship.ability.cooldown = 0;
        ship.ability.active = 0;
        ship.cloaked = false;
        bot.pilot.helmHeld = true;
        const count = abilities.filter((event) => event.phase === 'start').length;
        game.run(2);
        assert.equal(abilities.filter((event) => event.phase === 'start').length, count, `${classId}: docked`);
    }
});

test('a bot\'s Bulwark goes up like anybody\'s: its kills are scored, and catching its own side brands nobody', () => {
    const { game, bot, ship, world, enemy } = botIn('bulwark', 'raider', { x: 0, y: 0, z: -600 }, { aiMode: 'hold' });
    assert.equal(ship.passive?.id, 'reactorBlast');
    const friend = world.spawnShip(bot.faction === DAWN ? 'dart' : 'raider', { faction: bot.faction, position: ship.position.clone().add({ x: 0, y: 0, z: 500 }), aiMode: 'hold' });
    const { kills, score } = bot;
    applyDamage(world, ship, 1e6, { source: enemy });
    game.run(0.1);

    assert.equal(ship.alive, false);
    assert.equal(enemy.alive, false, 'the raider beside it went with it');
    assert.equal(bot.kills, kills + 1);
    assert.equal(bot.score, score + BATTLE_ROYALE.score.ships.raider);
    assert.equal(friend.alive, false, 'and so did its own wingman');
    assert.equal(bot.loyalty.status, LOYALTY.TRUSTED);
    assert.notEqual(bot.faction, PIRATE);
});

test('a bot never fires on its own side, and is never branded for it', () => {
    const game = withBots(['ann']);
    const bot = game.bots.find((contestant) => contestant.faction !== PIRATE);
    const ship = game.alone(bot, THIRD);
    game.place(THIRD).owner = bot.faction;
    const world = game.place(THIRD).zone.world;
    const friend = world.spawnShip(bot.faction === DAWN ? 'dart' : 'raider', { faction: bot.faction, position: ship.position.clone().add({ x: 0, y: 0, z: -400 }), aiMode: 'hold' });
    const before = friend.hull + friend.shield;
    game.run(20);

    assert.equal(friend.hull + friend.shield, before);
    assert.equal(bot.loyalty.status, LOYALTY.TRUSTED);
    assert.equal(bot.faction, ship.faction);
});

test('a bot flies to an unguarded station, docks, and takes the planet for its side', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    game.alone(bot, THIRD);
    let docked = false;
    for (let second = 0; second < 150 && game.place(THIRD).owner === null; second++) {
        game.run(1);
        docked ||= Boolean(bot.dock);
    }

    assert.equal(docked, true, 'it clamped on, as a player has to');
    assert.equal(game.place(THIRD).owner, bot.faction);
    assert.ok(bot.score >= BATTLE_ROYALE.capture.score);
    assert.equal(bot.pilot.ship.alive, true, 'without flying into the station on the way');
});

test('a bot spends what it is given: equipment and refit points', () => {
    const game = withBots(['ann', 'bo']);
    const bot = game.bots[0];
    game.alone(bot, THIRD, THIRD);
    bot.points = 2;
    game.run(0.5);
    assert.equal(bot.inventory.picks, 0, 'its piece of equipment is chosen');
    assert.equal(bot.points, 0);
    assert.equal(Object.values(bot.pilot.upgrades).reduce((sum, levels) => sum + levels, 0), 2, 'its points are in its ship');
});

test('a bot shot down comes back the moment its wait is over, at the station it would be sent to anyway', () => {
    const game = withBots(['ann']);
    const bot = game.bots[0];
    game.alone(bot, THIRD);
    game.place(FOURTH).owner = bot.faction;
    game.place(SECOND).owner = bot.faction;
    destroyShip(game.place(THIRD).zone.world, bot.pilot.ship, null);
    game.run(BATTLE_ROYALE.respawn.wait - 0.5);
    assert.equal(bot.alive, false);
    assert.equal(bot.pilot.zone, null, 'nothing is kept running for a bot that is down');

    game.run(1);
    assert.equal(bot.alive, true);
    assert.equal(bot.pilot.zone.id, game.mode.respawnStations(bot)[0].planet.id);
    assert.equal(bot.respawns, 1);
});

test('a bot jumps outwards before its planet falls in', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    game.alone(bot, INNERMOST);
    bot.jumpReadyAt = 0;
    game.skipTo(game.mode.clock.schedule[0].startsAt - BOTS.fleeAhead + 2);
    game.run(BATTLE_ROYALE.jump.spool + 2);

    assert.equal(bot.pilot.zone.id, SECOND);
    assert.equal(bot.alive, true);
});

test('a bot at a station its side holds jumps outwards before the planet falls in all the same: holding it is no shelter', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    game.alone(bot, INNERMOST);
    game.place(INNERMOST).owner = bot.faction;
    bot.jumpReadyAt = 0;
    game.skipTo(game.mode.clock.schedule[0].startsAt - BOTS.fleeAhead + 2);
    game.run(BATTLE_ROYALE.jump.spool + 2);

    assert.equal(bot.pilot.zone.id, SECOND);
    assert.equal(bot.alive, true);
});

test('a bot caught at a swallowed planet does not go for its station: there is none left to dock at', () => {
    const game = withBots(['ann']);
    const [contestant] = game.bots;
    const bot = game.mode.bots.find((brain) => brain.contestant === contestant);
    game.alone(contestant, INNERMOST);
    game.skipTo(game.mode.clock.schedule[0].goneAt + 0.1);
    game.run(BOTS.thinkInterval * 2 + 0.1);

    assert.notEqual(bot.goal.kind, 'dock');
    assert.equal(contestant.dock, null);
});

test('a bot on its own takes the stations the collapse is coming for one after another - it does not sit on the first, nor race ahead', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    game.alone(bot, INNERMOST, INNERMOST);
    for (const other of game.mode.contestants.values()) {
        if (other !== bot && other.pilot.ship?.alive) other.pilot.zone.world.removeShip(other.pilot.ship);
    }
    for (const planet of PLANETS) {
        const { world } = game.place(planet).zone;
        for (const ship of [...world.ships]) if (ship.faction !== FACTION.NEUTRAL && !ship.isPlayer) world.removeShip(ship);
    }
    const visited = new Set();
    for (let leg = 0; leg < 4; leg++) {
        bot.jumpReadyAt = 0;
        for (let second = 0; second < 40; second++) {
            game.run(1);
            visited.add(bot.pilot.zone.id);
        }
    }

    const { maxAhead } = BATTLE_ROYALE.strategy;
    const within = PLANETS.slice(0, maxAhead + 1);
    assert.deepEqual(within.map((planet) => game.place(planet).owner), within.map(() => bot.faction), 'it took each in turn');
    assert.deepEqual([...visited].sort(), [...within].sort(), 'and went no further out than the collapse\'s front and two orbits');
});

test('a place is kept running for a living bot, and no longer for one that has been shot down', () => {
    const game = withBots(['ann']);
    const [bot] = game.bots;
    game.alone(bot, THIRD);
    const { zone } = game.place(THIRD);
    assert.equal(zone.active, true, 'nobody but the bot is here, and the place is alive');

    destroyShip(zone.world, bot.pilot.ship, null);
    assert.equal(zone.active, false);
    assert.equal(bot.alive, false);
    game.run(1);
    assert.equal(game.mode.describeState(game.server.pilots.get('ann')).players.find((player) => player.id === bot.pilot.id).alive, false);
});

test('bots count for their side: it is not beaten while one of them flies, and they win with it', () => {
    const game = withBots(['ann']);
    const ann = game.people[0];
    const comrade = game.bots.find((bot) => bot.faction === ann.faction);
    game.alone(comrade, THIRD);
    destroyShip(ann.pilot.zone.world, ann.pilot.ship, null);
    game.run(0.3);
    assert.equal(game.mode.result, null, 'Ann is down, but her side is not out');

    for (const other of game.bots) {
        if (other !== comrade && other.pilot.ship?.alive) destroyShip(other.pilot.zone.world, other.pilot.ship, comrade.pilot.ship);
    }
    game.run(0.3);
    assert.deepEqual(game.mode.result, { winner: ann.faction });
    assert.ok(comrade.score >= 4 * BATTLE_ROYALE.score.playerKill, 'and a bot shot down is a player\'s kill');
});

test('a bot cannot be given a link, and a second pilot cannot take its name', () => {
    const { server } = createTestServer(['ann'], { start: { settings: { bots: 'fill' } } });
    assert.equal(server.attachLink('bot:1', { isOpen: true }), false);
    assert.throws(() => server.addBot({ id: 'bot:1', name: 'x', classId: 'kestrel' }));
    assert.throws(() => server.addBot({ id: 'ann', name: 'x', classId: 'kestrel' }));
});

// ---- Where the computer-flown units go (strategy.js) -----------------------------------------

/**
 * A side holds the veil and the stargate's station with all four of its bots at the gate, and
 * Ann - of another side - docks at the veil. Only that side's bots think (with `brains: false`
 * none do); everybody else's ship sits idle, out of the way at the innermost planet.
 */
function stationUnderAttack({ brains = true } = {}) {
    const game = withBots(['ann']);
    const { mode, server } = game;
    const [ann] = game.people;
    const side = [DAWN, UMBRA].find((faction) => faction !== ann.faction);
    const crew = [...mode.contestants.values()].filter((contestant) => contestant.faction === side);
    mode.bots = brains ? mode.bots.filter((bot) => bot.contestant.faction === side) : [];
    const moveTo = (contestant, planet) => {
        if (contestant.pilot.ship?.alive) contestant.pilot.zone.world.removeShip(contestant.pilot.ship);
        return mode.launch(contestant, game.place(planet), { warpIn: false });
    };
    for (const other of mode.contestants.values()) if (other.faction !== side && other !== ann) moveTo(other, INNERMOST);
    for (const contestant of crew) moveTo(contestant, GATE);
    for (const planet of [FOURTH, GATE]) {
        const place = game.place(planet);
        place.owner = side;
        for (const ship of [...place.zone.world.ships]) if (!ship.isPlayer && ship.faction !== FACTION.NEUTRAL) place.zone.world.removeShip(ship);
    }
    const ship = moveTo(ann, FOURTH);
    server.pilots.get('ann').lastInputAt = -Infinity;
    ship.position.copy(game.place(FOURTH).station.mouth);
    ship.velocity.set(0, 0, 0);
    mode.requestDock(ann);
    assert.ok(ann.dock, 'Ann is taking the veil');
    const at = (planet) => crew.filter((contestant) => contestant.alive && contestant.pilot.zone?.id === planet);
    return { game, mode, server, ann, side, crew, at };
}

test('bots that hold the stargate go back when a station of theirs further in is being taken - and the stargate keeps one on watch', () => {
    const { game, mode, server, side, crew, at } = stationUnderAttack();
    for (const contestant of crew) contestant.jumpReadyAt = server.time;
    game.run(BATTLE_ROYALE.strategy.planInterval + 0.5);

    const called = crew.filter((contestant) => mode.councilOf(side).orderFor(contestant.pilot.id)?.planet === FOURTH);
    assert.ok(called.length >= 2, `${called.length} of the four are called back`);
    assert.ok(called.every((contestant) => contestant.jump || contestant.pilot.zone.id !== GATE), 'and they are on their way at once');

    let watched = true;
    let arrived = false;
    for (let second = 0; second < 150; second++) {
        game.run(1);
        watched &&= at(GATE).length > 0;
        arrived ||= at(FOURTH).length > 0;
    }
    assert.equal(arrived, true, 'they got there');
    assert.equal(watched, true, 'never was the stargate\'s station left bare');
    assert.equal(game.place(FOURTH).owner, side, 'and the veil is theirs (again)');
});

test('reinforcements go where their side needs them, by a pilot\'s rules: one orbit a jump, and as battered as they were', () => {
    const { game, mode, server, ann, crew } = stationUnderAttack({ brains: false });
    // A long docking: the alarm goes on for as long as the test wants it to.
    ann.dock.left = 1e6;
    const [caller] = crew;
    caller.summons = 1;
    mode.summon(caller);
    const [squad] = mode.squads;
    assert.equal(squad.ships.length, BATTLE_ROYALE.summon.count);
    assert.ok(squad.ships.every((ship) => ship.hasTag(squad.key)));
    game.run(5);
    squad.ships[0].hull = squad.ships[0].maxHull / 2;
    // They have done what they were called for, and their drives are charged.
    squad.committedUntil = 0;
    squad.readyAt = server.time;
    const gate = game.place(GATE).zone.world;
    game.run(BATTLE_ROYALE.strategy.planInterval + BATTLE_ROYALE.jump.spool + 0.5);

    assert.equal(squad.place.planet.id, NEXT_TO_GATE, 'one orbit in, on the way to the veil');
    assert.equal(gate.ships.filter((ship) => ship.alive && ship.hasTag(squad.key)).length, 0, 'gone from the stargate in a flash');
    const { world } = game.place(NEXT_TO_GATE).zone;
    assert.equal(squad.ships.length, BATTLE_ROYALE.summon.count);
    assert.ok(squad.ships.every((ship) => ship.alive && world.ships.includes(ship) && ship.hasTag(squad.key) && ship.faction === caller.faction));
    assert.ok(squad.ships.some((ship) => Math.abs(ship.hullFraction - 0.5) < 0.02), 'the damaged one is still damaged');
    assert.ok(squad.readyAt > server.time, 'and the drives must charge again');

    game.run(BATTLE_ROYALE.jump.cooldown + BATTLE_ROYALE.strategy.planInterval + BATTLE_ROYALE.jump.spool + 0.5);
    assert.equal(squad.place.planet.id, FOURTH, 'then on to the veil');
});

test('reinforcements get out of a planet that is about to fall in, whatever their orders', () => {
    const game = withBots(['ann']);
    const { mode } = game;
    mode.bots = [];
    const caller = game.bots.find((bot) => bot.faction !== PIRATE);
    game.alone(caller, INNERMOST);
    caller.summons = 1;
    mode.summon(caller);
    const [squad] = mode.squads;
    squad.readyAt = 0;
    game.skipTo(mode.clock.schedule[0].startsAt - BOTS.fleeAhead + 1);
    game.run(BATTLE_ROYALE.jump.spool + 1);
    assert.equal(squad.place.planet.id, SECOND, 'even straight after being called (they stay with the fight, not with a planet falling in)');
});

test('reinforcements at a station their side holds get out before the collapse too', () => {
    const game = withBots(['ann']);
    const { mode } = game;
    mode.bots = [];
    const caller = game.bots.find((bot) => bot.faction !== PIRATE);
    game.alone(caller, INNERMOST);
    game.place(INNERMOST).owner = caller.faction;
    caller.summons = 1;
    mode.summon(caller);
    const [squad] = mode.squads;
    squad.readyAt = 0;
    game.skipTo(mode.clock.schedule[0].startsAt - BOTS.fleeAhead + 1);
    game.run(BATTLE_ROYALE.jump.spool + 1);
    assert.equal(squad.place.planet.id, SECOND);
});

test('a bot at its side\'s station goes first for a ship docked there, taking it - and with nothing about, keeps watch on the way in', () => {
    const game = withBots(['ann']);
    const { mode } = game;
    const [ann] = game.people;
    const contestant = game.bots.find((bot) => bot.faction !== ann.faction && bot.faction !== PIRATE);
    const bot = mode.bots.find((brain) => brain.contestant === contestant);
    const ship = game.alone(contestant, THIRD);
    const place = game.place(THIRD);
    place.owner = contestant.faction;
    game.run(BOTS.thinkInterval + 0.1);
    assert.equal(bot.goal.kind, 'watch');
    const post = place.station.mouth.clone().addScaledVector(place.station.mouth.clone().sub(place.station.berth).normalize(), -1100);
    const before = ship.position.distanceTo(post);
    game.run(10);
    assert.ok(ship.position.distanceTo(post) < before, 'on its way to the post');

    const intruder = mode.launch(ann, place, { warpIn: false });
    intruder.position.copy(place.station.mouth);
    intruder.velocity.set(0, 0, 0);
    mode.requestDock(ann);
    game.server.pilots.get('ann').lastInputAt = -Infinity;
    const enemy = contestant.faction === UMBRA ? DAWN : UMBRA;
    place.zone.world.spawnShip('drone', { faction: enemy, position: ship.position.clone().add({ x: 0, y: 0, z: -300 }), aiMode: 'hold' });
    game.run(BOTS.thinkInterval + 0.1);
    assert.equal(bot.goal.kind, 'attack');
    assert.equal(bot.goal.target, intruder, 'the ship taking the station, not the drone in front of it');
});

test('whole matches of bots play to a decision without anybody at a keyboard', () => {
    for (const seed of [2, 5]) {
        const { server, mode, run } = createTestServer(['ann'], { start: { seed, settings: { bots: 'fill', pace: 'quick' } } });
        const captures = [];
        const capture = mode.capture.bind(mode);
        mode.capture = (place, faction) => { captures.push(place.planet.id); capture(place, faction); };
        for (let minute = 0; minute < 12 && !mode.result; minute++) run(60);

        assert.ok(mode.result, `seed ${seed}: decided within ${Math.round(server.time)} s`);
        assert.ok(captures.length > 0, `seed ${seed}: stations were taken`);
        assert.ok([...mode.contestants.values()].some((contestant) => contestant.pilot.bot && contestant.score > 0), 'and bots scored');
    }
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

/**
 * A match on real clients with nothing computer-flown anywhere (only what the test does
 * happens) and every player on Ann's side - so one of them going down does not put it out.
 */
function comradesMatch(names) {
    const match = createTestMatch(names, { start: { settings: { pace: 'quick' } } });
    match.run(0.5);
    const mode = match.server.mode;
    for (const place of mode.places.values()) {
        for (const ship of [...place.zone.world.ships]) if (!ship.isPlayer && ship.faction !== FACTION.NEUTRAL) place.zone.world.removeShip(ship);
    }
    const side = mode.contestants.get('ann').faction;
    for (const contestant of mode.contestants.values()) {
        contestant.faction = side;
        match.server.setShipFaction(contestant.pilot.zone, contestant.pilot.ship, side);
    }
    mode.sidesAtStart = new Set([side]);
    return match;
}

test('on a player\'s device a pilot shot down sees the wait, then the dock key brings them back at the station offered', () => {
    const match = comradesMatch(['host', 'ann']);
    const [ann] = match.clients;
    const mode = match.server.mode;
    const contestant = mode.contestants.get('ann');
    const from = mode.placeOf(contestant);
    const home = mode.places.get(mode.map.neighbours(from.planet.id)[0]);
    home.owner = contestant.faction;
    const toasts = [];
    const showToast = ann.session.showToast.bind(ann.session);
    ann.session.showToast = (key, params) => { toasts.push(key); showToast(key, params); };

    destroyShip(from.zone.world, contestant.pilot.ship, null);
    match.run(1);
    const { respawn } = ann.ui.match.you;
    assert.equal(ann.ui.match.you.alive, false);
    assert.ok(respawn.wait > 0 && respawn.wait <= BATTLE_ROYALE.respawn.wait);
    assert.deepEqual(respawn.stations, [home.planet.id]);
    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(0.5);
    assert.equal(contestant.alive, false, 'during the wait the key asks for nothing');
    assert.deepEqual(toasts, []);

    match.run(BATTLE_ROYALE.respawn.wait);
    assert.equal(ann.ui.match.you.respawn.wait, 0);
    assert.ok(ann.ui.match.you.respawn.choose > 0);
    ann.session.handleAction(MATCH_ACTION.DOCK);
    match.run(1);

    assert.equal(ann.ui.match.you.alive, true);
    assert.equal(ann.ui.match.you.respawn, null);
    assert.equal(ann.ui.match.you.planet, home.planet.id);
    assert.equal(ann.world.sectorId, home.zone.sectorId, 'a new sky');
    assert.equal(ann.world.player?.pilotId, 'ann', 'and a ship to fly');
    assert.deepEqual(toasts, ['mp.respawned']);
});

test('on a player\'s device the comrades are listed, and one shot down can watch a comrade fly, wherever they go', () => {
    const match = comradesMatch(['host', 'ann', 'bo']);
    const [ann] = match.clients;
    const mode = match.server.mode;
    const host = mode.contestants.get('host');
    const annSeat = mode.contestants.get('ann');
    // The host flies two planets away.
    const away = mode.places.get(mode.map.neighbours(mode.placeOf(annSeat).planet.id)[0]);
    host.pilot.zone.world.removeShip(host.pilot.ship);
    mode.launch(host, away, { warpIn: false });
    match.run(0.5);

    const team = ann.ui.match.you.team;
    assert.deepEqual(team.map((mate) => mate.id).sort(), ['bo', 'host']);
    const hostRow = team.find((mate) => mate.id === 'host');
    assert.deepEqual([hostRow.alive, hostRow.planet, hostRow.hull, hostRow.wait], [true, away.planet.id, 100, null]);

    destroyShip(annSeat.pilot.zone.world, annSeat.pilot.ship, null);
    match.run(0.5);
    assert.deepEqual(ann.match.presenter.watchCandidates().sort(), ['bo', 'host']);
    ann.match.presenter.watch('host');
    match.run(1);
    assert.equal(ann.ui.match.you.watching, 'host');
    assert.equal(ann.world.sectorId, away.zone.sectorId, 'the picture is the host\'s planet');
    assert.equal(ann.world.spectating?.pilotId, 'host', 'and the view rides with the host\'s ship');
    assert.ok(ann.world.spectating.position.distanceTo(host.pilot.ship.position) < 50, 'where the host has it, a moment behind');

    // The watched pilot jumps on: the watcher goes along.
    host.jumpReadyAt = 0;
    const further = mode.map.neighbours(away.planet.id).find((id) => id !== annSeat.pilot.zone.id) ?? mode.map.neighbours(away.planet.id)[0];
    mode.requestJump(host, further);
    match.run(BATTLE_ROYALE.jump.spool + 1.5);
    assert.equal(ann.world.sectorId, mode.places.get(further).zone.sectorId);
    assert.equal(ann.world.spectating?.pilotId, 'host');

    // The key for the next target steps on to the next comrade; a stranger cannot be watched.
    ann.session.handleAction('cycleTarget');
    match.run(1);
    assert.equal(ann.ui.match.you.watching, 'bo');
    mode.requestWatch(annSeat, 'nobody');
    assert.equal(annSeat.watching, 'bo');

    ann.match.presenter.watch(null);
    match.run(0.5);
    assert.equal(ann.ui.match.you.watching, null);
    assert.equal(ann.world.spectating, null);
});

test('a pilot who is down is moved on to another comrade when the one watched goes down, and stops watching once back in a ship', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], di: [DAWN, FOURTH], bo: [UMBRA, GATE] });
    for (const planet of [SECOND, FOURTH, GATE]) game.empty(planet);
    game.place(THIRD).owner = DAWN;
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.ask('ann', BR_REQUEST.WATCH, { id: 'bo' });
    assert.equal(game.who('ann').watching, null, 'not an enemy');
    game.ask('ann', BR_REQUEST.WATCH, { id: 'cy' });
    assert.equal(game.pilot('ann').zone.id, SECOND, 'told about where Cy flies');

    destroyShip(game.world(SECOND), game.ship('cy'), null);
    game.run(0.1);
    assert.equal(game.who('ann').watching, 'di');
    assert.equal(game.pilot('ann').zone.id, FOURTH);
    game.ask('cy', BR_REQUEST.WATCH, { id: 'ann' });
    assert.equal(game.who('cy').watching, null, 'nobody watches a pilot who is down');

    game.run(RESPAWN.wait);
    game.ask('ann', BR_REQUEST.RESPAWN, { at: THIRD });
    assert.equal(game.who('ann').watching, null);
    assert.equal(game.pilot('ann').zone.id, THIRD);
    assert.equal(game.state('ann').you.watching, null);
});

test('once a pilot\'s side is out they may watch anybody still flying', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, GATE], pip: [PIRATE, SECOND] });
    for (const planet of [SECOND, GATE]) game.empty(planet);
    destroyShip(game.world(THIRD), game.ship('ann'), null);
    game.run(0.1);
    assert.equal(game.state('ann').you.out, true);
    game.ask('ann', BR_REQUEST.WATCH, { id: 'bo' });
    assert.equal(game.who('ann').watching, 'bo');
    assert.equal(game.pilot('ann').zone.id, GATE);
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

test('on every device a bot is one more player: listed, named, and flying a player\'s ship', () => {
    const match = createTestMatch(['host', 'ann'], { start: { settings: { bots: 'fill' } } });
    match.run(1);
    const [ann] = match.clients;

    const listed = ann.ui.match.players;
    assert.equal(listed.length, BATTLE_ROYALE.bots.fillTo);
    assert.equal(listed.filter((player) => player.bot).length, BATTLE_ROYALE.bots.fillTo - 2);
    assert.ok(listed.filter((player) => player.bot).every((player) => player.name.startsWith(BATTLE_ROYALE.bots.namePrefix)));

    const botsHere = ann.world.ships.filter((ship) => ship.alive && String(ship.pilotId).startsWith('bot:'));
    for (const ship of botsHere) {
        assert.equal(ship.isPlayer, true);
        assert.notEqual(ship, ann.world.player, 'never this device\'s own ship');
    }
    assert.equal(ann.world.player.pilotId, 'ann');
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
    match.run(ENDING_SECONDS + 0.5);
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
        assert.deepEqual(device.ui.matchOutro, { winner, won: device.ui.match.you.faction === winner, act: 'gate' });
        assert.equal(device.world.controlsLocked, true, 'nobody flies during it');
    }

    match.run(BATTLE_ROYALE.outro.seconds);
    for (const device of match.devices) {
        assert.equal(device.session.phase, 'playing', 'the gate was only the first act');
        assert.deepEqual(device.ui.matchOutro, { winner, won: device.ui.match.you.faction === winner, act: 'fall' });
    }

    match.run(BATTLE_ROYALE.outro.fall.seconds);
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
        assert.equal(device.world.warpFactor, 0);
        assert.deepEqual(heard.get(device).cues, ['defeat']);
    }

    match.run(BATTLE_ROYALE.outro.seconds * 0.45);
    for (const device of losers) assert.ok(device.world.screenFade > 0.2, 'the dark is closing in');

    match.run(BATTLE_ROYALE.outro.seconds * 0.05 + 0.3);
    for (const device of winners) assert.deepEqual(heard.get(device).warps, ['arrive'], 'and they are through');
    for (const device of losers) assert.deepEqual(heard.get(device).warps, []);
});

test('the ending is played at the stargate, wherever each player was', () => {
    const { match, winner, winners, losers } = decided();
    const gateSector = STAR_SYSTEM.planets.at(-1).sectorId;
    match.run(0.3);

    for (const device of match.devices) {
        const { world } = device;
        assert.equal(world.sectorId, gateSector, 'the picture has cut to the gate');
        const gate = world.findByTag(GATE_TAG);
        assert.ok(gate, 'the gate is on the stage');
        assert.ok(world.findByTag(STATION_TAG), 'and the station it stands off');
        assert.ok(world.player?.alive, 'and the player has a ship to see it from');
        assert.equal(world.player.classId, device.ui.match.players.find((player) => player.id === device.id).classId);
        assert.equal(world.gateField.faction, winner, 'the gate wears the winners\' colour');
        // Everybody is in front of the gate, looking at it.
        const toGate = gate.position.clone().sub(world.player.position);
        const nose = new Vector3(0, 0, -1).applyQuaternion(world.player.quaternion);
        assert.ok(toGate.length() > 3000);
        assert.ok(nose.dot(toGate.normalize()) > 0.99);
    }

    // The winners run at it, the others only drift.
    const before = new Map(match.devices.map((device) => [device, device.world.player.position.clone()]));
    match.run(BATTLE_ROYALE.outro.seconds * 0.5);
    for (const device of winners) assert.ok(device.world.player.position.distanceTo(before.get(device)) > 500);
    for (const device of losers) assert.ok(device.world.player.position.distanceTo(before.get(device)) < 300);
    for (const device of match.devices) assert.ok(device.world.gateField.open > 0.99, 'the way through is open');

    match.run(BATTLE_ROYALE.outro.seconds * 0.5 - 0.35);
    for (const device of winners) {
        const gate = device.world.findByTag(GATE_TAG);
        assert.ok(device.world.player.position.distanceTo(gate.position) < 100, 'into the middle of the gate');
        assert.equal(device.world.gateField.open, 1);
        assert.equal(device.world.gateField.shut, 0);
    }
    for (const device of losers) {
        assert.equal(device.world.gateField.open, 0, 'closed behind them');
        assert.equal(device.world.gateField.shut, 1);
    }
});

test('the rest of the winning side is seen going through the gate, by friend and foe', () => {
    const match = createTestMatch(['host', 'ann', 'bo', 'cy']);
    match.run(0.5);
    const mode = match.server.mode;
    // Two pilots on the winning side, whatever the deal was.
    const first = mode.contestants.get('host');
    const second = mode.contestants.get('ann');
    second.faction = first.faction;
    match.run(0.3);
    mode.finish(first.faction);
    match.run(0.3);

    for (const device of match.devices) {
        const won = device.ui.match.you.faction === first.faction;
        const expected = device.ui.match.players.filter((player) => player.faction === first.faction && player.id !== device.id).length;
        const others = device.world.ships.filter((ship) => ship.isPlayer && ship !== device.world.player && ship.faction === first.faction);
        assert.equal(others.length, expected, `${device.id} sees every other winner`);
        assert.equal(expected, won ? 1 : 2);
    }

    match.run(BATTLE_ROYALE.outro.seconds - 0.4);
    for (const device of match.devices) {
        const others = device.world.ships.filter((ship) => ship.isPlayer && ship !== device.world.player && ship.faction === first.faction);
        assert.equal(others.length, 0, 'they are through, and gone');
        // Those who lost are still there, at the gate that did not open for them.
        const left = device.ui.match.players.filter((player) => player.faction !== first.faction && player.id !== device.id).length;
        assert.equal(device.world.ships.filter((ship) => ship.isPlayer && ship !== device.world.player).length, left);
    }
});

/** Runs a decided match to `into` seconds of its second act. */
function intoTheFall(game, into) {
    game.match.run(BATTLE_ROYALE.outro.seconds + into);
    return game;
}
/** The ships on a device's stage that the black hole is there for: every one but the eye's own, the station and the gate. */
const fleetOf = (device) => device.world.ships.filter((ship) => ship.alive && ship !== device.world.player && !ship.tags.has(STATION_TAG) && !ship.tags.has(GATE_TAG));

test('the fleets that lost are at the gate from the start of the ending, clear of the winners\' road', () => {
    const { match, winner, winners } = decided();
    match.run(0.3);
    for (const device of match.devices) {
        const fleet = fleetOf(device).filter((ship) => ship.faction !== winner);
        assert.ok(fleet.length >= 4);
        assert.equal(device.world.singularity.size, 0, 'the hole is not here yet');
        assert.ok(fleet.every((ship) => ship.tidal === 0));
    }
    // A winner's run goes through none of them.
    const device = winners[0];
    const fleet = fleetOf(device).filter((ship) => ship.faction !== winner);
    let closest = Infinity;
    for (let elapsed = 0.3; elapsed < BATTLE_ROYALE.outro.seconds - 0.1; elapsed += 0.1) {
        match.run(0.1);
        for (const ship of fleet) closest = Math.min(closest, ship.distanceToPoint(device.world.player.position));
    }
    assert.ok(closest > 150, `a ship ${Math.round(closest)} m from the winners' road`);
});

test('after the gate the black hole comes for the system, and for every side that lost', () => {
    const { match, winner, winners, losers } = intoTheFall(decided(), 0.5);

    for (const device of match.devices) {
        const { world } = device;
        assert.ok(world.singularity.size > 0, 'the hole is in the sky');
        assert.deepEqual([world.gateField.open, world.gateField.shut], [0, 1], 'the gate is dead');
        assert.equal(world.warpFactor, 0);
        const fleet = fleetOf(device);
        assert.ok(fleet.length >= 4);
        assert.ok(fleet.every((ship) => ship.faction !== winner), 'nobody of the winning side is left here');
        // The computer-flown fleets of the sides that lost, and the other players who lost.
        for (const faction of NPC_FACTIONS.filter((side) => side !== winner)) {
            assert.ok(fleet.some((ship) => !ship.isPlayer && ship.faction === faction), `${faction}'s fleet`);
        }
        const others = device.ui.match.players.filter((player) => player.faction !== winner && player.id !== device.id);
        assert.deepEqual(fleet.filter((ship) => ship.isPlayer).map((ship) => ship.pilotId).sort(), others.map((player) => player.id).sort());
        // Everything in front of the eye, and the eye looks the way the hole is coming.
        const nose = new Vector3(0, 0, -1).applyQuaternion(world.player.quaternion);
        assert.ok(nose.dot(world.singularity.direction) > 0.8);
        for (const ship of fleet) assert.ok(ship.position.clone().sub(world.player.position).dot(nose) > 0, `${ship.classId} is in view`);
    }
    for (const device of winners) assert.equal(device.world.player.alive, false, 'the winners are out of it: only the eye is here');
    for (const device of losers) assert.equal(device.world.player.alive, true, 'everybody else is in their cockpit');
});

test('the ships are drawn out and torn apart one after another, the station breaks up, and the dark takes the rest', () => {
    const game = decided();
    const { match, losers } = game;
    const { fall } = BATTLE_ROYALE.outro;
    intoTheFall(game, 0.3);
    const device = losers[0];
    const { world } = device;
    const fleet = fleetOf(device);
    const station = world.findByTag(STATION_TAG);
    const blasts = [];
    world.events.on('explosion', ({ ship }) => blasts.push(ship));
    const startSize = world.singularity.size;
    assert.equal(station.alive, true);

    let alive = fleet.length;
    let stretched = 0;
    const stillStanding = [];
    for (let elapsed = 0.3; elapsed < fall.seconds * fall.tearing[1] + 0.2; elapsed += 0.25) {
        match.run(0.25);
        const now = fleet.filter((ship) => ship.alive).length;
        assert.ok(now <= alive);
        alive = now;
        stillStanding.push(now);
        stretched = Math.max(stretched, ...fleet.filter((ship) => ship.alive).map((ship) => ship.tidal));
    }
    assert.equal(alive, 0, 'every one of them is gone');
    assert.ok(new Set(stillStanding).size >= 4, 'not all at once');
    assert.ok(stretched > 0.5, 'each is drawn out before it bursts');
    assert.equal(station.alive, false, 'the station has broken up');
    assert.ok(fleet.every((ship) => blasts.includes(ship)) && blasts.includes(station), 'every one went with a blast');
    assert.ok(world.singularity.size > startSize + 0.3, 'the hole has grown');
    assert.equal(world.player.alive, true, 'the watcher is the last to go');

    match.run(fall.seconds * (fall.own - fall.tearing[1]));
    assert.equal(world.player.alive, false, 'and goes');
    assert.ok(blasts.includes(world.player));

    match.run(fall.seconds * (1 - fall.own) + 0.1);
    assert.equal(world.screenFade, 1, 'nothing is left to see');
    assert.equal(device.session.phase, 'matchover', 'only now the result');
});

test('a match nobody won ends the same way: no gate for anybody, then the fall takes every side', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    match.server.mode.finish(null);
    match.run(BATTLE_ROYALE.outro.seconds + 0.5);

    for (const device of match.devices) {
        assert.deepEqual(device.ui.matchOutro, { winner: null, won: false, act: 'fall' });
        assert.equal(device.world.player.alive, true);
        const fleet = fleetOf(device);
        for (const faction of NPC_FACTIONS) assert.ok(fleet.some((ship) => ship.faction === faction));
        assert.equal(fleet.filter((ship) => ship.isPlayer).length, 1, 'the other player is in it too');
    }
});

test('the stage is the ending\'s own: nothing the host still simulates shows on it', () => {
    const { match } = decided();
    match.run(0.5);
    const counts = match.devices.map((device) => device.world.ships.length);
    // The host goes on simulating its zones (and sending them): the garrisons are still out there.
    assert.ok([...match.server.zones.values()].some((zone) => zone.world.ships.length > 4));

    match.run(2);

    assert.deepEqual(match.devices.map((device) => device.world.ships.length), counts);
    for (const device of match.devices) assert.equal(device.world.projectiles.length, 0);
});

test('a match nobody won ends in the dark for everyone', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    match.server.mode.finish(null);
    match.run(2.2);

    for (const device of match.devices) {
        assert.deepEqual(device.ui.matchOutro, { winner: null, won: false, act: 'gate' });
        assert.equal(device.world.gateField.open, 0, 'the gate opens for nobody');
        assert.ok(device.world.gateField.shut > 0, 'it is dying');
        assert.equal(device.world.ships.filter((ship) => ship.isPlayer && ship !== device.world.player).length, 1, 'the other player waits at it too');
    }

    match.run(BATTLE_ROYALE.outro.seconds - 2.4);
    for (const device of match.devices) {
        assert.ok(device.world.screenFade > 0.5, 'and the dark closes in');
        assert.equal(device.world.gateField.shut, 1);
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
    const { match, losers } = intoTheFall(decided(), 2);
    const device = losers[0];
    assert.ok(device.world.singularity.size > 0);

    device.session.enterTitle();

    assert.equal(device.world.screenFade, 0);
    assert.equal(device.world.warpFactor, 0);
    assert.deepEqual(device.world.gateField, { charge: 0, open: 0, shut: 0, pulse: 0, faction: null });
    assert.equal(device.world.singularity.size, 0);
    assert.equal(device.ui.matchOutro, null);
    assert.equal(device.session.phase, 'title');
});
