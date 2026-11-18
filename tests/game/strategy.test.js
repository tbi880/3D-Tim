import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { TASK, WarCouncil, listTasks, planSide, route, stepToward } from '../../src/game/modes/battleRoyale/strategy.js';

/**
 * Where a side's computer-flown units go (modes/battleRoyale/strategy.js), planned from a
 * picture of the system drawn by hand: `picture` fills in a quiet system with nothing
 * anywhere, and a test says what is different.
 */

const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [EMBER, RUST, HAVEN, VEIL, COLOSSUS, GATE] = PLANETS;
const { jump } = BATTLE_ROYALE;
const TUNING = BATTLE_ROYALE.strategy;

/**
 * A side's picture of the system. `places` overrides planets by id; `units` are placed with `at`.
 * Unless a test says otherwise, every planet stands, holds no enemy, and is nobody's.
 */
function picture({ places = {}, units = [], front = 0, flying = null, fallen = 0, holdsStation = null } = {}) {
    const list = PLANETS.map((id, orbit) => ({
        id, orbit, mine: false, swallowed: false, safeFor: Infinity, beingTaken: false, enemy: 0, friends: 0, units: 0, pilots: 0, underFire: false, losses: 0,
        ...places[id],
    }));
    const pieces = units.map(({ at, ...unit }, index) => ({
        key: unit.squad ? `squad:${index + 1}` : `bot:${index + 1}`, orbit: PLANETS.indexOf(at), readyIn: 0, reach: 1, strength: 1, squad: false, current: null, fixed: null, ...unit,
    }));
    for (const unit of pieces) {
        list[unit.orbit].units += unit.strength;
        if (!unit.squad) list[unit.orbit].pilots += 1;
    }
    return {
        places: list,
        front,
        gateOrbit: PLANETS.length - 1,
        flying: flying ?? pieces.filter((unit) => !unit.squad).length,
        fallen,
        holdsStation: holdsStation ?? list.some((place) => place.mine),
        timing: { cooldown: jump.cooldown, spool: jump.spool },
        units: pieces,
    };
}

/** The orders of a plan, as [unit key, planet, task, urgent] rows. */
const plan = (situation) => [...planSide(situation).orders].map(([key, order]) => [key, order.planet, order.task, order.urgent]);
const sentTo = (rows, planet) => rows.filter((row) => row[1] === planet);

test('a station of the side being taken calls its units back - but not every one: the stargate keeps its watch', () => {
    const rows = plan(picture({
        front: 2,
        places: { [VEIL]: { mine: true, beingTaken: true, enemy: 1 }, [GATE]: { mine: true }, [COLOSSUS]: { enemy: null } },
        units: [{ at: GATE }, { at: GATE }, { at: GATE }, { at: GATE }],
    }));

    const defenders = sentTo(rows, VEIL);
    assert.ok(defenders.length >= 2, `${defenders.length} go back to the station being taken`);
    assert.ok(defenders.every(([, , task, urgent]) => task === TASK.DOCK_ALARM && urgent), 'at once');
    assert.ok(sentTo(rows, GATE).length >= 1, 'and the stargate\'s station is not left bare');
});

test('jobs are shared out, not piled into one place', () => {
    const rows = plan(picture({
        front: 1,
        places: { [RUST]: { mine: true }, [HAVEN]: { enemy: 1 }, [VEIL]: { enemy: 1 } },
        units: [{ at: RUST }, { at: RUST }, { at: RUST }, { at: RUST }, { at: RUST }],
    }));

    assert.equal(sentTo(rows, RUST).length, 1, 'one keeps watch at home');
    assert.ok(sentTo(rows, HAVEN).length >= 2 && sentTo(rows, VEIL).length >= 2, `both stations to take get enough: ${rows.map((row) => row[1])}`);
});

test('after taking a station a unit on its own moves on; a side with more keeps one on watch', () => {
    const alone = plan(picture({ front: 1, places: { [HAVEN]: { mine: true }, [VEIL]: { enemy: null } }, units: [{ at: HAVEN }] }));
    assert.deepEqual(alone, [['bot:1', VEIL, TASK.TAKE, false]], 'on to the next, once it is not in a fight');

    const pair = plan(picture({ front: 1, places: { [HAVEN]: { mine: true }, [VEIL]: { enemy: null } }, units: [{ at: HAVEN }, { at: HAVEN }] }));
    assert.deepEqual(pair.map((row) => row.slice(1, 3)).sort(), [[HAVEN, TASK.GUARD], [VEIL, TASK.TAKE]]);
});

