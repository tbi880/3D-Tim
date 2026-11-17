import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, NPC_FACTIONS, PLAYER_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { Quaternion, Vector3 } from 'three';
import { createRng, forwardOf } from '../../src/game/core/math.js';
import { drainShip } from '../../src/game/core/systems/damage.js';
import { World } from '../../src/game/core/World.js';
import { LOYALTY, LoyaltyRecord, dealFactions } from '../../src/game/modes/battleRoyale/allegiance.js';
import { isBattle, rankPlayers, rankWinners, sanitizeBattleRoyaleState } from '../../src/game/modes/battleRoyale/battleRoyaleState.js';
import { CollapseClock, PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import { EQUIPMENT, EQUIPMENT_ORDER, Inventory, isEquipment } from '../../src/game/modes/battleRoyale/equipment.js';
import { planGarrisons, stationGarrison } from '../../src/game/modes/battleRoyale/garrisons.js';
import { StarMap } from '../../src/game/modes/battleRoyale/starMap.js';
import { GateCeremony } from '../../src/game/modes/battleRoyale/gateCeremony.js';
import { GATE_TAG, STATION_TAG, buildGate, buildStation, gatePose } from '../../src/game/modes/battleRoyale/station.js';
import { Zone } from '../../src/game/net/server/Zone.js';

// ---- Configuration ---------------------------------------------------------------------------

test('every planet is fought over in a sector the game has, and the last one holds the gate', () => {
    const { planets } = STAR_SYSTEM;
    assert.ok(planets.length >= 3);
    for (const planet of planets) assert.ok(SECTORS[planet.sectorId], `${planet.id} -> ${planet.sectorId}`);
    assert.equal(new Set(planets.map((planet) => planet.id)).size, planets.length, 'ids are unique');
    assert.deepEqual(planets.filter((planet) => planet.gate).map((planet) => planet.id), [planets[planets.length - 1].id]);
});

test('garrisons, reinforcements and scores only name ships the game has', () => {
    const lists = [...NPC_FACTIONS.flatMap((faction) => [BATTLE_ROYALE.garrisons[faction], BATTLE_ROYALE.garrisons.gate[faction]])];
    for (const list of lists) for (const [classId, count] of list) {
        assert.ok(SHIP_CLASSES[classId], classId);
        assert.ok(count > 0);
    }
    for (const classId of Object.values(BATTLE_ROYALE.summon.ships)) assert.ok(SHIP_CLASSES[classId], classId);
    for (const classId of Object.keys(BATTLE_ROYALE.score.ships)) assert.ok(SHIP_CLASSES[classId], classId);
    assert.equal(BATTLE_ROYALE.summon.ships[FACTION.PIRATE], undefined, 'pirates have nobody to call');
});

test('the rules Tim asked for are the numbers in the table', () => {
    assert.equal(BATTLE_ROYALE.jump.cooldown, 60);
    assert.deepEqual(BATTLE_ROYALE.collapse.interval, [180, 300]);
    assert.equal(BATTLE_ROYALE.collapse.collapsing, 30);
    assert.equal(BATTLE_ROYALE.capture.points, 3);
    assert.equal(BATTLE_ROYALE.capture.piratePoints, 9);
    assert.deepEqual(PLAYER_FACTIONS, [FACTION.DAWN, FACTION.UMBRA, FACTION.PIRATE]);
    assert.deepEqual(NPC_FACTIONS, [FACTION.DAWN, FACTION.UMBRA]);
});

// ---- StarMap ---------------------------------------------------------------------------------

const sol = new StarMap({ id: 'sol', planets: ['mercury', 'venus', 'earth', 'mars'].map((id) => ({ id, sectorId: 'home' })) });

test('a jump only reaches the next orbit in or out', () => {
    assert.deepEqual(sol.neighbours('venus'), ['mercury', 'earth']);
    assert.equal(sol.areNeighbours('venus', 'earth'), true);
    assert.equal(sol.areNeighbours('earth', 'venus'), true);
    assert.equal(sol.areNeighbours('venus', 'mars'), false, 'Earth is in between');
    assert.equal(sol.areNeighbours('venus', 'venus'), false);
});

test('the innermost and outermost planets have one neighbour each', () => {
    assert.deepEqual(sol.neighbours('mercury'), ['venus']);
    assert.deepEqual(sol.neighbours('mars'), ['earth']);
    assert.equal(sol.gate.id, 'mars');
});

test('unknown planets are nowhere', () => {
    assert.deepEqual(sol.neighbours('pluto'), []);
    assert.equal(sol.areNeighbours('earth', 'pluto'), false);
    assert.equal(sol.areNeighbours(undefined, 'earth'), false);
    assert.deepEqual([sol.distance('venus', 'venus'), sol.distance('venus', 'earth'), sol.distance('mars', 'mercury')], [0, 1, 3]);
    assert.equal(sol.distance('earth', 'pluto'), Infinity);
    assert.equal(sol.has('pluto'), false);
    assert.equal(sol.planet('pluto'), null);
});

// ---- CollapseClock ---------------------------------------------------------------------------

const timing = { firstAfter: [100, 100], interval: [200, 200], collapsing: 30, finalStand: 300 };
const clockAt = (time, options = {}) => {
    const clock = new CollapseClock({ planets: 4, rng: () => 0.5, timing, ...options });
    clock.advanceTo(time);
    return clock;
};

test('planets fall in one at a time from the inside, and the last never does', () => {
    const statuses = (time) => [0, 1, 2, 3].map((orbit) => clockAt(time).statusOf(orbit));
    const { SAFE, COLLAPSING, SWALLOWED } = PLANET_STATUS;

    assert.deepEqual(statuses(0), [SAFE, SAFE, SAFE, SAFE]);
    assert.deepEqual(statuses(99), [SAFE, SAFE, SAFE, SAFE]);
    assert.deepEqual(statuses(100), [COLLAPSING, SAFE, SAFE, SAFE]);
    assert.deepEqual(statuses(129), [COLLAPSING, SAFE, SAFE, SAFE]);
    assert.deepEqual(statuses(130), [SWALLOWED, SAFE, SAFE, SAFE]);
    assert.deepEqual(statuses(330), [SWALLOWED, COLLAPSING, SAFE, SAFE], '200 s after the first was swallowed');
    assert.deepEqual(statuses(360), [SWALLOWED, SWALLOWED, SAFE, SAFE]);
    assert.deepEqual(statuses(590), [SWALLOWED, SWALLOWED, SWALLOWED, SAFE]);
    assert.deepEqual(statuses(1e6), [SWALLOWED, SWALLOWED, SWALLOWED, SAFE]);
});

test('each planet says how long until its state changes', () => {
    assert.equal(clockAt(40).secondsToChange(0), 60);
    assert.equal(clockAt(110).secondsToChange(0), 20, 'collapsing: time left to get out');
    assert.equal(clockAt(140).secondsToChange(0), null, 'swallowed: nothing more will happen');
    assert.equal(clockAt(40).secondsToChange(1), 290);
    assert.equal(clockAt(40).secondsToChange(3), null, 'the gate planet never changes');
});

test('the final stand starts when only the last planet is left', () => {
    assert.equal(clockAt(589).finalStand, false);
    assert.equal(clockAt(589).finalStandLeft, null);
    assert.equal(clockAt(590).finalStand, true);
    assert.equal(clockAt(590).finalStandLeft, 300);
    assert.equal(clockAt(890).finalStandLeft, 0);
    assert.equal(clockAt(5000).finalStandLeft, 0);
});

test('waits are drawn from the configured range and scaled by the pace', () => {
    const ranged = { ...timing, firstAfter: [180, 300], interval: [180, 300] };
    for (let seed = 1; seed <= 20; seed++) {
        const clock = new CollapseClock({ planets: 6, rng: createRng(seed), timing: ranged });
        let previousGone = 0;
        for (const { startsAt, goneAt } of clock.schedule) {
            const wait = startsAt - previousGone;
            assert.ok(wait >= 180 && wait <= 300, `wait of ${wait.toFixed(0)} s`);
            assert.equal(goneAt - startsAt, 30);
            previousGone = goneAt;
        }
        assert.equal(clock.schedule.length, 5);
    }
    const quick = new CollapseClock({ planets: 4, rng: () => 0.5, timing, timeScale: 0.5 });
    assert.equal(quick.schedule[0].startsAt, 50, 'waits are halved');
    assert.equal(quick.schedule[0].goneAt, 80, 'the 30 seconds to get out are not');
});

test('the same seed gives the same timetable', () => {
    const make = () => new CollapseClock({ planets: 6, rng: createRng(99), timing: BATTLE_ROYALE.collapse }).schedule;
    assert.deepEqual(make(), make());
});

// ---- Sides -----------------------------------------------------------------------------------

test('every side gets a player before any side gets two', () => {
    for (let seed = 1; seed <= 30; seed++) {
        for (const players of [2, 3, 4, 6, 8]) {
            const ids = Array.from({ length: players }, (_, i) => `p${i}`);
            const dealt = dealFactions(ids, PLAYER_FACTIONS, createRng(seed));
            const sizes = PLAYER_FACTIONS.map((faction) => [...dealt.values()].filter((side) => side === faction).length);
            assert.equal(dealt.size, players);
            assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${players} players -> ${sizes}`);
            if (players >= 2) assert.ok(sizes.filter((size) => size > 0).length >= 2, 'never everybody on one side');
        }
    }
});

test('who lands where depends on the seed alone', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual([...dealFactions(ids, PLAYER_FACTIONS, createRng(5))], [...dealFactions(ids, PLAYER_FACTIONS, createRng(5))]);
    const outcomes = new Set(Array.from({ length: 20 }, (_, seed) => dealFactions(ids, PLAYER_FACTIONS, createRng(seed + 1)).get('a')));
    assert.equal(outcomes.size, 3, 'over many seeds a player sees every side');
});

const limits = { warnDamage: 40, treasonDamage: 100, forgivePerSecond: 5 };

test('a few stray shots at one\'s own side are forgiven', () => {
    const record = new LoyaltyRecord(limits);
    assert.equal(record.addDamage(20), null);
    assert.equal(record.status, LOYALTY.TRUSTED);
    record.update(4);
    assert.equal(record.damage, 0);
});

test('enough of them bring one warning, and going on makes a traitor', () => {
    const record = new LoyaltyRecord(limits);
    assert.equal(record.addDamage(39), null);
    assert.equal(record.addDamage(1), LOYALTY.WARNED);
    assert.equal(record.addDamage(10), null, 'warned once, not at every shot');
    assert.equal(record.addDamage(49), null);
    assert.equal(record.addDamage(1), LOYALTY.TRAITOR);
    assert.equal(record.status, LOYALTY.TRAITOR);
});

test('a warned pilot who holds fire is trusted again; a traitor never is', () => {
    const warned = new LoyaltyRecord(limits);
    warned.addDamage(50);
    warned.update(5);
    assert.equal(warned.status, LOYALTY.WARNED, 'not yet');
    warned.update(2);
    assert.equal(warned.status, LOYALTY.TRUSTED);
    assert.equal(warned.addDamage(40), LOYALTY.WARNED, 'and can be warned afresh');

    const traitor = new LoyaltyRecord(limits);
    traitor.addDamage(500);
    traitor.update(1000);
    assert.equal(traitor.status, LOYALTY.TRAITOR);
    assert.equal(traitor.addDamage(10), null);
});

test('nonsense amounts change nothing', () => {
    const record = new LoyaltyRecord(limits);
    for (const amount of [0, -50, NaN, undefined]) assert.equal(record.addDamage(amount), null);
    assert.equal(record.damage, 0);
});

// ---- Garrisons -------------------------------------------------------------------------------

test('every planet is held, the gate is always a battle, and neither side holds much more', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const plan = planGarrisons(STAR_SYSTEM.planets, NPC_FACTIONS, createRng(seed));
        const sides = STAR_SYSTEM.planets.map((planet) => plan.get(planet.id));
        assert.ok(sides.every((present) => present.length >= 1), 'no planet is empty');
        assert.deepEqual(plan.get(STAR_SYSTEM.planets.at(-1).id), NPC_FACTIONS);
        const holds = NPC_FACTIONS.map((faction) => sides.filter((present) => present.includes(faction)).length);
        assert.ok(Math.abs(holds[0] - holds[1]) <= 1, `seed ${seed}: ${holds}`);
        assert.ok(sides.some((present) => present.length === 1), 'some planets are quiet');
        assert.ok(sides.filter((present) => present.length === 2).length >= 2, 'some are at war');
    }
});

// ---- Match state check -----------------------------------------------------------------------

const goodState = () => ({
    mode: 'battleRoyale', matchId: 'm', phase: 'playing', winner: null, time: 12, finalStand: null,
    you: {
        faction: 'umbra', planet: 'rust', alive: true, points: 3, summons: 1, upgrades: { hull: 2 }, loyalty: 'warned',
        jump: { cooldown: 14, to: null, spool: null, trapped: false, reach: 2 }, vote: { planet: 'rust', endsIn: 7, choice: null },
        dock: { ready: false, left: 6.5, seconds: 15 }, picks: 1, equipment: { beacon: 2, overdrive: 1 }, effects: { gravityShield: 12, emergencyShield: 0 },
    },
    planets: STAR_SYSTEM.planets.map((planet) => ({
        id: planet.id, status: 'safe', changesIn: 100, known: true, beacon: true, owner: 'umbra', forces: { dawn: 4, umbra: 0, pirate: 1 }, docking: 'pirate', comrades: ['Bo'],
    })),
    players: [{ id: 'a', name: 'Ann', classId: 'kestrel', faction: 'umbra', alive: true, score: 500, kills: 1, deaths: 0 }],
});

test('a well-formed state comes through unchanged in substance', () => {
    const clean = sanitizeBattleRoyaleState(goodState());
    assert.equal(clean.you.faction, 'umbra');
    assert.equal(clean.you.upgrades.hull, 2);
    assert.equal(clean.you.upgrades.speed, 0, 'every rating is present');
    assert.equal(clean.you.loyalty, 'warned');
    assert.deepEqual(clean.you.vote, { planet: 'rust', endsIn: 7, choice: null });
    assert.equal(clean.planets.length, STAR_SYSTEM.planets.length);
    assert.deepEqual(clean.planets[0].forces, { dawn: 4, umbra: 0, pirate: 1 });
    assert.deepEqual([clean.planets[0].known, clean.planets[0].beacon, clean.planets[0].owner, clean.planets[0].docking], [true, true, 'umbra', 'pirate']);
    assert.equal(clean.you.jump.reach, 2);
    assert.deepEqual(clean.you.dock, { ready: false, left: 6.5, seconds: 15 });
    assert.equal(clean.you.picks, 1);
    assert.deepEqual(clean.you.equipment, { beacon: 2, gravityShield: 0, emergencyShield: 0, overdrive: 1 }, 'every piece is present');
    assert.deepEqual(clean.you.effects, { gravityShield: 12, emergencyShield: 0 });
    assert.deepEqual(clean.players[0], { id: 'a', name: 'Ann', classId: 'kestrel', bot: false, faction: 'umbra', alive: true, score: 500, kills: 1, deaths: 0 });
});

test('what is not a battle royale state is refused', () => {
    for (const bad of [null, 'x', 5, [], {}, { ...goodState(), mode: 'other' }, { ...goodState(), phase: 'nonsense' }, { ...goodState(), planets: 'all' }, { ...goodState(), players: null }]) {
        assert.equal(sanitizeBattleRoyaleState(bad), null);
    }
});

test('odd values are replaced by safe ones, never passed on', () => {
    const raw = goodState();
    raw.winner = '<script>';
    raw.time = -5;
    raw.you.faction = 'admin';
    raw.you.planet = 'pluto';
    raw.you.points = 'lots';
    raw.you.upgrades = { hull: 1e9, evil: 3, speed: -2 };
    raw.you.jump = { cooldown: NaN, to: 'pluto', spool: -3, trapped: 'yes' };
    raw.you.vote.choice = 'both';
    raw.you.dock = { ready: 'yes', left: -2, seconds: 'soon' };
    raw.you.picks = -1;
    raw.you.equipment = { beacon: 'all', nuke: 5, overdrive: 2.9 };
    raw.you.effects = null;
    raw.planets[0].status = 'exploding';
    raw.planets[0].owner = 'me';
    raw.planets[0].docking = 'everyone';
    raw.planets[0].forces = { dawn: -4, umbra: 'many', pirate: 9, admin: 3 };
    raw.planets[1].known = false;
    raw.planets[0].comrades = [{ toString: () => 'x'.repeat(500) }];
    raw.planets.push({ id: 'pluto', status: 'safe' });
    raw.players[0].score = Infinity;
    raw.players[0].name = 'n'.repeat(500);
    raw.players[0].faction = 'gods';

    const clean = sanitizeBattleRoyaleState(raw);

    assert.equal(clean.winner, null);
    assert.equal(clean.time, 0);
    assert.equal(clean.you.faction, 'dawn');
    assert.equal(clean.you.planet, null);
    assert.equal(clean.you.points, 0);
    assert.equal(clean.you.upgrades.evil, undefined);
    assert.equal(clean.you.upgrades.speed, 0);
    assert.deepEqual(clean.you.jump, { cooldown: 0, to: null, spool: 0, trapped: true, reach: 1 });
    assert.equal(clean.you.vote.choice, null);
    assert.deepEqual(clean.you.dock, { ready: true, left: 0, seconds: 1 });
    assert.equal(clean.you.picks, 0);
    assert.deepEqual(clean.you.equipment, { beacon: 0, gravityShield: 0, emergencyShield: 0, overdrive: 2 });
    assert.deepEqual(clean.you.effects, { gravityShield: 0, emergencyShield: 0 });
    assert.equal(clean.planets[0].status, 'safe');
    assert.equal(clean.planets[0].owner, null);
    assert.equal(clean.planets[0].docking, null);
    assert.deepEqual(clean.planets[0].forces, { dawn: 0, umbra: 0, pirate: 9 });
    assert.deepEqual([clean.planets[1].owner, clean.planets[1].forces, clean.planets[1].docking], [null, null, null],
        'a planet the host says is unknown tells nothing, whatever else it sent');
    assert.equal(clean.planets[0].comrades[0].length, 40);
    assert.equal(clean.planets.some((planet) => planet.id === 'pluto'), false);
    assert.equal(clean.players[0].score, 0);
    assert.equal(clean.players[0].name.length, 40);
    assert.equal(clean.players[0].faction, 'dawn');
});

test('a planet is a battle when more than one side has ships there', () => {
    assert.equal(isBattle({ dawn: 3, umbra: 2, pirate: 0 }), true);
    assert.equal(isBattle({ dawn: 0, umbra: 2, pirate: 1 }), true);
    assert.equal(isBattle({ dawn: 3, umbra: 0, pirate: 0 }), false);
    assert.equal(isBattle({ dawn: 0, umbra: 0, pirate: 0 }), false);
    assert.equal(isBattle(null), false, 'nothing is known of it');
});

test('the winners are ranked by score, and listed before everybody else', () => {
    const state = sanitizeBattleRoyaleState({
        ...goodState(),
        phase: 'over',
        winner: 'umbra',
        players: [
            { id: 'a', name: 'Ann', faction: 'umbra', score: 300, kills: 1 },
            { id: 'b', name: 'Bo', faction: 'dawn', score: 9000, kills: 9 },
            { id: 'c', name: 'Cy', faction: 'umbra', score: 1200, kills: 2 },
            { id: 'd', name: 'Di', faction: 'pirate', score: 50, kills: 0 },
        ],
    });

    assert.deepEqual(rankWinners(state).map((player) => player.name), ['Cy', 'Ann']);
    assert.deepEqual(rankPlayers(state).map((player) => player.name), ['Cy', 'Ann', 'Bo', 'Di']);
});

// ---- Equipment -------------------------------------------------------------------------------

test('a pilot\'s hold: a choice buys one piece, a piece is used once', () => {
    const hold = new Inventory({ picks: 1, stack: 2 });
    assert.equal(hold.pick('nonsense'), false);
    assert.equal(hold.pick(EQUIPMENT.BEACON), true);
    assert.equal(hold.pick(EQUIPMENT.BEACON), false, 'no choice left');
    assert.deepEqual([hold.picks, hold.has(EQUIPMENT.BEACON), hold.has(EQUIPMENT.OVERDRIVE)], [0, true, false]);

    hold.grant(3);
    assert.equal(hold.pick(EQUIPMENT.BEACON), true);
    assert.equal(hold.pick(EQUIPMENT.BEACON), false, 'the hold takes two of a kind');
    assert.equal(hold.picks, 2, 'and a choice that bought nothing is not spent');

    assert.equal(hold.use(EQUIPMENT.BEACON), true);
    assert.equal(hold.use(EQUIPMENT.BEACON), true);
    assert.equal(hold.use(EQUIPMENT.BEACON), false);
    assert.equal(hold.use(EQUIPMENT.OVERDRIVE), false);
    assert.deepEqual(Object.keys(hold.describe()), [...EQUIPMENT_ORDER]);
});

test('only the four pieces are equipment', () => {
    assert.equal(EQUIPMENT_ORDER.length, 4);
    assert.ok(EQUIPMENT_ORDER.every(isEquipment));
    for (const junk of [null, undefined, '', 'toString', 'constructor', 3, {}, ['beacon']]) assert.equal(isEquipment(junk), false);
});

// ---- Stations --------------------------------------------------------------------------------

const zoneAt = (sectorId) => new Zone(sectorId, sectorId, { seed: 3 });

test('in every sector the station stands straight ahead of where ships arrive, its dock at the end of a clear lane', () => {
    const layout = BATTLE_ROYALE.station;
    for (const planet of STAR_SYSTEM.planets) {
        const zone = zoneAt(planet.sectorId);
        const station = buildStation(zone, layout);
        const start = SECTORS[planet.sectorId].playerStart;
        const arrival = new Vector3().fromArray(start.position);
        const lane = new Vector3().fromArray(start.facing).normalize();
        const toMouth = station.mouth.clone().sub(arrival);

        assert.ok(toMouth.clone().normalize().dot(lane) > 0.9999, `${planet.id}: the dock is dead ahead`);
        assert.ok(Math.abs(toMouth.length() - (layout.arrival + layout.mouth[2])) < 1, `${planet.id}: ${toMouth.length().toFixed(0)} m away`);
        assert.ok(station.berth.clone().sub(arrival).dot(lane) < toMouth.length(), 'the berth is short of the door');
        assert.ok(forwardOf(station.berthQuaternion, new Vector3()).dot(lane) > 0.9999, 'a docked ship faces the door');
        assert.ok(new Vector3(0, 1, 0).applyQuaternion(station.ship.quaternion).y > 0.99, `${planet.id}: the station stands upright`);
        assert.ok(station.ship.position.length() + station.ship.boundingRadius < 12000, `${planet.id}: inside the sector`);
        assert.equal(station.ship.tags.has(STATION_TAG), true);

        // Nothing solid in the lane: not the station's own hull, not a rock.
        for (let along = 0; along <= toMouth.length(); along += 40) {
            const point = arrival.clone().addScaledVector(lane, along);
            assert.ok(station.ship.distanceToPoint(point) > 60, `${planet.id}: hull in the lane ${along} m in`);
        }
        const rocks = zone.world.obstacles.filter((rock) => rock.alive);
        for (const rock of rocks) {
            assert.ok(station.ship.distanceToPoint(rock.position) >= rock.radius + layout.clearance, `${planet.id}: a rock in the hull`);
        }
        assert.equal(zone.destroyedRocks.length, zone.world.obstacles.length - rocks.length, 'what was cleared is on the list devices are sent');
        assert.equal(station.inRange(station.mouth), true);
        assert.equal(station.inRange(arrival), false);
    }
});

test('a garrison waits inside the ring, out of the hull, and far enough from the arrival point to be left alone', () => {
    const layout = BATTLE_ROYALE.garrisons;
    for (const planet of STAR_SYSTEM.planets) {
        const zone = zoneAt(planet.sectorId);
        const station = buildStation(zone, BATTLE_ROYALE.station);
        const arrival = new Vector3().fromArray(SECTORS[planet.sectorId].playerStart.position);
        for (const faction of NPC_FACTIONS) {
            for (const ship of stationGarrison(zone, station, faction, BATTLE_ROYALE.garrisons.gate[faction], layout, true)) {
                assert.equal(ship.faction, faction);
                assert.equal(ship.ai.engageRange, layout.guardRange);
                assert.ok(station.ship.distanceToPoint(ship.position) > 30, `${planet.id}: ${ship.classId} in the hull`);
                const clear = ship.position.distanceTo(arrival) - BATTLE_ROYALE.jump.scatter;
                assert.ok(clear > layout.guardRange, `${planet.id}: ${ship.classId} ${clear.toFixed(0)} m from the nearest arrival`);
            }
        }
    }
});

test('a drain takes shield then hull at face value, and stops at the hull\'s floor', () => {
    const world = new World({ seed: 1 });
    world.setSector('cinder');
    const ship = world.spawnShip('kestrel', { position: [0, 0, 0], local: false });
    ship.powerMode = 'defense';
    const whole = ship.maxHull + ship.maxShield;

    drainShip(world, ship, 50);
    assert.equal(ship.shield, ship.maxShield - 50);
    assert.ok(ship.shieldCooldown > 0, 'the shield does not mend under it');
    drainShip(world, ship, ship.maxShield);
    assert.equal(ship.shield, 0);
    assert.equal(ship.hull + ship.shield, whole - 50 - ship.maxShield, 'what the shield could not take, the hull did');

    ship.minHull = 5;
    drainShip(world, ship, 1e6);
    assert.deepEqual([ship.hull, ship.alive], [5, true]);
    ship.minHull = 0;
    drainShip(world, ship, 1);
    drainShip(world, ship, 1e6);
    assert.equal(ship.alive, false);

    const station = world.spawnShip('lanternStation', { position: [0, 0, 9000] });
    drainShip(world, station, 1e6);
    assert.equal(station.alive, true, 'what cannot be hurt is not');
});

// ---- The stargate ----------------------------------------------------------------------------

/** The gate built at the last planet, with the station it stands off. */
function gateZone() {
    const planet = STAR_SYSTEM.planets.at(-1);
    const zone = new Zone(planet.id, planet.sectorId, { seed: 3 });
    const station = buildStation(zone, BATTLE_ROYALE.station);
    const gate = buildGate(zone.world, zone.sectorId, BATTLE_ROYALE.station, BATTLE_ROYALE.gate, (rock) => zone.clearRock(rock));
    const pose = gatePose(SECTORS[planet.sectorId].playerStart, BATTLE_ROYALE.station, BATTLE_ROYALE.gate);
    return { zone, station, gate, pose, arrival: new Vector3().fromArray(SECTORS[planet.sectorId].playerStart.position) };
}

test('the stargate hangs over its station, in sight of arriving ships and clear of everything', () => {
    const { zone, station, gate, pose, arrival } = gateZone();

    assert.equal(gate.tags.has(GATE_TAG), true);
    assert.equal(station.ship.tags.has(GATE_TAG), false);
    assert.ok(gate.position.distanceTo(pose.position) < 1e-6);
    assert.ok(gate.position.length() + gate.boundingRadius < 12000, 'inside the sector');

    // Ahead of an arriving ship and above the station: it is the first thing they see past it.
    const toGate = gate.position.clone().sub(arrival);
    const sight = toGate.clone().normalize();
    assert.ok(sight.dot(pose.lane) > Math.cos(Math.PI / 6), 'within thirty degrees of straight ahead');
    assert.ok(toGate.dot(pose.lane) > station.ship.position.clone().sub(arrival).dot(pose.lane), 'beyond the station');
    // Nothing of the station is in the way of that line of sight, and the two do not touch.
    for (let along = 200; along < toGate.length() - gate.boundingRadius; along += 150) {
        assert.ok(station.ship.distanceToPoint(arrival.clone().addScaledVector(sight, along)) > 100, `station in the way ${along} m out`);
    }
    assert.ok(station.ship.distanceToPoint(gate.position) > gate.boundingRadius + 500);
    for (const rock of zone.world.obstacles.filter((rock) => rock.alive)) {
        assert.ok(gate.distanceToPoint(rock.position) >= rock.radius + BATTLE_ROYALE.gate.clearance);
    }
});

test('the stargate is a ring: solid all the way round, open in the middle', () => {
    const { gate, pose } = gateZone();
    const right = new Vector3(1, 0, 0).applyQuaternion(gate.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(gate.quaternion);
    const at = (radius, angle, along = 0) => gate.position.clone()
        .addScaledVector(right, radius * Math.cos(angle)).addScaledVector(up, radius * Math.sin(angle)).addScaledVector(pose.lane, along);

    for (let step = 0; step < 72; step++) {
        const angle = (step / 72) * Math.PI * 2;
        assert.ok(gate.distanceToPoint(at(1075, angle)) <= 0, `a gap in the ring at ${step * 5} degrees`);
        assert.ok(gate.distanceToPoint(at(700, angle)) > 30, `the opening is blocked at ${step * 5} degrees`);
        assert.ok(gate.distanceToPoint(at(1500, angle)) > 100, 'nothing solid outside the ring');
    }
    // The whole way through, along the axis.
    for (let along = -600; along <= 600; along += 100) assert.ok(gate.distanceToPoint(at(0, 0, along)) > 600);
    assert.ok(SHIP_CLASSES.stargate.portal < 1075 - 100, 'the field is drawn inside the ring');
});

/** The ceremony at the real gate. */
function ceremony(options) {
    const { pose } = gateZone();
    return { pose, show: new GateCeremony({ gate: pose, timing: BATTLE_ROYALE.outro, opens: true, others: 0, ...options }) };
}
const { outro: OUTRO } = BATTLE_ROYALE;

test('the ending - a winner runs straight at the gate and is through it as the ending runs out', () => {
    const { pose, show } = ceremony({ won: true, others: 3 });
    const position = new Vector3();
    const quaternion = new Quaternion();
    let last = Infinity;
    let lastSpeed = 0;
    for (let elapsed = 0; elapsed <= OUTRO.seconds + 1e-9; elapsed += 0.25) {
        show.placeViewer(elapsed, position, quaternion);
        const toGate = pose.position.clone().sub(position);
        const distance = toGate.length();
        // Always on the gate's axis, nose to it, closing faster and faster.
        if (distance > 1) assert.ok(toGate.normalize().dot(pose.lane) > 0.9999);
        assert.ok(forwardOf(quaternion, new Vector3()).dot(pose.lane) > 0.9999);
        assert.ok(distance <= last);
        if (elapsed > 0) {
            const speed = (last - distance) / 0.25;
            assert.ok(speed >= lastSpeed - 1e-6, 'it never slows');
            lastSpeed = speed;
        }
        last = distance;
    }
    assert.ok(last < 1e-6, 'at the gate when the ending is over');
    show.placeViewer(0, position, quaternion);
    assert.ok(Math.abs(position.distanceTo(pose.position) - OUTRO.approach) < 1e-6);

    // The gate is open well before they get there, stays open, and the jump builds all the way.
    const field = {};
    assert.equal(show.field(0, field).open, 0);
    assert.equal(show.field(OUTRO.seconds * OUTRO.open, field).open, 1);
    assert.deepEqual([show.field(OUTRO.seconds, field).open, field.shut, field.charge], [1, 0, 1]);
    assert.equal(show.warp(0), 0);
    assert.equal(show.warp(OUTRO.seconds), 1);
    assert.ok(show.warp(OUTRO.seconds / 2) < 0.5);
    assert.equal(show.fade(OUTRO.seconds / 2), 0);
    assert.equal(show.fade(0), 1, 'the picture comes up from black');
});

test('the ending - the rest of the winning side goes through ahead of a winner, one after another', () => {
    const { pose, show } = ceremony({ won: true, others: 4 });
    assert.equal(show.flyers.length, 4);
    const arrivals = show.flyers.map((flyer) => flyer.arrive);
    assert.deepEqual(arrivals, [...arrivals].sort((a, b) => a - b), 'in order');
    assert.equal(new Set(arrivals.map((time) => time.toFixed(3))).size, 4, 'not all at once');
    assert.ok(arrivals.at(-1) < OUTRO.seconds, 'before the player');

    const viewer = new Vector3();
    const position = new Vector3();
    const quaternion = new Quaternion();
    show.placeViewer(0, viewer, quaternion);
    const nose = forwardOf(quaternion, new Vector3());
    show.flyers.forEach((flyer, index) => {
        assert.equal(show.placeFlyer(index, 0, position, quaternion), false);
        // In front of the cockpit at the start: where they can be seen pulling away.
        const offset = position.clone().sub(viewer);
        assert.ok(offset.dot(nose) > 100 && offset.length() < 600);
        assert.equal(show.placeFlyer(index, flyer.arrive, position, quaternion), true);
        assert.ok(Math.abs(position.clone().sub(pose.position).dot(pose.lane)) < 1e-6, 'in the plane of the gate');
        assert.ok(position.distanceTo(pose.position) < SHIP_CLASSES.stargate.portal * 0.5, 'near the middle of the opening');
    });
    // Each one through lights the gate up for a moment.
    const field = {};
    assert.equal(show.field(arrivals[0] - 0.01, field).pulse, 0);
    assert.ok(show.field(arrivals[0] + 0.01, field).pulse > 0.9);
    assert.ok(show.field(arrivals[0] + 0.4, field).pulse < 0.5);
});

test('the ending - everybody else watches the gate open for the winners and close behind them', () => {
    const { pose, show } = ceremony({ won: false, others: 3 });
    const position = new Vector3();
    const quaternion = new Quaternion();
    show.placeViewer(0, position, quaternion);
    const start = position.clone();
    // Off the axis, well back, looking at it.
    const toGate = pose.position.clone().sub(position);
    assert.ok(toGate.length() > 3000);
    assert.ok(toGate.clone().normalize().dot(pose.lane) < 0.99, 'not on the winners\' road');
    assert.ok(forwardOf(quaternion, new Vector3()).dot(toGate.clone().normalize()) > 0.9999);
    show.placeViewer(OUTRO.seconds, position, quaternion);
    assert.ok(position.distanceTo(start) < 400, 'they barely move');

    // Every winner is through before it starts to close.
    const closing = OUTRO.close[0] * OUTRO.seconds;
    assert.ok(show.flyers.every((flyer) => flyer.arrive <= closing + 1e-9));
    assert.ok(show.flyers.every((flyer) => flyer.arrive > 1));
    const field = {};
    assert.equal(show.field(closing, field).open, 1);
    assert.deepEqual([show.field(OUTRO.close[1] * OUTRO.seconds, field).open, field.shut, field.charge], [0, 1, 0]);
    assert.equal(show.warp(OUTRO.seconds), 0, 'no jump for them');
    assert.equal(show.fade(closing), 0);
    assert.ok(Math.abs(show.fade(OUTRO.seconds) - OUTRO.fade[1]) < 1e-9, 'and the dark closes in');
});

test('the ending - when nobody won the gate opens for nobody', () => {
    const { show } = ceremony({ won: false, opens: false, others: 5 });
    assert.equal(show.flyers.length, 0);
    const field = {};
    for (let elapsed = 0; elapsed <= OUTRO.seconds; elapsed += 0.5) {
        show.field(elapsed, field);
        assert.equal(field.open, 0);
        assert.equal(field.pulse, 0);
    }
    assert.equal(field.shut, 1);
    assert.equal(field.charge, 0);
    // A side cannot have "won" a match nobody won.
    assert.equal(new GateCeremony({ gate: gateZone().pose, timing: OUTRO, won: true, opens: false, others: 0 }).warp(OUTRO.seconds), 0);
});
