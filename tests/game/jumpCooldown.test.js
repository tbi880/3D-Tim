import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { JUMP_REFUSAL } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { EQUIPMENT } from '../../src/game/modes/battleRoyale/equipment.js';
import { squadIdOf } from '../../src/game/modes/battleRoyale/squads.js';
import { createTestServer } from './support/matchHarness.js';

/**
 * The jump drive's charge (BATTLE_ROYALE.jump.cooldown: a minute after arriving anywhere) holds
 * everything that jumps, not just the people: the bots go through the same rules as a player
 * (BattleRoyaleMode.jumpRefusal), the reinforcements a pilot calls keep a drive of their own
 * (squads.js, charged by the same clock), and the garrisons and motherships never leave their
 * planet at all. (The player's own side of it is in battleRoyale.test.js, under "Jumping".)
 */

const { NEUTRAL, PIRATE } = FACTION;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [INNERMOST, SECOND] = PLANETS;
const GATE = PLANETS.at(-1);
const NEXT_TO_GATE = PLANETS.at(-2);
const { spool: SPOOL } = BATTLE_ROYALE.jump;
const FRAME = 1 / 30;
/** A bot thinks a few times a second, so it may take that long to notice its drive is charged. */
const NOTICE = BATTLE_ROYALE.bots.thinkInterval + FRAME;

/**
 * A match made up with bots, one of them (`subject`, not a pirate: pirates have no
 * reinforcements) on its own: everybody else parked at the stargate, every planet emptied of
 * computer-flown ships (nothing to fight, or be shot by, on the way) and held by the subject's
 * side (no station to stop and take). Its side's war council sends every unit of the side
 * urgently to `goal`, so that only the drive keeps them where they are. Nobody thinks but the
 * units named in `thinking` ('subject', or nobody).
 */
function sentOn(goal, { start = INNERMOST, thinking = 'subject' } = {}) {
    const game = createTestServer(['ann'], { start: { settings: { bots: 'fill' } } });
    const { mode, server } = game;
    const subject = [...mode.contestants.values()].find((contestant) => contestant.pilot.bot && contestant.faction !== PIRATE);
    for (const contestant of mode.contestants.values()) {
        const { pilot } = contestant;
        if (pilot.ship?.alive) pilot.zone.world.removeShip(pilot.ship);
        mode.launch(contestant, mode.places.get(contestant === subject ? start : GATE), { warpIn: false });
        if (!pilot.bot) pilot.lastInputAt = -Infinity;
    }
    for (const place of mode.places.values()) {
        const { world } = place.zone;
        for (const ship of [...world.ships]) {
            if (ship.alive && !ship.isPlayer && ship.faction !== NEUTRAL) world.removeShip(ship);
        }
        if (place.planet.id !== GATE) place.owner = subject.faction;
    }
    mode.bots = thinking === 'subject' ? mode.bots.filter((bot) => bot.contestant === subject) : [];
    // One orbit a jump: no overdrive chip aboard, and none to pick.
    subject.inventory.picks = 0;
    subject.inventory.counts[EQUIPMENT.OVERDRIVE] = 0;
    mode.councilOf(subject.faction).orderFor = () => ({ planet: goal, task: 'take', urgent: true });
    return { game, mode, server, subject };
}

/**
 * Plays the match frame by frame for `seconds`, noting the moments a unit arrives somewhere
 * (`where()` changes) and starts spooling up a jump (`jumping()` turns true).
 */
function watchJumps(game, seconds, { where, jumping }) {
    const arrivals = [];
    const starts = [];
    let place = where();
    let spooling = Boolean(jumping());
    for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
        game.run(FRAME, FRAME);
        const now = where();
        if (now !== place) arrivals.push(game.server.time);
        place = now;
        const spoolingNow = Boolean(jumping());
        if (spoolingNow && !spooling) starts.push(game.server.time);
        spooling = spoolingNow;
    }
    return { arrivals, starts };
}

