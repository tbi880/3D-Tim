import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { FINAL_SCORE, computeFinalScore, killPoints } from '../../src/game/config/scoring.js';
import { DEFAULT_DIFFICULTY, STORAGE_KEYS } from '../../src/game/config/gameConfig.js';
import { DEFAULT_PLAYER_SHIP } from '../../src/game/config/playerShips.js';
import { DEFAULT_GRAPHICS } from '../../src/game/config/graphics.js';
import {
    clearSave, defaultSettings, loadBestScores, loadSave, loadSettings, recordFinalScore, saveSettings, writeSave,
} from '../../src/game/state/saveGame.js';

/**
 * What the game keeps in the browser (state/saveGame.js) and the score on the ending screen
 * (config/scoring.js). A save or settings entry from another build, or one that was tampered
 * with, must never break a start-up.
 */

const storage = new Map();
const localStorageStub = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};
globalThis.localStorage = localStorageStub;

beforeEach(() => {
    storage.clear();
    globalThis.localStorage = localStorageStub;
});

const SAVE = Object.freeze({ checkpointId: 'veil-cleared', world: { ships: [] }, vars: { coreCharge: 0.5 } });

test('a checkpoint save reads back as it was written', () => {
    assert.equal(loadSave(), null, 'no save yet');
    assert.equal(writeSave(SAVE), true);
    const save = loadSave();
    assert.equal(save.checkpointId, 'veil-cleared');
    assert.deepEqual(save.vars, { coreCharge: 0.5 });
    assert.equal(typeof save.savedAt, 'number');
    clearSave();
    assert.equal(loadSave(), null);
});

test('a save from another format, half a save or a broken one is no save at all', () => {
    const withVersion = (version) => JSON.stringify({ ...SAVE, version });
    for (const raw of [withVersion(0), withVersion(2), JSON.stringify({ version: 1, world: {} }), JSON.stringify({ version: 1, checkpointId: 'x' }), '{not json', 'null']) {
        storage.set(STORAGE_KEYS.save, raw);
        assert.equal(loadSave(), null, raw);
    }
});

test('without storage (private mode, a blocked site) nothing throws and nothing is kept', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
        assert.doesNotThrow(() => writeSave(SAVE));
        assert.equal(loadSave(), null);
        assert.doesNotThrow(() => clearSave());
        assert.deepEqual(loadBestScores(), {});
        assert.doesNotThrow(() => saveSettings({ locale: 'zh' }));
        assert.equal(loadSettings().difficulty, DEFAULT_DIFFICULTY);
    } finally {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: localStorageStub });
    }
});

test('settings that make no sense are put back to their defaults', () => {
    saveSettings({ locale: 'fr', difficulty: 'godlike', playerShip: 'battlestar', cameraMode: 'drone', graphics: 'ultra', tutorial: 0, muted: true, autoFire: true });
    const settings = loadSettings();
    assert.equal(settings.locale, 'en');
    assert.equal(settings.difficulty, DEFAULT_DIFFICULTY);
    assert.equal(settings.playerShip, DEFAULT_PLAYER_SHIP);
    assert.equal(settings.cameraMode, 'cockpit');
    assert.equal(settings.graphics, DEFAULT_GRAPHICS);
    assert.equal(settings.tutorial, false);
    assert.equal(settings.muted, true, 'a sensible value is kept');
    assert.ok(!('autoFire' in settings), 'the old auto-fire setting is dropped');
});

test('settings saved by an older build get the newer settings at their defaults', () => {
    saveSettings({ locale: 'zh', difficulty: 'admiral' });
    const settings = loadSettings();
    assert.equal(settings.locale, 'zh');
    assert.equal(settings.difficulty, 'admiral');
    for (const key of Object.keys(defaultSettings())) assert.ok(key in settings, key);
    assert.equal(settings.tutorial, true, 'a pilot who never saw the tutorial setting gets the tutorial');
});

test('only a better score on the same difficulty is a new record', () => {
    const result = (total, difficultyId = 'captain') => ({ total, rank: 'B', difficultyId });
    assert.deepEqual(recordFinalScore(result(20000), 'kestrel'), { isRecord: true, previous: null });
    assert.equal(recordFinalScore(result(15000), 'swift').isRecord, false);
    assert.equal(recordFinalScore(result(20000), 'swift').isRecord, false, 'a tie is not a record');
    const better = recordFinalScore(result(25000), 'shrike');
    assert.equal(better.isRecord, true);
    assert.equal(better.previous.total, 20000);
    assert.equal(recordFinalScore(result(1000, 'admiral'), 'kestrel').isRecord, true, 'each difficulty has its own record');
    const best = loadBestScores();
    assert.equal(best.captain.total, 25000);
    assert.equal(best.captain.shipId, 'shrike');
    assert.equal(best.admiral.total, 1000);
});

test('the final score: combat, the mission and time bonuses, losses, then the difficulty', () => {
    const stats = { time: FINAL_SCORE.parSeconds - 100, kills: 40, losses: 2, score: 12345.4 };
    const captain = computeFinalScore(stats, 'captain');
    assert.equal(captain.combat, 12345);
    assert.equal(captain.timeBonus, 100 * FINAL_SCORE.timeBonusPerSecond);
    assert.equal(captain.lossPenalty, 2 * FINAL_SCORE.lossPenalty);
    assert.equal(captain.total, 12345 + FINAL_SCORE.missionBonus + 500 - 2000);
    const admiral = computeFinalScore(stats, 'admiral');
    assert.equal(admiral.total, Math.round(captain.total * FINAL_SCORE.difficultyMultiplier.admiral));
    assert.equal(computeFinalScore(stats, 'unknown').multiplier, 1);
});

test('a slow run gets no time bonus and a disastrous one never scores below zero', () => {
    assert.equal(computeFinalScore({ time: FINAL_SCORE.parSeconds * 2, losses: 0, score: 0 }, 'captain').timeBonus, 0);
    const wrecked = computeFinalScore({ time: FINAL_SCORE.parSeconds * 2, losses: 100, score: 0 }, 'captain');
    assert.equal(wrecked.total, 0);
    assert.equal(wrecked.rank, 'C');
    assert.equal(computeFinalScore({ time: 0 }, 'captain').combat, 0, 'missing numbers count as nothing');
});

test('each rank starts at its threshold', () => {
    const base = FINAL_SCORE.missionBonus;
    for (const [rank, minimum] of FINAL_SCORE.ranks) {
        if (minimum < base) continue;
        const stats = { time: FINAL_SCORE.parSeconds, losses: 0, score: minimum - base };
        assert.equal(computeFinalScore(stats, 'captain').rank, rank, `${minimum}`);
        if (minimum > base) assert.notEqual(computeFinalScore({ ...stats, score: stats.score - 1 }, 'captain').rank, rank);
    }
});

test('only Umbra ships listed in the table score', () => {
    assert.equal(killPoints({ classId: 'drone' }), 100);
    assert.equal(killPoints({ classId: 'eclipse' }), 5000);
    assert.equal(killPoints({ classId: 'wreck' }), 0);
});
