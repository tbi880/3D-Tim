import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { PLAYER, STORAGE_KEYS } from '../../src/game/config/gameConfig.js';
import { GameSession } from '../../src/game/state/GameSession.js';
import { CAMPAIGN } from '../../src/game/story/campaign.js';

/**
 * A checkpoint saved by one session and loaded by the next (GameSession.saveCheckpoint,
 * continueGame, retry): the story carries on after the checkpoint, with its variables, its
 * scene and the ships it keeps, and nothing else.
 */

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

beforeEach(() => storage.clear());

function createSession() {
    const store = {};
    const session = new GameSession({
        ui: { set: (partial) => Object.assign(store, partial) },
        settings: { locale: 'en', difficulty: 'captain', playerShip: 'swift', muted: true, invertY: false, tutorial: false },
    });
    return { session, store };
}

const checkpointIndex = (id) => CAMPAIGN.findIndex((beat) => beat.type === 'checkpoint' && beat.id === id);

/** A session in the middle of the story, saved at `checkpointId`. */
function savedAt(checkpointId) {
    const { session, store } = createSession();
    session.newGame();
    const { world, director } = session;
    world.player.hull = world.player.maxHull * 0.9;
    world.spawnShip('harrier', { tags: ['harrier'], callsign: 'Harrier', persistent: true, position: [100, 0, -800] });
    world.spawnShip('drone', { group: 'raid', position: [0, 0, -1500] });
    director.vars.coreCharge = 0.4;
    director.scene.objectiveKey = 'objective.protectDawnbreaker';
    director.scene.escortTag = 'harrier';
    session.stats.kills = 12;
    session.saveCheckpoint(checkpointId);
    return { session, store };
}

test('a checkpoint is announced only once it is saved', () => {
    const { store } = savedAt('veil-cleared');
    assert.equal(store.hasSave, true);
    assert.equal(store.saveCheckpointId, 'veil-cleared');
    assert.equal(store.toast?.key, 'ui.checkpointSaved');
    assert.ok(storage.has(STORAGE_KEYS.save));
});

test('a badly hurt player ship comes back from a checkpoint patched up', () => {
    const { session } = createSession();
    session.newGame();
    session.world.player.hull = session.world.player.maxHull * 0.1;
    session.saveCheckpoint('veil-cleared');
    const { session: next } = createSession();
    next.continueGame();
    assert.ok(Math.abs(next.world.player.hullFraction - PLAYER.checkpointMinHull) < 1e-9);
});

test('continuing picks the story up after the checkpoint, with what the story keeps', () => {
    savedAt('veil-cleared');
    const { session, store } = createSession();
    session.continueGame();
    const { world, director } = session;
    assert.equal(director.main.index, checkpointIndex('veil-cleared') + 1, 'on the beat after the checkpoint');
    assert.equal(director.resumed, true);
    assert.deepEqual(director.vars, { coreCharge: 0.4 });
    assert.equal(director.scene.escortTag, 'harrier');
    assert.equal(store.objective?.key, 'objective.protectDawnbreaker', 'the objective is shown again');
    assert.equal(session.stats.kills, 12);
    // The player's ship, at the hull it had, and the tagged ally; the raid is not saved.
    assert.equal(world.player.classId, 'swift');
    assert.ok(Math.abs(world.player.hullFraction - 0.9) < 1e-9);
    assert.equal(world.findByTag('harrier')?.callsign, 'Harrier');
    assert.equal(world.countGroup('raid'), 0);
    assert.equal(world.ships.filter((ship) => ship.alive).length, 2);
});

test('a retry counts the loss and keeps counting across retries', () => {
    savedAt('veil-cleared');
    const { session } = createSession();
    session.continueGame();
    session.retry();
    assert.equal(session.stats.losses, 1);
    session.retry();
    assert.equal(session.stats.losses, 2);
    // A later session that continues from the save sees the losses too.
    const { session: later } = createSession();
    later.continueGame();
    assert.equal(later.stats.losses, 2);
    assert.equal(later.stats.kills, 12, 'the rest of the stats are the save\'s');
});

test('a save whose checkpoint the story no longer has starts a new game', () => {
    savedAt('veil-cleared');
    const saved = JSON.parse(storage.get(STORAGE_KEYS.save));
    storage.set(STORAGE_KEYS.save, JSON.stringify({ ...saved, checkpointId: 'cut-from-the-story' }));
    const { session, store } = createSession();
    session.continueGame();
    assert.equal(session.director.main.index, 0, 'from the first beat');
    assert.equal(session.stats.kills, 0);
    assert.equal(store.hasSave, false);
    assert.equal(storage.has(STORAGE_KEYS.save), false, 'the stale save is gone');
});

test('continuing with no save at all starts a new game', () => {
    const { session } = createSession();
    session.continueGame();
    assert.equal(session.director.main.index, 0);
    assert.ok(session.world.player);
});