/** For each jump started after an arrival: the seconds between that arrival and the start. */
function waits({ arrivals, starts }) {
    return starts.map((start) => start - arrivals.filter((arrival) => arrival <= start).at(-1)).filter(Number.isFinite);
}

test('a bot sent on and on jumps once a charge at most, exactly as a player may', () => {
    const { game, mode, server, subject } = sentOn(NEXT_TO_GATE);
    const cooldown = mode.jumpCooldown;
    // Charged to begin with: the first jump goes at once.
    subject.jumpReadyAt = server.time;
    const log = watchJumps(game, 3 * (cooldown + SPOOL) + 5, { where: () => subject.pilot.ship, jumping: () => subject.jump });

    assert.equal(log.starts.length, 4, 'it jumped whenever its drive let it');
    assert.equal(log.arrivals.length, 4);
    assert.equal(subject.pilot.zone.id, NEXT_TO_GATE);
    const between = waits(log);
    assert.equal(between.length, 3);
    for (const wait of between) {
        assert.ok(wait >= cooldown - 1e-6, `never sooner than the charge (${wait.toFixed(2)} s after arriving)`);
        assert.ok(wait <= cooldown + NOTICE, `and nothing else held it (${wait.toFixed(2)} s)`);
    }
});

test('a bot running from a planet falling in still waits for its drive', () => {
    const { game, mode, server, subject } = sentOn(INNERMOST);
    const fleeing = mode.clock.schedule[0].startsAt - BATTLE_ROYALE.bots.fleeAhead + 2;
    // It arrived a little under a minute before it wants to get away.
    subject.jumpReadyAt = fleeing + 4;
    server.time = fleeing;
    game.run(3.5);
    assert.equal(subject.pilot.zone.id, INNERMOST, 'the drive is still charging');
    assert.equal(subject.jump, null, 'and it has not started spooling up');

    game.run(1 + SPOOL + NOTICE);
    assert.equal(subject.pilot.zone.id, SECOND, 'charged: out, outwards');
    assert.ok(subject.jumpReadyAt > server.time + mode.jumpCooldown - 1, 'and charging again for the next');
});

test('a bot back from being shot down has to charge its drive, as anybody does', () => {
    const { mode, server, subject } = sentOn(NEXT_TO_GATE, { thinking: 'nobody' });
    subject.pilot.zone.world.removeShip(subject.pilot.ship);
    subject.alive = false;
    mode.respawn(subject, mode.places.get(SECOND));
    assert.equal(subject.jumpReadyAt, server.time + mode.jumpCooldown);
    assert.equal(mode.jumpRefusal(subject, PLANETS[2]), JUMP_REFUSAL.CHARGING, 'not yet');
});

test('reinforcements are held to the same charge: none when they are called, a full one after every jump', () => {
    const { game, mode, server, subject } = sentOn(GATE, { start: SECOND, thinking: 'nobody' });
    const cooldown = mode.jumpCooldown;
    subject.summons = 1;
    mode.summon(subject);
    const [squad] = mode.squads;
    const calledAt = server.time;
    assert.equal(squad.readyAt, calledAt + cooldown, 'they drop out of warp with their drives spent');
    // The war council's orders are urgent: only the drives keep them waiting.
    const log = watchJumps(game, 3 * (cooldown + SPOOL) + 1, { where: () => squad.place, jumping: () => squad.jump });

    assert.equal(log.starts.length, 3);
    assert.ok(log.starts[0] - calledAt >= cooldown - 1e-6, `the first jump waits a full charge from the call (${(log.starts[0] - calledAt).toFixed(2)} s)`);
    assert.ok(log.starts[0] - calledAt <= cooldown + FRAME, 'and goes the moment it is charged');
    const between = waits(log);
    assert.equal(between.length, 2);
    for (const wait of between) {
        assert.ok(wait >= cooldown - 1e-6 && wait <= cooldown + FRAME, `a full charge after every arrival (${wait.toFixed(2)} s)`);
    }
    assert.equal(squad.place.planet.id, PLANETS[4]);
    assert.equal(squad.ships.length, BATTLE_ROYALE.summon.count);
});

