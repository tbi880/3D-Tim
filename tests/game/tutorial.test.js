import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TUTORIAL_ACTION, TUTORIAL_PLATFORM, tutorialStepsFor } from '../../src/game/config/tutorial.js';
import { destroyShip } from '../../src/game/core/systems/damage.js';
import en from '../../src/game/i18n/en.js';
import zh from '../../src/game/i18n/zh.js';
import { GameSession, PHASE } from '../../src/game/state/GameSession.js';
import { TUTORIAL_STATE } from '../../src/game/state/Tutorial.js';

/**
 * The first-flight tutorial, played headlessly: a session with the tutorial on, flown by a
 * pupil who does what each card asks - and, first, things it does not ask.
 */

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

const STEP = 1 / 30;
const IDLE = Object.freeze({ yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false });

function createSession(settings = {}) {
    const ui = {};
    const session = new GameSession({
        ui: { set: (partial) => Object.assign(ui, partial) },
        settings: { locale: 'en', difficulty: 'captain', playerShip: 'kestrel', muted: true, invertY: false, tutorial: true, ...settings },
    });
    const run = (seconds, controls = IDLE) => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP) {
            // The pupil reads the first line (its card teaches how to skip one), and skips the rest.
            if (!session.settings.tutorial || session.tutorial.seen.has('comms')) session.comms.skip();
            session.update(STEP, { ...IDLE, ...controls });
        }
    };
    /** Flies (comms skipped) until a card is up, and returns its step id. */
    const untilCard = (limit = 60) => {
        for (let elapsed = 0; elapsed < limit; elapsed += STEP) {
            if (ui.tutorial?.state === TUTORIAL_STATE.ASK) return ui.tutorial.id;
            run(STEP);
        }
        return ui.tutorial?.state === TUTORIAL_STATE.ASK ? ui.tutorial.id : null;
    };
    return { session, ui, run, untilCard };
}

/** What a pupil on a desk does to answer each card: held controls, or a one-shot action. */
const ANSWERS = {
    comms: { action: 'skip' },
    objective: { action: TUTORIAL_ACTION.NEXT },
    steer: { controls: { yaw: 1 } },
    throttle: { controls: { throttle: 1 } },
    roll: { controls: { roll: -1 } },
    boost: { controls: { boost: true } },
    view: { action: 'toggleView' },
    radar: { action: TUTORIAL_ACTION.NEXT },
    lock: { action: 'cycleTarget' },
    beams: { controls: { firePrimary: true } },
    status: { action: TUTORIAL_ACTION.NEXT },
    power: { action: 'power:attack' },
    torpedo: { action: 'cycleTarget', controls: { fireSecondary: true } },
    pause: { action: TUTORIAL_ACTION.NEXT },
};

function answer(game, stepId) {
    const { action, controls } = ANSWERS[stepId];
    game.run(0.6);
    if (action) game.session.handleAction(action);
    game.run(0.2, controls);
}

test('a new pilot is stopped at every control in turn, and the game stands still until they use it', () => {
    const game = createSession();
    const { session, ui } = game;
    session.newGame();
    game.run(STEP);
    assert.equal(session.world.player.throttle, 0, 'the engines idle until the throttle lesson');

    let saved = false;
    session.events.on('checkpoint', () => { saved = true; });
    const shown = [];
    for (const expected of tutorialStepsFor(TUTORIAL_PLATFORM.DESKTOP)) {
        const stepId = game.untilCard();
        assert.equal(stepId, expected, `card after ${shown.at(-1) ?? 'the start'}`);
        shown.push(stepId);
        assert.equal(session.tutorial.frozen, true);
        assert.equal(ui.tutorial.index, shown.length);

        // Nothing moves while the card is up, whatever else the pupil presses.
        const { time } = session.world;
        const storyTime = session.stats.time;
        const wrong = stepId === 'beams' ? { boost: true } : { firePrimary: true };
        game.run(2, wrong);
        assert.equal(session.world.time, time, `${stepId}: the world waits`);
        assert.equal(session.stats.time, storyTime, `${stepId}: the story waits`);
        assert.equal(session.effectsDelta, 0);
        assert.equal(ui.tutorial?.id, stepId, `${stepId}: still asked`);

        answer(game, stepId);
        assert.notEqual(ui.tutorial?.state === TUTORIAL_STATE.ASK && ui.tutorial.id, stepId, `${stepId}: answered`);
        assert.ok(session.world.time > time || stepId === 'pause', `${stepId}: the game goes on`);

        // The pupil is no fighter pilot: the wave is cleared for them once its lesson is over.
        if (stepId === 'beams' || stepId === 'torpedo') {
            for (const ship of [...session.world.ships]) if (ship.group === 'scavengers') destroyShip(session.world, ship, session.world.player);
        }
    }

    assert.equal(session.settings.tutorial, false, 'done once, the tutorial switches itself off');
    assert.equal(ui.tutorial, null);
    assert.equal(session.world.player.powerMode, 'attack', 'what the pupil did on a card really happened');
    game.run(5);
    assert.ok(saved, 'the prologue goes on to its checkpoint');
});

