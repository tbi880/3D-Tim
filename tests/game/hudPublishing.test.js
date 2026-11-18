import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { GameSession } from '../../src/game/state/GameSession.js';
import { sameValue } from '../../src/game/state/sameValue.js';

/**
 * What the session puts in the UI store for the HUD (GameSession.showOnHud): ten times a
 * second, but a slice whose content has not changed keeps its old object, so the panel that
 * shows it is not redrawn for nothing.
 */

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

const IDLE = Object.freeze({ yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false });

/** A session whose store records every write, slice by slice; `refresh()` is one HUD refresh. */
function createSession() {
    const store = {};
    const writes = [];
    const session = new GameSession({
        ui: {
            set: (partial) => {
                writes.push(partial);
                Object.assign(store, partial);
            },
        },
        settings: { locale: 'en', difficulty: 'captain', playerShip: 'kestrel', muted: true, invertY: false, tutorial: false },
    });
    session.newGame();
    // Refreshed by hand, with the story and the world standing still, so nothing changes unless a test changes it.
    const refresh = () => session.publishHud(1);
    const writesOf = (key) => writes.filter((partial) => key in partial).length;
    return { session, store, refresh, writesOf };
}

test('sameValue compares HUD values by content', () => {
    assert.ok(sameValue(1, 1));
    assert.ok(!sameValue(1, 2));
    assert.ok(sameValue(null, null));
    assert.ok(!sameValue(null, undefined));
    assert.ok(!sameValue(0, null));
    assert.ok(sameValue('a', 'a'));
    assert.ok(sameValue({ key: 'x', params: { remaining: 3 } }, { params: { remaining: 3 }, key: 'x' }), 'key order does not matter');
    assert.ok(!sameValue({ key: 'x', params: { remaining: 3 } }, { key: 'x', params: { remaining: 2 } }));
    assert.ok(!sameValue({ key: 'x' }, { key: 'x', extra: undefined }), 'a missing field is not an undefined one');
    assert.ok(!sameValue({ a: 1 }, null));
    assert.ok(sameValue([1, { b: 2 }], [1, { b: 2 }]));
    assert.ok(!sameValue([1, 2], [1, 2, 3]));
    assert.ok(!sameValue([1], { 0: 1 }), 'an array is not a record');
    // Live objects are only ever the same as themselves.
    const vector = new Vector3(1, 2, 3);
    assert.ok(sameValue(vector, vector));
    assert.ok(!sameValue(vector, new Vector3(1, 2, 3)));
});

test('an objective that has not changed keeps its object from one HUD refresh to the next', () => {
    const { session, store, refresh, writesOf } = createSession();
    session.director.scene.objectiveKey = 'objective.helmCheck';
    refresh();
    const first = store.objective;
    assert.equal(first.key, 'objective.helmCheck');
    const before = writesOf('objective');
    for (let i = 0; i < 5; i++) refresh();
    assert.equal(store.objective, first, 'the same object, so the panel is not redrawn');
    assert.equal(writesOf('objective'), before, 'and nothing was written for it');
    // A new objective is a new object.
    session.director.scene.objectiveKey = 'objective.destroyDrones';
    refresh();
    assert.notEqual(store.objective, first);
    assert.equal(store.objective.key, 'objective.destroyDrones');
});

test('what changes is published, what does not keeps its object', () => {
    const { session, store, refresh } = createSession();
    refresh();
    const hud = store.hud;
    assert.ok(hud, 'the ship panel is published');
    refresh();
    assert.equal(store.hud, hud, 'nothing changed: the same object');
    session.world.player.hull *= 0.5;
    refresh();
    assert.notEqual(store.hud, hud, 'the hull changed: a new object');
    assert.ok(Math.abs(store.hud.hull - 0.5) < 1e-9);
});

test('a slice cleared by a reset is published again when it comes back with the same content', () => {
    const { session, store } = createSession();
    session.setObjective('objective.helmCheck');
    assert.equal(store.objective.key, 'objective.helmCheck');
    session.resetPresentation();
    assert.equal(store.objective, null);
    session.setObjective('objective.helmCheck');
    assert.equal(store.objective?.key, 'objective.helmCheck', 'not swallowed as "unchanged"');
});

test('a locked target that holds still keeps its panel object, and one that is hit gets a new one', () => {
    const { session, store, refresh } = createSession();
    const player = session.world.player;
    const harrier = session.world.spawnShip('harrier', { position: player.position.clone().add(new Vector3(0, 0, -2000)) });
    session.world.setPlayerTarget(harrier);
    refresh();
    const target = store.target;
    assert.equal(target?.id, harrier.id);
    refresh();
    assert.equal(store.target, target);
    harrier.shield /= 2;
    refresh();
    assert.notEqual(store.target, target);
    assert.equal(store.target.shield, 0.5);
});

test('the HUD reads the player\'s own ship while it flies; with it lost, the ship being watched', () => {
    const { session, store, refresh } = createSession();
    const { world } = session;
    const own = world.player;
    const comrade = world.spawnShip('kestrel', { position: [0, 0, 400], pilotId: 'bo', local: false });
    comrade.energy = 20;
    refresh();
    assert.equal(world.hudShip, own);
    assert.equal(store.hud.watching, null);

    // Watching while the own ship still flies changes nothing.
    world.spectating = comrade;
    assert.equal(world.hudShip, own);

    own.alive = false;
    assert.equal(world.hudShip, comrade);
    refresh();
    assert.equal(store.hud.watching, 'bo');
    assert.equal(store.hud.alive, true);
    assert.ok(Math.abs(store.hud.energy - 0.2) < 1e-9);

    // The one watched is lost too: back to the player's own, lost, ship.
    comrade.alive = false;
    assert.equal(world.hudShip, own);
    world.spectating = null;
    assert.equal(world.hudShip, own);
});
