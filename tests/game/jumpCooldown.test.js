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
 * Only an overdrive chip is not held by the charge - for a bot as for a person - and its jump
 * leaves the charge as it was; a bot burns one only for something that cannot wait.
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

test('a bot back from being shot down has to charge its drive, as anybody does - the short charge of a ship that came back', () => {
    const { game, mode, server, subject } = sentOn(NEXT_TO_GATE);
    subject.pilot.zone.world.removeShip(subject.pilot.ship);
    subject.alive = false;
    mode.respawn(subject, mode.places.get(SECOND));
    const back = server.time;
    assert.equal(mode.respawnJumpCooldown, BATTLE_ROYALE.respawn.jumpCooldown, 'fifteen seconds, not a minute');
    assert.equal(subject.jumpReadyAt, back + mode.respawnJumpCooldown);
    assert.equal(mode.jumpRefusal(subject, PLANETS[2]), JUMP_REFUSAL.CHARGING, 'not yet');

    // Sent on urgently: it goes the moment the short charge is done.
    const log = watchJumps(game, mode.respawnJumpCooldown + NOTICE + SPOOL + FRAME, { where: () => subject.pilot.ship, jumping: () => subject.jump });
    assert.equal(log.starts.length, 1);
    assert.ok(log.starts[0] - back >= mode.respawnJumpCooldown - 1e-6, `never sooner (${(log.starts[0] - back).toFixed(2)} s)`);
    assert.ok(log.starts[0] - back <= mode.respawnJumpCooldown + NOTICE, 'and nothing else held it');
});

test('a bot with an overdrive chip sent on something urgent goes at once on the chip, and its drive\'s charge runs on as it was', () => {
    const { game, mode, server, subject } = sentOn(NEXT_TO_GATE);
    subject.inventory.counts[EQUIPMENT.OVERDRIVE] = 1;
    const readyAt = server.time + 30;
    subject.jumpReadyAt = readyAt;
    game.run(NOTICE + SPOOL + FRAME);
    assert.equal(subject.pilot.zone.id, PLANETS[2], 'two orbits out, thirty seconds before its drive could have gone');
    assert.equal(subject.inventory.counts[EQUIPMENT.OVERDRIVE], 0, 'the chip burnt');
    assert.equal(subject.jumpReadyAt, readyAt, 'and the drive is no further from charged than it was');

    // No chip now: the rest of the way waits for that charge, and only that.
    const log = watchJumps(game, readyAt - server.time + NOTICE + SPOOL + FRAME, { where: () => subject.pilot.ship, jumping: () => subject.jump });
    assert.equal(log.starts.length, 1);
    assert.ok(log.starts[0] >= readyAt - 1e-6, `not before the charge (${(log.starts[0] - readyAt).toFixed(2)} s)`);
    assert.ok(log.starts[0] <= readyAt + NOTICE, 'but the moment it is charged');
    assert.equal(subject.pilot.zone.id, PLANETS[3]);
});

test('a bot sent on something that can wait keeps its chip and waits for its drive', () => {
    const { game, mode, server, subject } = sentOn(NEXT_TO_GATE);
    subject.inventory.counts[EQUIPMENT.OVERDRIVE] = 1;
    mode.councilOf(subject.faction).orderFor = () => ({ planet: NEXT_TO_GATE, task: 'take', urgent: false });
    const readyAt = server.time + 20;
    subject.jumpReadyAt = readyAt;
    const log = watchJumps(game, 20 + NOTICE + SPOOL + FRAME, { where: () => subject.pilot.ship, jumping: () => subject.jump });
    assert.equal(log.starts.length, 1);
    assert.ok(log.starts[0] >= readyAt - 1e-6, 'it waited for the charge');
    assert.equal(subject.pilot.zone.id, SECOND, 'and went one orbit, on its drive');
    assert.equal(subject.inventory.counts[EQUIPMENT.OVERDRIVE], 1, 'the chip kept');
});

