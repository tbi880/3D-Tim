import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommsQueue, estimateReadingTime } from '../../src/game/state/CommsQueue.js';
import { BeatRunner } from '../../src/game/story/BeatRunner.js';
import { StoryDirector } from '../../src/game/story/StoryDirector.js';
import { background, checkpoint, everyFrame, repeatWhile, run, stopBackground, wait, waitUntil } from '../../src/game/story/beats.js';
import { CAMPAIGN } from '../../src/game/story/campaign.js';

/**
 * The machinery the campaign runs on (story/BeatRunner.js, story/StoryDirector.js, the timing
 * beats in story/beats.js, state/CommsQueue.js), tried with small scripts of its own.
 */

/** A beat that writes what happens to it into `log`; finishes after `frames` ticks (0: at once). */
function logged(log, name, frames = 0) {
    return {
        type: 'test',
        begin(ctx, state) { log.push(`${name}:begin`); state.ticks = 0; },
        tick: frames === 0 ? undefined : (ctx, dt, state) => {
            state.ticks += 1;
            log.push(`${name}:tick${state.ticks}`);
            return state.ticks >= frames;
        },
    };
}

/** A director over `beats` with a stage that only records the checkpoints saved. */
function directorOf(beats) {
    const saved = [];
    const director = new StoryDirector({ world: { findByTag: () => null }, stage: { saveCheckpoint: (id) => saved.push(id) }, beats });
    return { director, saved };
}

test('beats run one after another; each begins once and ticks until it says it is done', () => {
    const log = [];
    const runner = new BeatRunner([logged(log, 'a', 2), logged(log, 'b'), logged(log, 'c', 1)]);
    assert.equal(runner.update({}, 0.1), false);
    assert.deepEqual(log, ['a:begin', 'a:tick1']);
    // A beat without tick finishes at once, so the next one starts in the same frame.
    assert.equal(runner.update({}, 0.1), true);
    assert.deepEqual(log, ['a:begin', 'a:tick1', 'a:tick2', 'b:begin', 'c:begin', 'c:tick1']);
    assert.ok(runner.finished);
});

test('every run of a beat gets fresh state, because the beat itself is shared script data', () => {
    // Finishes on its second tick, counting in its state (no begin to reset it).
    const twoTicks = { type: 'test', tick(ctx, dt, state) { state.ticks = (state.ticks ?? 0) + 1; return state.ticks === 2; } };
    const runner = new BeatRunner([twoTicks, twoTicks]);
    assert.equal(runner.update({}, 0.1), false);
    assert.equal(runner.update({}, 0.1), false, 'the first run ended and the second began counting from zero');
    assert.equal(runner.update({}, 0.1), true);
});

test('a script that never waits cannot freeze a frame', () => {
    const log = [];
    const beats = Array.from({ length: 200 }, (_, i) => logged(log, `b${i}`));
    const runner = new BeatRunner(beats);
    runner.update({}, 0.1);
    assert.equal(log.length, 64, 'at most 64 beats start in one frame');
    runner.update({}, 0.1);
    assert.equal(log.length, 128, 'and the rest go on in the next ones');
});

test('waitUntil ends when its condition holds or its timeout runs out', () => {
    const ctx = { ready: false };
    const runner = new BeatRunner([waitUntil((c) => c.ready, { timeout: 1 })]);
    assert.equal(runner.update(ctx, 0.4), false);
    ctx.ready = true;
    assert.equal(runner.update(ctx, 0.01), true);
    const timed = new BeatRunner([waitUntil(() => false, { timeout: 1 })]);
    assert.equal(timed.update(ctx, 0.6), false);
    assert.equal(timed.update(ctx, 0.6), true, 'gave up after a second');
});

test('repeatWhile plays its beats again for as long as its condition holds', () => {
    const ctx = { rounds: 0 };
    const runner = new BeatRunner([repeatWhile((c) => c.rounds < 3, [run((c) => { c.rounds += 1; }), wait(0.1)])]);
    let frames = 0;
    while (!runner.update(ctx, 0.1) && frames < 100) frames++;
    assert.equal(ctx.rounds, 3);
});

