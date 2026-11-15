import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, NPC_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { applyDamage, areHostile, destroyShip } from '../../src/game/core/systems/damage.js';
import { LOYALTY } from '../../src/game/modes/battleRoyale/allegiance.js';
import { BR_REQUEST, VOTE } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import { GATE_TAG } from '../../src/game/modes/battleRoyale/garrisons.js';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { createTestMatch, createTestServer } from './support/matchHarness.js';

/**
 * The battle royale's rules, played on a bare server: tests put pilots where a scene needs
 * them and ask for things the way a player's device would (`ask`).
 */

const { DAWN, UMBRA, PIRATE } = FACTION;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [INNERMOST, SECOND, THIRD] = PLANETS;
const GATE = PLANETS.at(-1);
const NEXT_TO_GATE = PLANETS.at(-2);

/**
 * A match with every pilot put on a chosen side at a chosen planet, engines stopped:
 *   const game = arrange({ ann: [DAWN, 'haven'], bo: [UMBRA, 'haven'] });
 */
function arrange(seats, settings = {}) {
    const names = Object.keys(seats);
    const game = createTestServer(names, { start: { settings } });
    const { server, mode } = game;
    for (const [name, [faction, planet]] of Object.entries(seats)) {
        const contestant = mode.contestants.get(name);
        const { pilot } = contestant;
        pilot.zone.world.removeShip(pilot.ship);
        contestant.faction = faction;
        const ship = mode.launch(contestant, mode.places.get(planet), { warpIn: false });
        ship.throttle = 0;
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
    /** Jumps the match clock to a moment of the collapse timetable. */
    game.skipTo = (time) => { server.time = time; game.run(0.1); };
    return game;
}

const startsAt = (game, orbit) => game.mode.clock.schedule[orbit].startsAt;
const goneAt = (game, orbit) => game.mode.clock.schedule[orbit].goneAt;

// ---- Setting up ------------------------------------------------------------------------------

test('the match starts with a zone per planet, garrisoned, and the stargate at the last', () => {
    const { server, mode } = createTestServer(['a', 'b', 'c']);

    assert.deepEqual([...server.zones.keys()], PLANETS);
    for (const place of mode.places.values()) {
        const npcs = place.zone.world.ships.filter((ship) => !ship.isPlayer && ship.faction !== FACTION.NEUTRAL);
        assert.ok(npcs.length > 0, `${place.planet.id} has a garrison`);
        assert.ok(npcs.every((ship) => NPC_FACTIONS.includes(ship.faction)), 'pirates have no ships of their own');
        assert.equal(place.zone.world.friendlyFire, true);
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
    assert.ok(Math.abs(arrived.shieldFraction - 0.25) < 0.01, 'and so does the state of the shield');
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

test('a swallowed planet lets nobody go and kills whoever stays', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    game.clear(INNERMOST, UMBRA);
    game.clear(INNERMOST, DAWN);
    game.skipTo(goneAt(game, 0) + 0.1);
    assert.equal(game.place(INNERMOST).status, PLANET_STATUS.SWALLOWED);
    assert.equal(game.state('ann').you.jump.trapped, true);

    game.chargeJump('ann');
    game.ask('ann', BR_REQUEST.JUMP, { to: SECOND });
    assert.equal(game.who('ann').jump, null, 'gravity holds the ship');
    game.run(6);

    assert.equal(game.who('ann').alive, false);
    assert.equal(game.ship('ann'), null);
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
    game.run(8);

    assert.equal(game.who('ann').alive, false);
});

test('the computer-flown ships die with their planet too', () => {
    const game = arrange({ ann: [DAWN, INNERMOST] });
    const garrison = [...game.npcs(INNERMOST, DAWN), ...game.npcs(INNERMOST, UMBRA)];
    assert.ok(garrison.length > 0);
    game.skipTo(goneAt(game, 0) + 0.1);
    game.run(8);

    assert.ok(garrison.every((ship) => !ship.alive));
});

test('a deserted planet\'s garrison is gone the moment it is swallowed', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    assert.ok(game.world(INNERMOST).ships.length > 0);
    game.skipTo(goneAt(game, 0) + 0.1);

    assert.equal(game.world(INNERMOST).ships.length, 0);
    assert.deepEqual(game.state('ann').planets[0].forces, { [DAWN]: 0, [UMBRA]: 0 });
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

test('a side takes a planet by destroying everything hostile there', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.clear(THIRD, DAWN);
    if (game.npcs(THIRD, UMBRA).length === 0) game.world(THIRD).spawnShip('drone', { position: [0, 0, 0] });
    game.run(0.2);
    assert.equal(game.place(THIRD).owner, null);

    game.wipe(THIRD, UMBRA, 'ann');
    game.run(0.2);

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.state('ann').planets.find((planet) => planet.id === THIRD).owner, DAWN);
    assert.equal(game.who('ann').points, BATTLE_ROYALE.capture.points);
    assert.equal(game.who('ann').summons, BATTLE_ROYALE.capture.summons);
    assert.ok(game.who('ann').score >= BATTLE_ROYALE.capture.score);
});

test('helping the garrison win counts: the kills need not be the player\'s own', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.clear(THIRD, UMBRA);
    game.world(THIRD).spawnShip('drone', { position: [0, 0, 0] });
    game.run(0.2);

    game.wipe(THIRD, UMBRA, null);
    game.run(0.2);

    assert.equal(game.place(THIRD).owner, DAWN);
    assert.equal(game.who('ann').points, 3);
});

test('a planet one\'s own side already holds alone is not a prize', () => {
    const game = arrange({ ann: [DAWN, THIRD] });
    game.clear(THIRD, UMBRA);
    game.run(2);

    assert.equal(game.place(THIRD).owner, null);
    assert.equal(game.who('ann').points, 0);
});

test('a planet is not taken while another side\'s pilot is still there', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, THIRD] });
    game.clear(THIRD, DAWN);
    game.clear(THIRD, UMBRA);
    game.world(THIRD).spawnShip('drone', { position: [0, 0, -9000] });
    game.run(0.1);
    game.wipe(THIRD, UMBRA, 'ann');
    game.run(0.3);
    assert.equal(game.place(THIRD).owner, null, 'bo is still flying');

    destroyShip(game.world(THIRD), game.ship('bo'), game.ship('ann'));
    game.run(0.3);
    assert.equal(game.place(THIRD).owner, DAWN);
});