test('a bot running from a planet falling in burns its chip only when its drive would not be charged in time', () => {
    for (const late of [false, true]) {
        const { game, mode, server, subject } = sentOn(INNERMOST);
        subject.inventory.counts[EQUIPMENT.OVERDRIVE] = 1;
        const fallsAt = mode.clock.schedule[0].startsAt;
        const fleeing = fallsAt - BATTLE_ROYALE.bots.fleeAhead + 2;
        server.time = fleeing;
        // Charged a few seconds from now - or only once the planet has begun to fall in.
        const readyAt = late ? fallsAt + 10 : fleeing + 4;
        subject.jumpReadyAt = readyAt;
        game.run(NOTICE + SPOOL + FRAME);
        if (late) {
            assert.equal(subject.pilot.zone.id, SECOND, 'out at once, on the chip');
            assert.equal(subject.inventory.counts[EQUIPMENT.OVERDRIVE], 0);
            assert.equal(subject.jumpReadyAt, readyAt, 'its drive\'s charge as it was');
        } else {
            assert.equal(subject.pilot.zone.id, INNERMOST, 'the drive will do in time: it waits for it');
            game.run(4);
            assert.equal(subject.pilot.zone.id, SECOND);
            assert.equal(subject.inventory.counts[EQUIPMENT.OVERDRIVE], 1, 'the chip kept');
        }
    }
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

test('in whole matches of bots nothing jumps sooner than the charge allows - but on an overdrive chip - and only pilots and reinforcements jump at all', () => {
    let squadJumps = 0;
    let chipJumps = 0;
    for (const seed of [3, 8]) {
        const { server, mode, run } = createTestServer(['ann'], { start: { seed, settings: { bots: 'fill', pace: 'quick' } } });
        const cooldown = mode.jumpCooldown;
        const respawnCharge = mode.respawnJumpCooldown;
        // Who arrived where, and when the drive was last spent: a pilot's ship, or a squad's planet
        // (all at the start for the pilots). A pilot's jump on an overdrive chip does not spend the
        // drive: its charge runs on from the arrival before.
        const seen = new Map();
        // `charge` is what the drive needs from then: a minute after a jump, less for a ship that has come back.
        for (const contestant of mode.contestants.values()) seen.set(contestant, { at: contestant.pilot.ship, arrived: server.time, charge: cooldown, spooling: false, jump: null });
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
        /** `jump` is what is spooling up ({ overdrive } for a pilot), `chips` the overdrive chips aboard (a squad has none). */
        const note = (key, at, jump, label, chips = 0) => {
            const entry = seen.get(key) ?? { at, arrived: server.time, charge: cooldown, spooling: false, jump: null };
            if (entry.at !== at) {
                // Arrived: at a new planet after a jump (only an overdrive jump leaves the drive's
                // charge as it was), or in a new ship after being shot down (the short charge).
                if (!entry.jump) Object.assign(entry, { arrived: server.time, charge: respawnCharge });
                else if (!entry.jump.overdrive) Object.assign(entry, { arrived: server.time, charge: cooldown });
                Object.assign(entry, { at, jump: null });
            }
            const spooling = Boolean(jump);
            if (spooling && !entry.spooling) {
                const wait = server.time - entry.arrived;
                if (jump.overdrive) {
                    if (chips < 1) early.push(`${label} took an overdrive jump with no chip aboard`);
                    chipJumps += 1;
                } else if (wait < entry.charge - 1e-6) early.push(`${label} jumped ${wait.toFixed(2)} s after its drive was spent (${entry.charge} s to charge)`);
                if (label.startsWith('squad')) squadJumps += 1;
                else jumps += 1;
                entry.jump = jump;
            }
            entry.spooling = spooling;
            seen.set(key, entry);
        };
        for (let frame = 0; frame < (12 * 60) / FRAME && !mode.result; frame++) {
            run(FRAME, FRAME);
            for (const contestant of mode.contestants.values()) {
                const entry = seen.get(contestant);
                if (contestant.pilot.ship?.alive) {
                    note(contestant, contestant.pilot.ship, contestant.jump, contestant.pilot.name, contestant.inventory.counts[EQUIPMENT.OVERDRIVE]);
                } else if (entry) {
                    // Shot down: whatever it was spooling up died with the ship.
                    Object.assign(entry, { spooling: false, jump: null });
                }
            }
            for (const squad of mode.squads) note(squad, squad.place, squad.jump ? { overdrive: false } : null, squad.key);
        }

        assert.ok(jumps > 10, `seed ${seed}: the bots jumped (${jumps} times)`);
        assert.deepEqual(early, [], `seed ${seed}: nothing jumped before its drive was charged, but on a chip it carried`);
        assert.deepEqual(strays, [], `seed ${seed}: garrisons and motherships stay at their planets`);
    }
    assert.ok(squadJumps > 0, `reinforcements jumped too (${squadJumps} times)`);
    assert.ok(chipJumps > 0, `and some bots went on an overdrive chip (${chipJumps} times)`);
});
