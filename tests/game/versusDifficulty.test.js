import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE } from '../../src/game/config/battleRoyale.js';
import { ALLIES, DIFFICULTY, FACTION, POWER_MODES } from '../../src/game/config/gameConfig.js';
import { applyDamage, isEnemyFleet } from '../../src/game/core/systems/damage.js';
import { World } from '../../src/game/core/World.js';

/**
 * How strong the computer-flown ships of a multiplayer match are (BATTLE_ROYALE.difficulty,
 * a `versus` difficulty): the story's Admiral level, for the fleets of both sides alike, and
 * nothing of it between one player and another.
 */

const STEP = 1 / 60;
const { DAWN, UMBRA, PIRATE } = FACTION;
const VERSUS = BATTLE_ROYALE.difficulty;
const ADMIRAL = DIFFICULTY.admiral;
const idle = () => ({ yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false });

/** A bare world at `difficulty` (a level's id, or a profile as a multiplayer zone is given one). */
function worldAt(difficulty) {
    if (typeof difficulty === 'string') return new World({ seed: 7, difficultyId: difficulty });
    const world = new World({ seed: 7 });
    world.difficulty = difficulty;
    return world;
}

let slot = 0;
/** A ship that sits out of everybody's reach and does nothing; a player's ship is flown by nobody. */
const put = (world, classId, faction, options = {}) => world.spawnShip(classId, {
    position: [0, 0, (slot++) * 20000], facing: [0, 0, 1], aiMode: 'hold', faction, local: false, ...options,
});

