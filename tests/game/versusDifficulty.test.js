import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE } from '../../src/game/config/battleRoyale.js';
import { ALLIES, DIFFICULTY, FACTION, POWER_MODES } from '../../src/game/config/gameConfig.js';
import { ABILITIES, PASSIVES } from '../../src/game/config/abilities.js';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { applyDamage, destroyShip, isEnemyFleet } from '../../src/game/core/systems/damage.js';
import { applyPilotAction } from '../../src/game/core/systems/pilotActions.js';
import { World } from '../../src/game/core/World.js';

/**
 * How strong the computer-flown ships of a multiplayer match are (BATTLE_ROYALE.difficulty,
 * a `versus` difficulty): the story's Admiral level, for the fleets of both sides alike. Between
 * one player and another the guns do a quarter of their damage, and abilities all of theirs.
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
/** A class's own share of its fleet's numbers in a match (VERSUS.classes; 1 where it has none). */
const share = (classId, key) => VERSUS.classes?.[classId]?.[key] ?? 1;

test('a match\'s computer-flown ships fight at the story\'s Admiral level', () => {
    assert.equal(VERSUS.versus, true);
    for (const key of ['damageTaken', 'enemyToughness', 'enemyFireRate', 'enemyBeamDamage']) {
        assert.equal(VERSUS[key], ADMIRAL[key], key);
    }
    assert.equal(VERSUS.shieldRegen, 1, 'players\' shields recharge as usual');
    assert.equal(VERSUS.playerDamage, 0.25, 'and their guns do a quarter to each other');
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
            close(hit, fromUmbraInStory * share(classId, 'pilotDamage'), `${classId} on a ${pilotSide} pilot`);
        }
    }
    // The pilot's own power mode still counts, on top.
    const braced = put(world, 'kestrel', DAWN);
    braced.powerMode = 'defense';
    close(dealt(world, braced, put(world, 'raider', UMBRA)), 10 * ADMIRAL.damageTaken * POWER_MODES.defense.damageTaken * share('raider', 'pilotDamage'), 'defense mode');
});

test('a player\'s guns do a quarter of their damage to another player\'s ship, and all of it to anything else', () => {
    const world = worldAt(VERSUS);
    close(dealt(world, put(world, 'kestrel', UMBRA), put(world, 'kestrel', DAWN)), 2.5, 'pilot on pilot');
    close(dealt(world, put(world, 'bulwark', DAWN), put(world, 'shrike', PIRATE)), 2.5, 'pirate on pilot');
    close(dealt(world, put(world, 'kestrel', PIRATE), put(world, 'kestrel', PIRATE)), 2.5, 'pirate on pirate');
    const attacking = put(world, 'kestrel', UMBRA);
    attacking.powerMode = 'attack';
    close(dealt(world, attacking, put(world, 'kestrel', DAWN)), 2.5 * POWER_MODES.attack.damageTaken, 'the target\'s power mode counts on top');
    close(dealt(world, put(world, 'kestrel', DAWN), null), 10, 'a rammed rock is nobody\'s gun');
    close(dealt(world, put(world, 'raider', UMBRA), put(world, 'kestrel', DAWN)), 10 / ADMIRAL.enemyToughness, 'a computer-flown ship gets all of it');
});

test('a duel between two pilots is fought with the real guns at a quarter: beams and torpedoes alike', () => {
    /** Shield an attacker 600 m astern takes off a pilot (a shield too big to give out) in `seconds` of holding `triggers`. */
    const fire = (difficulty, triggers, seconds) => {
        const world = worldAt(difficulty);
        const attacker = world.spawnShip('kestrel', { position: [0, 0, 0], facing: [0, 0, -1], faction: DAWN });
        const target = world.spawnShip('kestrel', { position: [0, 0, -600], facing: [0, 0, -1], faction: UMBRA, local: false, maxShield: 1e6 });
        attacker.throttle = 0;
        target.throttle = 0;
        attacker.target = target;
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP) world.update(STEP, { ...idle(), ...triggers });
        return 1e6 - target.shield;
    };
    const full = { ...VERSUS, playerDamage: 1 };
    for (const triggers of [{ firePrimary: true }, { fireSecondary: true }]) {
        const unscaled = fire(full, triggers, 4);
        assert.ok(unscaled > 0, 'the guns reach');
        assert.ok(Math.abs(fire(VERSUS, triggers, 4) / unscaled - 0.25) < 1e-6, JSON.stringify(triggers));
    }
});