test('background sequences run alongside the story until they end or are stopped', () => {
    const counts = { ticker: 0 };
    const { director } = directorOf([
        background('ticker', [everyFrame(() => { counts.ticker += 1; })]),
        background('short', [wait(0.25)]),
        wait(0.5),
        stopBackground('ticker'),
        wait(0.5),
    ]);
    director.startFromBeginning();
    director.update(0.1);
    assert.deepEqual([...director.backgrounds.keys()], ['ticker', 'short']);
    for (let i = 0; i < 4; i++) director.update(0.1);
    assert.ok(!director.backgrounds.has('short'), 'a finished background is dropped');
    let frames = 5;
    while (director.backgrounds.has('ticker') && frames < 50) {
        director.update(0.1);
        frames++;
    }
    assert.ok(frames >= 5 && frames <= 7, `stopped after the half-second wait (${frames} frames)`);
    assert.equal(counts.ticker, frames - 1, 'it ticked every frame until the one it was stopped in');
    for (let i = 0; i < 10; i++) director.update(0.1);
    assert.equal(counts.ticker, frames - 1, 'and never again');
    assert.ok(director.finished);
});

test('loading a checkpoint resumes on the beat after it, with its variables and scene', () => {
    const log = [];
    const beats = [logged(log, 'intro'), checkpoint('one'), logged(log, 'middle'), checkpoint('two'), logged(log, 'end')];
    const { director, saved } = directorOf(beats);
    director.vars.leftOver = true;
    director.backgrounds.set('stale', new BeatRunner([wait(10)]));
    assert.equal(director.startFromCheckpoint('one', { charge: 0.5 }, { objectiveKey: 'objective.x' }), true);
    assert.deepEqual(director.vars, { charge: 0.5 }, 'nothing from before the load survives');
    assert.equal(director.scene.objectiveKey, 'objective.x');
    assert.equal(director.backgrounds.size, 0);
    assert.equal(director.resumed, true, 'a replay, until the next checkpoint');
    director.update(0.1);
    assert.deepEqual(log, ['middle:begin', 'end:begin']);
    assert.deepEqual(saved, ['two']);
    assert.equal(director.resumed, false);
    assert.equal(director.context.vars, director.vars, 'the beats see the same variables object');
});

test('a save from a checkpoint the script no longer has is refused', () => {
    const { director } = directorOf([checkpoint('one')]);
    assert.equal(director.startFromCheckpoint('gone', {}, {}), false);
    assert.deepEqual(director.listCheckpoints(), ['one']);
});

test('every checkpoint in the campaign has its own id', () => {
    const ids = CAMPAIGN.filter((beat) => beat.type === 'checkpoint').map((beat) => beat.id);
    assert.ok(ids.length > 10);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'a repeated id would always load the first one');
});

test('the mission HUD reports only what the script has put up', () => {
    const ships = { dawnbreaker: { id: 1 } };
    const director = new StoryDirector({ world: { findByTag: (tag) => ships[tag] ?? null }, stage: {}, beats: [] });
    assert.deepEqual(director.missionHud(), { escort: null, boss: null, progress: null, objective: null });
    director.scene.escortTag = 'dawnbreaker';
    director.scene.objectiveKey = 'objective.protect';
    director.objectiveParams = (ctx) => ({ remaining: ctx.vars.left });
    director.vars.left = 3;
    director.progress = { labelKey: 'hud.coreCharge', getValue: () => 0.25 };
    assert.deepEqual(director.missionHud(), {
        escort: ships.dawnbreaker,
        boss: null,
        progress: { labelKey: 'hud.coreCharge', value: 0.25 },
        objective: { key: 'objective.protect', params: { remaining: 3 } },
    });
});

test('comms lines play one at a time, each for as long as it takes to read', () => {
    const shown = [];
    const comms = new CommsQueue({ getDuration: () => 1, onChange: (line) => shown.push(line?.textKey ?? null) });
    const first = comms.enqueue('vega', 'line.one');
    const second = comms.enqueue('tim', 'line.two');
    comms.update(0.5);
    assert.deepEqual(shown, ['line.one']);
    comms.update(0.6);
    assert.ok(first.finished);
    assert.equal(second.finished, false);
    comms.update(0.1);
    assert.deepEqual(shown, ['line.one', 'line.two'], 'no blank between two queued lines');
    comms.skip();
    assert.ok(second.finished);
    assert.deepEqual(shown, ['line.one', 'line.two', null], 'cleared once the queue is empty');
});

test('clearing the comms finishes every line, so nothing waits on one forever', () => {
    const comms = new CommsQueue({ getDuration: () => 5, onChange: () => {} });
    const lines = [comms.enqueue('vega', 'a'), comms.enqueue('vega', 'b')];
    comms.update(0.1);
    comms.clear();
    assert.ok(lines.every((line) => line.finished));
    assert.equal(comms.current, null);
});

test('Chinese text is given more time per character than English', () => {
    assert.ok(estimateReadingTime('') > 2, 'even an empty line stays up a moment');
    assert.ok(estimateReadingTime('一二三四五六七八九十') > estimateReadingTime('abcdefghij'));
    assert.ok(Math.abs(estimateReadingTime('abc') - estimateReadingTime('xyz')) < 1e-12);
});