test('skipping ends the tutorial at once and for good; switching it on again starts it over', () => {
    const game = createSession();
    const { session, ui } = game;
    session.newGame();
    assert.equal(game.untilCard(), 'comms');
    session.handleAction(TUTORIAL_ACTION.SKIP);
    assert.equal(session.settings.tutorial, false);
    assert.equal(session.tutorial.frozen, false);
    assert.equal(ui.tutorial, null);
    assert.equal(game.untilCard(40), null, 'no more cards');

    session.updateSettings({ tutorial: true });
    session.newGame();
    assert.equal(game.untilCard(), 'comms');
});

test('a pilot shot down in the prologue is not taught the same control twice', () => {
    const game = createSession();
    const { session } = game;
    session.newGame();
    for (const stepId of ['comms', 'objective', 'steer']) {
        assert.equal(game.untilCard(), stepId);
        answer(game, stepId);
    }
    session.newGame();
    assert.equal(game.untilCard(), 'throttle');
});

test('with the tutorial off the prologue never stops', () => {
    const game = createSession({ tutorial: false });
    const { session } = game;
    session.newGame();
    game.run(STEP);
    assert.ok(session.world.player.throttle > 0);
    assert.equal(game.untilCard(40), null);
    assert.equal(session.phase, PHASE.PLAYING);
});

test('a phone is not asked for controls it does not have, a headset is asked for its own', () => {
    assert.deepEqual(
        tutorialStepsFor(TUTORIAL_PLATFORM.TOUCH),
        ['comms', 'objective', 'steer', 'throttle', 'boost', 'radar', 'lock', 'beams', 'status', 'torpedo', 'pause'],
    );
    assert.equal(tutorialStepsFor(TUTORIAL_PLATFORM.VR).length, tutorialStepsFor(TUTORIAL_PLATFORM.DESKTOP).length);

    // In a headset an info card goes on with A (the lock button), and the cards count the headset's steps.
    const game = createSession();
    const { session, ui } = game;
    session.tutorial.setVR(true);
    session.newGame();
    assert.equal(game.untilCard(), 'comms');
    assert.equal(ui.tutorial.platform, TUTORIAL_PLATFORM.VR);
    answer(game, 'comms');
    assert.equal(game.untilCard(), 'objective');
    game.run(0.6);
    session.handleAction('cycleTarget');
    game.run(0.1);
    assert.notEqual(ui.tutorial?.state, TUTORIAL_STATE.ASK, 'A answered the card');
});

test('every card has its words in both languages', () => {
    for (const dictionary of [en, zh]) {
        for (const stepId of tutorialStepsFor(TUTORIAL_PLATFORM.DESKTOP)) {
            assert.ok(dictionary[`tutorial.${stepId}.title`], `tutorial.${stepId}.title`);
            assert.ok(dictionary[`tutorial.${stepId}.text`], `tutorial.${stepId}.text`);
        }
    }
    const tutorialKeys = (dictionary) => Object.keys(dictionary).filter((key) => key.startsWith('tutorial.')).sort();
    assert.deepEqual(tutorialKeys(zh), tutorialKeys(en));
});
