import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, NPC_FACTIONS, PLAYER_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { createRng } from '../../src/game/core/math.js';
import { LOYALTY, LoyaltyRecord, dealFactions } from '../../src/game/modes/battleRoyale/allegiance.js';
import { rankPlayers, rankWinners, sanitizeBattleRoyaleState } from '../../src/game/modes/battleRoyale/battleRoyaleState.js';
import { CollapseClock, PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import { planGarrisons } from '../../src/game/modes/battleRoyale/garrisons.js';
import { StarMap } from '../../src/game/modes/battleRoyale/starMap.js';

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
        jump: { cooldown: 14, to: null, spool: null, trapped: false }, vote: { planet: 'rust', endsIn: 7, choice: null },
    },
    planets: STAR_SYSTEM.planets.map((planet) => ({ id: planet.id, status: 'safe', changesIn: 100, owner: null, forces: { dawn: 4, umbra: 0 }, comrades: ['Bo'] })),
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
    assert.deepEqual(clean.planets[0].forces, { dawn: 4, umbra: 0 });
    assert.deepEqual(clean.players[0], { id: 'a', name: 'Ann', classId: 'kestrel', faction: 'umbra', alive: true, score: 500, kills: 1, deaths: 0 });
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
    raw.planets[0].status = 'exploding';
    raw.planets[0].owner = 'me';
    raw.planets[0].forces = { dawn: -4, umbra: 'many', pirate: 9 };
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
    assert.deepEqual(clean.you.jump, { cooldown: 0, to: null, spool: 0, trapped: true });
    assert.equal(clean.you.vote.choice, null);
    assert.equal(clean.planets[0].status, 'safe');
    assert.equal(clean.planets[0].owner, null);
    assert.deepEqual(clean.planets[0].forces, { dawn: 0, umbra: 0 });
    assert.equal(clean.planets[0].comrades[0].length, 40);
    assert.equal(clean.planets.some((planet) => planet.id === 'pluto'), false);
    assert.equal(clean.players[0].score, 0);
    assert.equal(clean.players[0].name.length, 40);
    assert.equal(clean.players[0].faction, 'dawn');
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