test('a planet cannot be taken by a side with nobody there', () => {
    const game = arrange({ ann: [DAWN, SECOND] });
    game.clear(THIRD, DAWN);
    game.wipe(THIRD, UMBRA, null);
    game.run(0.5);

    assert.equal(game.place(THIRD).owner, null);
});

test('pirates take a planet by destroying both fleets, for three times the points and no reinforcements', () => {
    const game = arrange({ pip: [PIRATE, THIRD] });
    for (const faction of NPC_FACTIONS) {
        if (game.npcs(THIRD, faction).length === 0) game.world(THIRD).spawnShip(faction === DAWN ? 'dart' : 'drone', { faction, position: [0, 0, -9000] });
    }
    game.run(0.1);
    game.wipe(THIRD, DAWN, 'pip');
    game.run(0.2);
    assert.equal(game.place(THIRD).owner, null, 'one fleet is not enough');

    game.wipe(THIRD, UMBRA, 'pip');
    game.run(0.2);
    assert.equal(game.place(THIRD).owner, PIRATE);
    assert.equal(game.who('pip').points, BATTLE_ROYALE.capture.piratePoints);
    assert.equal(game.who('pip').summons, 0);
});

test('a planet can change hands', () => {
    const game = arrange({ ann: [DAWN, THIRD], bo: [UMBRA, SECOND] });
    game.clear(THIRD, DAWN);
    game.clear(THIRD, UMBRA);
    game.world(THIRD).spawnShip('drone', { position: [0, 0, -9000] });
    game.run(0.1);
    game.wipe(THIRD, UMBRA, 'ann');
    game.run(0.2);
    assert.equal(game.place(THIRD).owner, DAWN);

    game.chargeJump('bo');
    game.ask('bo', BR_REQUEST.JUMP, { to: THIRD });
    game.run(BATTLE_ROYALE.jump.spool + 0.3);
    destroyShip(game.world(THIRD), game.ship('ann'), game.ship('bo'));
    game.run(0.3);

    assert.equal(game.place(THIRD).owner, UMBRA);
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
    game.run(6);

    assert.ok(game.npcs(INNERMOST, DAWN).length > 0);
});