test('abilities are not turned down between pilots: the lance, the breach and the reactor', () => {
    // The Shrike's lance burns a pilot's ship down in the seconds its ability says, whatever the scale.
    const world = worldAt(VERSUS);
    const shrike = world.spawnShip('shrike', { position: [0, 0, 0], facing: [0, 0, -1], faction: DAWN });
    const target = world.spawnShip('bulwark', { position: [0, 0, -4000], facing: [0, 0, -1], faction: UMBRA, local: false });
    shrike.throttle = 0;
    target.throttle = 0;
    shrike.target = target;
    applyPilotAction(world, shrike, 'ability');
    let seconds = 0;
    for (; target.alive && seconds < 20; seconds += STEP) world.update(STEP, { ...idle(), firePrimary: true });
    assert.ok(Math.abs(seconds - ABILITIES.focusLance.shieldedKillSeconds) < 0.1, `the lance took ${seconds} s`);

    // The Kestrel's breach torpedo still takes the whole shield; only its own impact is a torpedo's.
    const breach = worldAt(VERSUS);
    const kestrel = breach.spawnShip('kestrel', { position: [0, 0, 0], facing: [0, 0, -1], faction: DAWN });
    const victim = breach.spawnShip('bulwark', { position: [0, 0, -500], facing: [0, 0, -1], faction: UMBRA, local: false });
    kestrel.throttle = 0;
    victim.throttle = 0;
    kestrel.target = victim;
    applyPilotAction(breach, kestrel, 'ability');
    for (let elapsed = 0; elapsed < 3; elapsed += STEP) breach.update(STEP, idle());
    assert.equal(victim.shield, 0, 'the shield is gone');
    const warhead = WEAPONS.breachTorpedo;
    assert.ok(victim.maxHull - victim.hull <= warhead.damage * warhead.hullMult * VERSUS.playerDamage + 1e-6, 'and the hull took no more than a quarter of a warhead');

    // A dying Bulwark's reactor takes its share of a pilot's ship as ever.
    const blast = worldAt(VERSUS);
    const bulwark = put(blast, 'bulwark', DAWN, { position: [0, 0, 0] });
    const near = put(blast, 'kestrel', UMBRA, { position: [0, 0, 400] });
    destroyShip(blast, bulwark, near);
    close(near.maxShield + near.maxHull - near.shield - near.hull, (near.maxShield + near.maxHull) * PASSIVES.reactorBlast.damage.player, 'the blast');
});