test('reinforcements running from a planet falling in still wait for their drives', () => {
    const { game, mode, server, subject } = sentOn(INNERMOST, { thinking: 'nobody' });
    subject.summons = 1;
    mode.summon(subject);
    const [squad] = mode.squads;
    const fleeing = mode.clock.schedule[0].startsAt - BATTLE_ROYALE.bots.fleeAhead + 2;
    squad.readyAt = fleeing + 4;
    server.time = fleeing;
    game.run(3.5);
    assert.equal(squad.place.planet.id, INNERMOST, 'their drives are still charging');
    assert.equal(squad.jump, null);

    game.run(1 + SPOOL + FRAME);
    assert.equal(squad.place.planet.id, SECOND, 'charged: out, outwards');
    assert.ok(squad.readyAt > server.time + mode.jumpCooldown - 1, 'and charging again for the next');
});

test('in whole matches of bots nothing jumps sooner than the charge allows, and only pilots and reinforcements jump at all', () => {
    let squadJumps = 0;
    for (const seed of [3, 8]) {
        const { server, mode, run } = createTestServer(['ann'], { start: { seed, settings: { bots: 'fill', pace: 'quick' } } });
        const cooldown = mode.jumpCooldown;
        // Who arrived where, and when: a pilot's ship, or a squad's planet (all at the start for the pilots).
        const seen = new Map();
        for (const contestant of mode.contestants.values()) seen.set(contestant, { at: contestant.pilot.ship, arrived: server.time, spooling: false });
        const early = [];
        const strays = [];
        let jumps = 0;
        for (const place of mode.places.values()) {
            const { world } = place.zone;
            const remove = world.removeShip.bind(world);
            world.removeShip = (ship, options) => {
                if (options?.flash && !ship.isPlayer && squadIdOf(ship) === null) strays.push(`${ship.classId} left ${place.planet.id}`);
                return remove(ship, options);
            };
            const spawn = world.spawnShip.bind(world);
            world.spawnShip = (classId, options) => {
                const ship = spawn(classId, options);
                if (options?.warpIn && !ship.isPlayer && squadIdOf(ship) === null) strays.push(`${classId} jumped into ${place.planet.id}`);
                return ship;
            };
        }
        const note = (key, at, spooling, label) => {
            const entry = seen.get(key) ?? { at, arrived: server.time, spooling: false };
            if (entry.at !== at) Object.assign(entry, { at, arrived: server.time });
            if (spooling && !entry.spooling) {
                const wait = server.time - entry.arrived;
                if (wait < cooldown - 1e-6) early.push(`${label} jumped ${wait.toFixed(2)} s after arriving`);
                if (label.startsWith('squad')) squadJumps += 1;
                else jumps += 1;
            }
            entry.spooling = spooling;
            seen.set(key, entry);
        };
        for (let frame = 0; frame < (12 * 60) / FRAME && !mode.result; frame++) {
            run(FRAME, FRAME);
            for (const contestant of mode.contestants.values()) {
                if (contestant.pilot.ship?.alive) note(contestant, contestant.pilot.ship, Boolean(contestant.jump), contestant.pilot.name);
            }
            for (const squad of mode.squads) note(squad, squad.place, Boolean(squad.jump), squad.key);
        }

        assert.ok(jumps > 10, `seed ${seed}: the bots jumped (${jumps} times)`);
        assert.deepEqual(early, [], `seed ${seed}: nothing jumped before its drive was charged`);
        assert.deepEqual(strays, [], `seed ${seed}: garrisons and motherships stay at their planets`);
    }
    assert.ok(squadJumps > 0, `reinforcements jumped too (${squadJumps} times)`);
});