test('outer stations wait until the collapse comes nearer; what the side holds is watched wherever it is', () => {
    const tasks = listTasks(picture({ front: 0, places: { [GATE]: { mine: true } }, units: [{ at: EMBER }, { at: EMBER }] }));
    const taken = tasks.filter((task) => task.task === TASK.TAKE).map((task) => task.planet);
    assert.deepEqual(taken, PLANETS.slice(0, TUNING.maxAhead + 1));
    assert.ok(tasks.some((task) => task.planet === GATE && task.task === TASK.GUARD));
});

test('nobody is sent through a planet that falls in before the drive has charged again - unless an overdrive chip jumps it', () => {
    const scene = (reach) => picture({
        places: { [HAVEN]: { safeFor: 40 }, [VEIL]: { mine: true, beingTaken: true, enemy: 1 }, [RUST]: { mine: true } },
        units: [{ at: RUST, reach }],
    });
    assert.notEqual(plan(scene(1))[0]?.[1], VEIL, 'stopping at the haven on the way would mean being there when it falls in');
    assert.deepEqual(plan(scene(2)), [['bot:1', VEIL, TASK.DOCK_ALARM, true]]);
});

test('a station of the side\'s own is no shelter on the way: nobody waits out the drive\'s charge where the collapse will catch them', () => {
    const scene = picture({
        places: { [HAVEN]: { mine: true, safeFor: 40 }, [VEIL]: { mine: true, beingTaken: true, enemy: 1 }, [RUST]: { mine: true } },
        units: [{ at: RUST }],
    });
    assert.equal(route(scene.units[0], { orbit: 3, task: TASK.DOCK_ALARM }, scene), null);
    assert.notEqual(plan(scene)[0]?.[1], VEIL);
});

test('nothing is done at a station of the side\'s own once its planet is about to fall in - it is not even watched', () => {
    const tasks = listTasks(picture({
        places: { [EMBER]: { mine: true, safeFor: 0 }, [RUST]: { mine: true, safeFor: TUNING.routeMargin - 1, enemy: 1 }, [HAVEN]: { mine: true, beingTaken: true, enemy: 1 } },
        units: [{ at: HAVEN }, { at: HAVEN }],
    }));
    assert.deepEqual(tasks.filter((task) => task.planet === EMBER || task.planet === RUST), []);
    assert.ok(tasks.some((task) => task.planet === HAVEN && task.task === TASK.DOCK_ALARM), 'a station that will stand still is defended');
});

test('a station taken to bring the fallen back must stand long enough for them to get away again', () => {
    const scene = (safeFor) => picture({ fallen: 2, holdsStation: false, places: { [RUST]: { safeFor, enemy: 0 } }, units: [{ at: EMBER }] });
    assert.ok(listTasks(scene(TUNING.doomSeconds + 60)).some((task) => task.planet === RUST && task.task === TASK.REVIVE));
    assert.ok(!listTasks(scene(TUNING.doomSeconds - 1)).some((task) => task.planet === RUST && task.task === TASK.REVIVE), 'not one that falls in soon');
    const late = scene(TUNING.doomSeconds + 1);
    assert.equal(route(late.units[0], { orbit: 1, task: TASK.REVIVE }, late), null, 'nor one the unit would reach too late to be worth it');
});

test('a jump\'s time is the drive\'s charge, the spool, and a full charge at every stop', () => {
    const situation = picture({ units: [{ at: EMBER, readyIn: 20 }] });
    assert.deepEqual(route(situation.units[0], { orbit: 2, task: TASK.TAKE }, situation), { hops: 2, eta: 20 + jump.spool + jump.cooldown + jump.spool });
    assert.equal(stepToward(1, 4), 2);
    assert.equal(stepToward(4, 1, 2), 2);
    assert.equal(stepToward(3, 3, 2), 3);
});

test('a side does not go looking for a fight it cannot win', () => {
    const rows = plan(picture({
        front: 1,
        places: { [RUST]: { mine: true }, [HAVEN]: { enemy: 6 }, [VEIL]: { enemy: 1 } },
        units: [{ at: RUST }, { at: RUST }],
    }));
    assert.deepEqual(sentTo(rows, HAVEN), [], 'six against two is not a fight to look for');
    assert.equal(sentTo(rows, VEIL).length, 1);
});