// ---- Reward or revive ------------------------------------------------------------------------

/** Ann and Cy (Federation) at one planet with a last drone to kill; Di, of their side, is already dead. */
function captureWithFallen() {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, THIRD], di: [DAWN, THIRD], bo: [UMBRA, GATE] });
    game.clear(THIRD, DAWN);
    game.clear(THIRD, UMBRA);
    game.world(THIRD).spawnShip('drone', { position: [0, 0, -9000] });
    destroyShip(game.world(THIRD), game.ship('di'), null);
    game.run(0.1);
    game.wipe(THIRD, UMBRA, 'ann');
    game.run(0.2);
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
    game.place(GATE).earned.add(DAWN);
    game.skipTo(goneAt(game, PLANETS.length - 2) + 1);
    assert.ok(game.state('ann').finalStand > 0);
    game.clear(GATE, DAWN);
    game.wipe(GATE, UMBRA, 'ann');
    game.run(0.3);

    assert.equal(game.state('bo').phase, MATCH_PHASE.OVER);
    assert.equal(game.state('bo').winner, DAWN);
    const cy = game.state('cy').players.find((player) => player.id === 'cy');
    assert.equal(cy.faction, DAWN, 'a comrade who was not even there wins too');
});

test('taking the stargate before the final stand is only a capture', () => {
    const game = arrange({ ann: [DAWN, GATE], bo: [UMBRA, THIRD] });
    game.run(0.1);
    game.clear(GATE, DAWN);
    game.wipe(GATE, UMBRA, 'ann');
    game.run(0.3);

    assert.equal(game.place(GATE).owner, DAWN);
    assert.equal(game.state('ann').phase, MATCH_PHASE.PLAYING);
    assert.equal(game.who('ann').points, 3);
});

test('when the last stand runs out, the side with the most ships at the gate goes through', () => {
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

test('the map shows garrisons to everybody, but comrades only to their own side', () => {
    const game = arrange({ ann: [DAWN, THIRD], cy: [DAWN, SECOND], bo: [UMBRA, SECOND], pip: [PIRATE, THIRD], pat: [PIRATE, THIRD] });
    const comradesAt = (viewer, planet) => game.state(viewer).planets.find((entry) => entry.id === planet).comrades;

    assert.deepEqual(comradesAt('ann', SECOND), ['cy']);
    assert.deepEqual(comradesAt('ann', THIRD), [], 'not herself, and not the pirates beside her');
    assert.deepEqual(comradesAt('bo', SECOND), [], 'the Umbra pilot is not told where the Federation\'s are');
    assert.deepEqual(comradesAt('pip', THIRD), [], 'pirates have no comrades');
    const forces = game.state('bo').planets.find((entry) => entry.id === GATE).forces;
    assert.ok(forces[DAWN] > 0 && forces[UMBRA] > 0, 'what holds the gate is no secret');
    assert.equal(game.state('ann').you.planet, THIRD);
    assert.equal(JSON.stringify(game.state('bo')).includes('"planet":"' + THIRD + '"'), false, 'nothing in an enemy\'s state says where Ann is');
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
    match.run(0.5);
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