/** Shield and hull a hit of 10 from `source` takes off `target`. */
function dealt(world, target, source) {
    const before = target.shield + target.hull;
    applyDamage(world, target, 10, { source });
    return before - target.shield - target.hull;
}

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} is not ${expected}`);

test('a match\'s computer-flown ships fight at the story\'s Admiral level', () => {
    assert.equal(VERSUS.versus, true);
    for (const key of ['damageTaken', 'enemyToughness', 'enemyFireRate', 'enemyBeamDamage']) {
        assert.equal(VERSUS[key], ADMIRAL[key], key);
    }
    assert.equal(VERSUS.shieldRegen, 1, 'players\' shields recharge as usual');
});

test('in a match the fleets of both sides are the enemy fleet; players and scenery never are', () => {
    const world = worldAt(VERSUS);
    assert.equal(isEnemyFleet(world, put(world, 'dart', DAWN)), true);
    assert.equal(isEnemyFleet(world, put(world, 'harrier', DAWN)), true);
    assert.equal(isEnemyFleet(world, put(world, 'raider', UMBRA)), true);
    assert.equal(isEnemyFleet(world, put(world, 'kestrel', UMBRA)), false);
    assert.equal(isEnemyFleet(world, put(world, 'lanternStation', FACTION.NEUTRAL)), false);

    const story = worldAt('admiral');
    assert.equal(isEnemyFleet(story, put(story, 'dart', DAWN)), false, 'in the story only Umbra is');
    assert.equal(isEnemyFleet(story, put(story, 'raider', UMBRA)), true);
});

test('a computer-flown ship of either side hurts a player as much as the story\'s Umbra do on Admiral', () => {
    const world = worldAt(VERSUS);
    const story = worldAt('admiral');
    const fromUmbraInStory = dealt(story, put(story, 'kestrel', DAWN), put(story, 'raider', UMBRA));
    close(fromUmbraInStory, 10 * ADMIRAL.damageTaken, 'the story');

    for (const pilotSide of [DAWN, UMBRA, PIRATE]) {
        for (const [classId, fleet] of [['dart', DAWN], ['harrier', DAWN], ['raider', UMBRA], ['corvette', UMBRA]]) {
            if (fleet === pilotSide) continue;
            const hit = dealt(world, put(world, 'kestrel', pilotSide), put(world, classId, fleet));
            close(hit, fromUmbraInStory, `${classId} on a ${pilotSide} pilot`);
        }
    }
    // The pilot's own power mode still counts, on top.
    const braced = put(world, 'kestrel', DAWN);
    braced.powerMode = 'defense';
    close(dealt(world, braced, put(world, 'raider', UMBRA)), 10 * ADMIRAL.damageTaken * POWER_MODES.defense.damageTaken, 'defense mode');
});

test('what players do to each other is not scaled, nor what nobody fired', () => {
    const world = worldAt(VERSUS);
    close(dealt(world, put(world, 'kestrel', UMBRA), put(world, 'kestrel', DAWN)), 10, 'pilot on pilot');
    close(dealt(world, put(world, 'bulwark', DAWN), put(world, 'shrike', PIRATE)), 10, 'pirate on pilot');
    close(dealt(world, put(world, 'kestrel', DAWN), null), 10, 'a rammed rock');
    const attacking = put(world, 'kestrel', UMBRA);
    attacking.powerMode = 'attack';
    close(dealt(world, attacking, put(world, 'kestrel', DAWN)), 10 * POWER_MODES.attack.damageTaken, 'only the power mode');
});

test('the fleets of both sides are as tough as each other, to players and to one another', () => {
    const world = worldAt(VERSUS);
    const expected = 10 / ADMIRAL.enemyToughness;
    for (const [classId, fleet] of [['dart', DAWN], ['harrier', DAWN], ['raider', UMBRA], ['corvette', UMBRA]]) {
        for (const pilotSide of [DAWN, UMBRA, PIRATE]) {
            close(dealt(world, put(world, classId, fleet), put(world, 'kestrel', pilotSide)), expected, `a ${pilotSide} pilot on a ${classId}`);
        }
    }
    close(dealt(world, put(world, 'raider', UMBRA), put(world, 'dart', DAWN)), expected, 'Dawn on Umbra');
    close(dealt(world, put(world, 'dart', DAWN), put(world, 'raider', UMBRA)), expected, 'Umbra on Dawn');
    close(dealt(world, put(world, 'corvette', UMBRA), put(world, 'harrier', DAWN)), expected, 'Dawn on Umbra, ships of the line');
    close(dealt(world, put(world, 'harrier', DAWN), put(world, 'corvette', UMBRA)), expected, 'Umbra on Dawn, ships of the line');
});

test('the guns of both fleets cycle at the Admiral rate', () => {
    const world = worldAt(VERSUS);
    const ships = [put(world, 'dart', DAWN), put(world, 'raider', UMBRA)];
    for (const ship of ships) ship.weapons[0].cooldown = 3;
    for (let elapsed = 0; elapsed < 1 - 1e-9; elapsed += STEP) world.update(STEP, idle());
    for (const ship of ships) {
        assert.ok(Math.abs(ship.weapons[0].cooldown - (3 - ADMIRAL.enemyFireRate)) < 1e-6, `${ship.classId}: ${ship.weapons[0].cooldown}`);
    }
});

test('a Dawn ship of the line\'s beams burn a player as an Umbra ship\'s would on Admiral', () => {
    /** Shield a harrier's beams take off an enemy pilot in ten seconds (a shield too big to give out or to recharge). */
    const burn = (difficulty) => {
        const world = worldAt(difficulty);
        world.spawnShip('harrier', { position: [0, 0, 0], facing: [0, 0, 1], aiMode: 'hold', faction: DAWN });
        const pilot = world.spawnShip('kestrel', { position: [0, 0, 900], facing: [0, 0, 1], faction: UMBRA, local: false, maxShield: 1e6 });
        for (let elapsed = 0; elapsed < 10 - 1e-9; elapsed += STEP) world.update(STEP, idle());
        return 1e6 - pilot.shield;
    };
    const unscaled = burn({ ...VERSUS, damageTaken: 1, enemyBeamDamage: 1 });
    assert.ok(unscaled > 0, 'the beams reach');
    assert.ok(Math.abs(burn(VERSUS) / unscaled - ADMIRAL.enemyBeamDamage * ADMIRAL.damageTaken) < 1e-6);
});

test('the story\'s levels are what they were: allies chip at Umbra ships, and only Umbra is scaled', () => {
    const captain = worldAt('captain');
    close(dealt(captain, put(captain, 'raider', UMBRA), put(captain, 'dart', DAWN)), 10 * ALLIES.damageVsShips, 'an ally on an Umbra ship');
    close(dealt(captain, put(captain, 'dart', DAWN), put(captain, 'raider', UMBRA)), 10 * DIFFICULTY.captain.allyDamageTaken, 'Umbra on an ally');

    const admiral = worldAt('admiral');
    close(dealt(admiral, put(admiral, 'raider', UMBRA), put(admiral, 'kestrel', DAWN)), 10 / ADMIRAL.enemyToughness, 'the player on Umbra');
    close(dealt(admiral, put(admiral, 'kestrel', DAWN), null), 10 * ADMIRAL.damageTaken, 'a rammed rock');
    const [dart, raider] = [put(admiral, 'dart', DAWN), put(admiral, 'raider', UMBRA)];
    dart.weapons[0].cooldown = 3;
    raider.weapons[0].cooldown = 3;
    for (let elapsed = 0; elapsed < 1 - 1e-9; elapsed += STEP) admiral.update(STEP, idle());
    assert.ok(Math.abs(dart.weapons[0].cooldown - 2) < 1e-6, 'an ally\'s guns cycle as ever');
    assert.ok(Math.abs(raider.weapons[0].cooldown - (3 - ADMIRAL.enemyFireRate)) < 1e-6);
});