test('a unit caught where its side cannot win gets out at once', () => {
    const rows = plan(picture({
        front: 1,
        places: { [RUST]: { mine: true }, [HAVEN]: { enemy: 5, underFire: true } },
        units: [{ at: HAVEN }, { at: RUST }],
    }));
    const [caught] = rows.filter((row) => row[0] === 'bot:1');
    assert.notEqual(caught[1], HAVEN);
    assert.equal(caught[3], true, 'mid-fight or not');
});

test('a comrade outnumbered and under fire is helped', () => {
    const rows = plan(picture({
        front: 1,
        places: { [HAVEN]: { enemy: 3, friends: 1, pilots: 1, underFire: true }, [VEIL]: { mine: true } },
        units: [{ at: VEIL }, { at: VEIL }, { at: VEIL }],
    }));
    const helpers = sentTo(rows, HAVEN);
    assert.ok(helpers.length >= 2, `${helpers.length} go to help`);
    assert.ok(helpers.every(([, , task, urgent]) => task === TASK.RESCUE && urgent));
});

test('a pilot lost at a station of the side\'s is a sign of trouble there, seen or not', () => {
    const tasks = listTasks(picture({ places: { [HAVEN]: { mine: true, losses: 1 } }, units: [{ at: VEIL }] }));
    assert.deepEqual(tasks.filter((task) => task.planet === HAVEN).map((task) => task.task), [TASK.AVENGE]);
});

test('the side\'s last pilot in the air lies low while the others wait to come back', () => {
    const rows = plan(picture({
        front: 1,
        flying: 1,
        fallen: 2,
        places: { [RUST]: { mine: true }, [HAVEN]: { enemy: 2, underFire: true }, [VEIL]: { enemy: null }, [COLOSSUS]: { enemy: null }, [GATE]: { enemy: null } },
        units: [{ at: HAVEN }],
    }));
    assert.deepEqual(rows, [['bot:1', RUST, TASK.HIDE, true]]);
});

test('with no station to come back to, taking one is the only way to bring the fallen back: that is urgent', () => {
    const rows = plan(picture({ front: 2, fallen: 2, places: { [COLOSSUS]: { enemy: null } }, units: [{ at: VEIL }] }));
    const [[, planet, task, urgent]] = rows;
    assert.equal(task, TASK.REVIVE);
    assert.equal(urgent, true);
    assert.ok([VEIL, COLOSSUS].includes(planet), planet);
});

test('reinforcements keep the watch, so the pilots are free to take stations', () => {
    const rows = plan(picture({
        front: 1,
        places: { [RUST]: { mine: true }, [HAVEN]: { enemy: null } },
        units: [{ at: RUST }, { at: RUST, squad: true, strength: 1.2 }],
    }));
    assert.deepEqual(rows.map((row) => row.slice(0, 3)).sort(), [['bot:1', HAVEN, TASK.TAKE], ['squad:2', RUST, TASK.GUARD]]);
});

test('a unit keeps the job it was given while nothing much better comes up: it does not dither', () => {
    const scene = (current) => picture({ front: 1, places: { [HAVEN]: { mine: true }, [RUST]: { enemy: null }, [VEIL]: { enemy: null } }, units: [{ at: HAVEN, current }] });
    assert.equal(plan(scene(null))[0][1], VEIL, 'the outer one is worth a little more');
    assert.equal(plan(scene(RUST))[0][1], RUST, 'but not enough to turn round for');
});

test('a unit that is jumping, docked or just called in stays bound to where it is going', () => {
    const rows = plan(picture({
        front: 1,
        places: { [VEIL]: { mine: true, beingTaken: true, enemy: 1 } },
        units: [{ at: RUST, fixed: HAVEN }, { at: RUST, fixed: RUST }],
    }));
    assert.deepEqual(rows.map((row) => row.slice(0, 2)), [['bot:1', HAVEN], ['bot:2', RUST]]);
});

test('a pilot of the side who is down comes back at the station nearest what it most needs doing', () => {
    const council = new WarCouncil(null, 'dawn');
    const stations = [{ orbit: 5 }, { orbit: 1 }, { orbit: 3 }];
    assert.equal(council.respawnPick(stations), stations[0], 'nothing pressing: the first one offered');
    council.tasks = [{ orbit: 2, task: TASK.DOCK_ALARM, priority: 100 }, { orbit: 5, task: TASK.TAKE, priority: 60 }];
    assert.equal(council.respawnPick(stations), stations[1]);
});