test('the fleets of both sides are as tough as each other, to players and to one another', () => {
    const world = worldAt(VERSUS);
    const expected = 10 / ADMIRAL.enemyToughness;
    for (const [classId, fleet] of [['dart', DAWN], ['harrier', DAWN], ['raider', UMBRA], ['corvette', UMBRA], ['warden', UMBRA], ['penumbra', UMBRA]]) {
        for (const pilotSide of [DAWN, UMBRA, PIRATE]) {
            close(dealt(world, put(world, classId, fleet), put(world, 'kestrel', pilotSide)), expected / share(classId, 'toughness'), `a ${pilotSide} pilot on a ${classId}`);
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

test('a Dawn ship of the line\'s beams burn a player as an Umbra ship\'s would on Admiral, times the frigate\'s own share', () => {
    /** Shield a harrier's beams take off an enemy pilot in ten seconds (a shield too big to give out or to recharge). */
    const burn = (difficulty) => {
        const world = worldAt(difficulty);
        world.spawnShip('harrier', { position: [0, 0, 0], facing: [0, 0, 1], aiMode: 'hold', faction: DAWN });
        const pilot = world.spawnShip('kestrel', { position: [0, 0, 900], facing: [0, 0, 1], faction: UMBRA, local: false, maxShield: 1e6 });
        for (let elapsed = 0; elapsed < 10 - 1e-9; elapsed += STEP) world.update(STEP, idle());
        return 1e6 - pilot.shield;
    };
    const unscaled = burn({ ...VERSUS, damageTaken: 1, enemyBeamDamage: 1, classes: {} });
    assert.ok(unscaled > 0, 'the beams reach');
    const harrier = share('harrier', 'damage') * share('harrier', 'pilotDamage');
    assert.ok(Math.abs(burn(VERSUS) / unscaled - ADMIRAL.enemyBeamDamage * ADMIRAL.damageTaken * harrier) < 1e-6);
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

// ---- What some classes carry of their own ------------------------------------------------------

test('a class\'s own shares: what it soaks up, what it fires, and what of that a pilot takes', () => {
    const classes = { raider: { toughness: 2, damage: 3, pilotDamage: 0.5 } };
    const world = worldAt({ ...VERSUS, classes });
    // Toughness: a hit on one is cut by its fleet's toughness and then by its own.
    close(dealt(world, put(world, 'raider', UMBRA), put(world, 'kestrel', DAWN)), 10 / ADMIRAL.enemyToughness / 2, 'a pilot on it');
    close(dealt(world, put(world, 'drone', UMBRA), put(world, 'kestrel', DAWN)), 10 / ADMIRAL.enemyToughness, 'a class it does not name');
    // pilotDamage: only what it does to a player's ship.
    close(dealt(world, put(world, 'kestrel', DAWN), put(world, 'raider', UMBRA)), 10 * ADMIRAL.damageTaken * 0.5, 'it on a pilot');
    close(dealt(world, put(world, 'dart', DAWN), put(world, 'raider', UMBRA)), 10 / ADMIRAL.enemyToughness, 'it on a ship of the other fleet');

    // Damage: every shot it fires carries it - here a raider's bolts on a pilot sitting in front of
    // it - and a pilot takes `pilotDamage` of that. (Per hit: how many of the bolts land is luck.)
    const perHit = (difficulty) => {
        const scene = worldAt(difficulty);
        const pilot = scene.spawnShip('kestrel', { position: [0, 0, -300], facing: [0, 0, 1], faction: DAWN, local: false, maxShield: 1e6 });
        pilot.throttle = 0;
        scene.spawnShip('raider', { position: [0, 0, 0], facing: [0, 0, -1], faction: UMBRA, maxShield: 1e6 });
        const hits = { warheads: [], taken: [] };
        scene.onDamage = (target, source, amount) => {
            if (target !== pilot) return;
            hits.warheads.push(amount);
            hits.taken.push(1e6 - pilot.shield - hits.taken.reduce((sum, each) => sum + each, 0));
        };
        for (let elapsed = 0; elapsed < 6; elapsed += STEP) {
            pilot.velocity.set(0, 0, 0);
            pilot.position.set(0, 0, -300);
            scene.update(STEP, idle());
        }
        assert.ok(hits.warheads.length > 0, 'the raider hits');
        return { warhead: hits.warheads[0], taken: hits.taken[0] };
    };
    const plain = perHit({ ...VERSUS, classes: {} });
    close(plain.warhead, WEAPONS.raiderBolt.damage, 'a bolt as it is');
    close(perHit({ ...VERSUS, classes: { raider: { damage: 3 } } }).warhead, 3 * plain.warhead, 'three times the bolt');
    close(perHit({ ...VERSUS, classes: { raider: { damage: 3 } } }).taken, 3 * plain.taken, 'and three times what the pilot loses');
    const gentle = perHit({ ...VERSUS, classes: { raider: { pilotDamage: 0.5 } } });
    close(gentle.warhead, plain.warhead, 'the bolt is the same');
    close(gentle.taken, 0.5 * plain.taken, 'a pilot takes half of it');
});

test('in the story no class carries a share of its own', () => {
    const story = worldAt('admiral');
    close(dealt(story, put(story, 'harrier', DAWN), put(story, 'raider', UMBRA)), 10 * ADMIRAL.allyDamageTaken, 'a frigate is an ally there');
    close(dealt(story, put(story, 'warden', UMBRA), put(story, 'kestrel', DAWN)), 10 / ADMIRAL.enemyToughness, 'a cruiser');
});

test('in a match both fleets go for players first, as the story\'s Umbra do; torpedo bombers keep to big ships', () => {
    assert.equal(VERSUS.pilotsFirst, true);
    /**
     * What ten ships of `classId` go for, with a pilot and one of the other fleet's fighters the
     * same distance off and a ship of the line a little further. (Ten, because a squadron spreads
     * itself over targets that are otherwise alike: aiPilot.js chooseTarget's jitter.)
     */
    const choices = (difficulty, classId, faction) => {
        const scene = worldAt(difficulty);
        const enemy = faction === DAWN ? UMBRA : DAWN;
        const hunters = Array.from({ length: 10 }, (_, i) => scene.spawnShip(classId, { position: [0, i * 4, 0], facing: [0, 0, -1], faction }));
        const pilot = scene.spawnShip('kestrel', { position: [700, 0, 0], facing: [0, 0, 1], faction: enemy, local: false });
        const fighter = scene.spawnShip(enemy === UMBRA ? 'raider' : 'dart', { position: [-700, 0, 0], facing: [0, 0, 1], faction: enemy, aiMode: 'hold' });
        scene.spawnShip(enemy === UMBRA ? 'corvette' : 'harrier', { position: [0, 0, 760], facing: [0, 0, 1], faction: enemy, aiMode: 'hold' });
        scene.update(STEP, idle());
        const count = { pilot: 0, fighter: 0, capital: 0 };
        for (const hunter of hunters) count[hunter.target === pilot ? 'pilot' : hunter.target === fighter ? 'fighter' : 'capital'] += 1;
        return count;
    };
    assert.equal(choices(VERSUS, 'dart', DAWN).pilot, 10, 'every dart goes for the pilot');
    assert.equal(choices(VERSUS, 'raider', UMBRA).pilot, 10, 'so does every raider');
    for (const difficulty of [{ ...VERSUS, pilotsFirst: false }, 'admiral']) {
        const count = choices(difficulty, 'dart', DAWN);
        assert.ok(count.pilot < 10 && count.fighter > 0, `of its own accord a dart sees just another fighter: ${JSON.stringify(count)}`);
    }
    assert.equal(choices(VERSUS, 'lancer', UMBRA).capital, 10, 'a bomber goes for the ship of the line');
});
