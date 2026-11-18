import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Color, Vector3 } from 'three';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { createRng } from '../../src/game/core/math.js';
import { GAME_EVENTS } from '../../src/game/core/EventBus.js';
import { World } from '../../src/game/core/World.js';
import { applyDamage } from '../../src/game/core/systems/damage.js';
import { isHullHitOnPlayer, underHeavyBeam } from '../../src/game/scene/effects/playerFeedback.js';
import { MAX_SHARDS, ShieldImpacts } from '../../src/game/scene/effects/ShieldImpacts.js';
import { ambientLight } from '../../src/game/scene/cabinLighting.js';

/**
 * What the presentation is told about a hit, and the parts of the hit effects that are plain
 * logic: which hits make the cabin spark, which beams make the ship tremble, how a shot
 * breaks up on a shield, and the cabin lights' stutter.
 */

function worldWithPlayerAnd(classId) {
    const world = new World();
    const player = world.spawnShip('kestrel', { position: [0, 0, 0] });
    world.player = player;
    const other = world.spawnShip(classId, { position: [0, 0, -500] });
    return { world, player, other };
}

test('a hit says who fired and with what', () => {
    const { world, player, other } = worldWithPlayerAnd('raider');
    const hits = [];
    world.events.on(GAME_EVENTS.HIT, (hit) => hits.push(hit));
    applyDamage(world, player, 5, { source: other, weapon: WEAPONS.raiderBolt, point: new Vector3(0, 0, -10) });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, other);
    assert.equal(hits[0].weapon, WEAPONS.raiderBolt);
    assert.equal(hits[0].shield, true);
});

test('only damage to the bare hull of the ship flown here counts as a hull hit', () => {
    const { world, player, other } = worldWithPlayerAnd('raider');
    assert.equal(isHullHitOnPlayer(world, { target: player, shield: false, amount: 4 }), true);
    assert.equal(isHullHitOnPlayer(world, { target: player, shield: true, amount: 4 }), false, 'the shield took it');
    assert.equal(isHullHitOnPlayer(world, { target: player, shield: false, amount: 0 }), false, 'no damage');
    assert.equal(isHullHitOnPlayer(world, { target: other, shield: false, amount: 4 }), false, 'someone else');
    assert.equal(isHullHitOnPlayer(world, { target: null, shield: false, amount: 4 }), false, 'an asteroid');
});

test('a sustained beam from a larger ship is felt; a fighter\'s or one aimed elsewhere is not', () => {
    const { world, player, other: cruiser } = worldWithPlayerAnd('warden');
    const fighter = world.spawnShip('dart', { position: [50, 0, 0] });
    const beam = (from, to, kind = 'beam') => { world.beams.length = 0; world.addBeam(from.position, to.position, '#ffffff', 2, kind, from, to); };
    assert.equal(underHeavyBeam(world, player), false, 'no beams at all');
    beam(cruiser, player);
    assert.equal(underHeavyBeam(world, player), true);
    beam(fighter, player);
    assert.equal(underHeavyBeam(world, player), false, 'a fighter is too small');
    beam(cruiser, fighter);
    assert.equal(underHeavyBeam(world, player), false, 'aimed at someone else');
    beam(cruiser, player, 'tractor');
    assert.equal(underHeavyBeam(world, player), false, 'a tractor beam does no harm');
});

test('a shot breaking on a shield leaves a burst and shards that stay with the ship and die away', () => {
    const impacts = new ShieldImpacts();
    const ship = { position: new Vector3(100, 0, 0) };
    const drawn = { flares: [], bolts: [] };
    const ribbons = {
        flare: (position, color, brightness, radius) => drawn.flares.push({ position: position.clone(), brightness, radius }),
        bolt: (tail, head, color, brightness) => drawn.bolts.push({ head: head.clone(), brightness }),
    };
    impacts.strike(ship, new Vector3(100, 0, -20), new Vector3(0, 0, 1), new Color('#ff0000'), new Color('#00aaff'), { size: 5, shards: 9, speed: 80 });
    impacts.update(1 / 60);
    impacts.draw(ribbons);
    assert.equal(drawn.flares.length, 1);
    assert.ok(drawn.bolts.length >= 8 && drawn.bolts.length <= 9);
    // The shards slide away over the shield: none of them deeper into it than where the shot landed.
    for (const { head } of drawn.bolts) assert.ok(head.z <= -20 + 1e-6, `shard at z = ${head.z}`);

    // The ship moves on; the effect goes with it.
    ship.position.set(400, 0, 0);
    drawn.flares.length = 0;
    impacts.draw(ribbons);
    assert.ok(Math.abs(drawn.flares[0].position.x - 400) < 1e-6);

    // And it is gone within a second.
    for (let frame = 0; frame < 60; frame++) impacts.update(1 / 60);
    drawn.flares.length = 0;
    drawn.bolts.length = 0;
    impacts.draw(ribbons);
    assert.deepEqual([drawn.flares.length, drawn.bolts.length], [0, 0]);
});

test('more shots than there are shards reuse the oldest instead of overflowing', () => {
    const impacts = new ShieldImpacts();
    const ship = { position: new Vector3() };
    for (let i = 0; i < 60; i++) {
        impacts.strike(ship, new Vector3(0, 0, -20), new Vector3(0, 0, 1), new Color(1, 0, 0), new Color(0, 0, 1), { size: 5, shards: 9, speed: 80 });
    }
    let drawn = 0;
    impacts.draw({ flare() {}, bolt() { drawn += 1; } });
    assert.ok(drawn <= MAX_SHARDS);
});

test('the cabin lights stutter after a knock and settle again', (t) => {
    // Which flicker goes dark is chance; a seeded Math.random makes this run the same every time
    // (with the real one about 1 run in 120 had no drop-out deep enough in the first 0.35 s).
    t.mock.method(Math, 'random', createRng(7));
    const hud = { alive: true, hull: 1, powerMode: 'balanced', boosting: false };
    const levels = (seconds) => {
        const seen = [];
        for (let frame = 0; frame < seconds * 60; frame++) {
            ambientLight.update(hud, 1 / 60);
            seen.push(ambientLight.level);
        }
        return seen;
    };
    assert.ok(levels(0.5).every((level) => level === 1), 'steady when nothing has happened');
    ambientLight.disturb(1);
    const knocked = levels(0.35);
    assert.ok(knocked.some((level) => level < 0.6), 'drops out');
    assert.ok(knocked.every((level) => level > 0 && level <= 1));
    assert.ok(levels(1.5).slice(-30).every((level) => level === 1), 'steady again');
});
