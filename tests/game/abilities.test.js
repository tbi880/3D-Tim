import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ABILITIES, ABILITY_COOLDOWN, ABILITY_DENIED_CUE, ABILITY_PHASE, abilityOf } from '../../src/game/config/abilities.js';
import { FACTION, PLAYER } from '../../src/game/config/gameConfig.js';
import { PLAYER_SHIPS } from '../../src/game/config/playerShips.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { GAME_EVENTS } from '../../src/game/core/EventBus.js';
import { applyDamage } from '../../src/game/core/systems/damage.js';
import { applyPilotAction } from '../../src/game/core/systems/pilotActions.js';
import { isValidTarget } from '../../src/game/core/systems/targeting.js';
import { playerBeamRange, playerTorpedoRange } from '../../src/game/core/systems/weapons.js';
import { World } from '../../src/game/core/World.js';
import { abilityStatus } from '../../src/game/state/GameSession.js';
import { arenaRules, createTestMatch, serverShipOf, shipOf } from './support/matchHarness.js';

/**
 * The ships' active abilities (config/abilities.js), in a bare world: one player ship at the
 * origin, nose along -z, and whatever the scene needs in front of it.
 */

const STEP = 1 / 60;
const { DAWN, UMBRA } = FACTION;
const idle = () => ({ yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false });

function scene(classId) {
    const world = new World({ seed: 1 });
    const ship = world.spawnShip(classId, { position: [0, 0, 0], facing: [0, 0, -1] });
    const controls = idle();
    const events = [];
    world.events.on(GAME_EVENTS.ABILITY, (event) => events.push(event));
    const run = (seconds) => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP) world.update(STEP, controls);
    };
    /** Runs until `done()` is true; returns the seconds it took (Infinity: it never was). */
    const until = (done, limit = 30) => {
        for (let elapsed = 0; elapsed < limit; elapsed += STEP) {
            if (done()) return elapsed;
            world.update(STEP, controls);
        }
        return done() ? limit : Infinity;
    };
    const press = () => applyPilotAction(world, ship, 'ability');
    /** A ship that sits where it is put and does nothing. */
    const put = (id, position, options = {}) => world.spawnShip(id, { position, facing: [0, 0, 1], aiMode: 'hold', ...options });
    return { world, ship, controls, events, run, until, press, put };
}

/** Another player's ship (flown from elsewhere: here, by nobody) on the other side. */
const enemyPilot = (game, position, classId = 'kestrel') => game.put(classId, position, { faction: UMBRA, local: false, pilotId: 'foe' });

test('every player ship but the Bulwark has an ability, on one of three lengths of cooldown', () => {
    const cooldowns = Object.fromEntries(PLAYER_SHIPS.map(({ classId }) => [classId, abilityOf(SHIP_CLASSES[classId])?.cooldown ?? null]));
    assert.deepEqual(cooldowns, {
        kestrel: ABILITY_COOLDOWN.medium, swift: ABILITY_COOLDOWN.short, shrike: ABILITY_COOLDOWN.medium,
        bulwark: null, peregrine: ABILITY_COOLDOWN.long,
    });
    assert.ok(ABILITY_COOLDOWN.short < ABILITY_COOLDOWN.medium && ABILITY_COOLDOWN.medium < ABILITY_COOLDOWN.long);

    const bulwark = scene('bulwark');
    assert.equal(bulwark.ship.ability, null);
    assert.equal(bulwark.press(), null, 'its button does nothing');
    assert.equal(abilityStatus(bulwark.ship), null, 'and the HUD shows none');
    // Nothing but a pilot's ship has one.
    assert.equal(bulwark.put('raider', [0, 0, -900]).ability, null);
});

test('Swift: the overdrive is a two-second dash that nothing can hurt, on a short cooldown', () => {
    const game = scene('swift');
    const { ship, world } = game;
    const raider = game.put('raider', [0, 0, -5000]);
    game.controls.throttle = 1;
    game.run(4);
    const cruise = ship.speed;
    const hullAndShield = () => ship.hull + ship.shield;

    assert.equal(abilityStatus(ship).state, 'ready');
    assert.equal(game.press(), null);
    assert.deepEqual(game.events.map((event) => [event.ship, event.ability, event.phase]), [[ship, 'overdrive', ABILITY_PHASE.START]]);
    assert.equal(abilityStatus(ship).state, 'active');
    game.run(1);
    const afterburner = ship.cls.maxSpeed * PLAYER.boostMultiplier * ship.cls.handling.boostMultiplier;
    assert.ok(ship.speed > afterburner * 1.3, `${ship.speed.toFixed(0)} m/s: past the afterburner's ${afterburner.toFixed(0)}`);
    assert.ok(ship.speed > cruise * 2);
    assert.equal(ship.boost, 1, 'the tank is not touched');

    // Guns, torpedoes and a rammed hull alike: nothing lands.
    const before = hullAndShield();
    applyDamage(world, ship, 500, { source: raider });
    applyDamage(world, ship, 500);
    assert.equal(hullAndShield(), before);
    assert.equal(game.press(), null, 'pressed again while it runs: nothing');

    game.run(1.1);
    assert.equal(ship.effect('overdrive'), null, 'over after two seconds');
    assert.equal(game.events.at(-1).phase, ABILITY_PHASE.END);
    applyDamage(world, ship, 10, { source: raider });
    assert.ok(hullAndShield() < before, 'and the ship can be hit again');

    // The cooldown counts from the end of the dash.
    assert.equal(abilityStatus(ship).state, 'cooldown');
    assert.equal(game.press(), ABILITY_DENIED_CUE);
    game.run(ABILITY_COOLDOWN.short - 0.5);
    assert.equal(game.press(), ABILITY_DENIED_CUE);
    game.run(0.6);
    assert.equal(abilityStatus(ship).state, 'ready');
    assert.equal(game.press(), null);
    assert.ok(ship.effect('overdrive'));
});

test('Peregrine: cloaked, it cannot be locked or fired on for five seconds', () => {
    const game = scene('peregrine');
    const { ship, world } = game;
    const raider = world.spawnShip('raider', { position: [0, 0, -700], facing: [0, 0, 1] });
    const foe = enemyPilot(game, [300, 0, -900]);
    world.setPlayerTarget(ship, foe);
    game.run(1.5);
    assert.equal(raider.ai.target ?? raider.target, ship, 'the raider is after it');
    const torpedo = world.projectiles.find((projectile) => projectile.kind === 'torpedo') ?? null;

    game.press();
    assert.equal(ship.cloaked, true);
    assert.equal(isValidTarget(ship), false);
    const before = ship.hull + ship.shield;
    game.run(0.5);
    assert.equal(foe.target, null, 'a player\'s lock on it is gone');
    assert.notEqual(raider.ai.target ?? raider.target, ship, 'and so is the raider\'s');
    assert.equal(world.targetNearestToCrosshair(null, foe) ?? foe.target, null, 'nor can it be locked again');
    if (torpedo) assert.equal(torpedo.target, null);

    applyDamage(world, ship, 80, { source: raider });
    game.run(3);
    assert.equal(ship.hull + ship.shield >= before, true, 'no weapon touches it');
    // A rock or a hull it flies into still does: the cloak is not armour.
    applyDamage(world, ship, 10);
    assert.ok(ship.hull + ship.shield < before);

    game.run(1.6);
    assert.equal(ship.cloaked, false, 'five seconds, and it is back');
    assert.equal(isValidTarget(ship), true);
    assert.ok(Math.abs(ship.ability.cooldown - ABILITY_COOLDOWN.long) < 0.2, 'the long cooldown starts when the cloak ends');
});

test('Peregrine: opening fire ends the cloak', () => {
    for (const trigger of ['firePrimary', 'fireSecondary']) {
        const game = scene('peregrine');
        game.put('drone', [0, 0, -800]);
        game.press();
        game.run(1);
        assert.equal(game.ship.cloaked, true);
        game.controls[trigger] = true;
        game.run(0.1);
        assert.equal(game.ship.cloaked, false, trigger);
        assert.equal(game.events.at(-1).phase, ABILITY_PHASE.END);
        assert.ok(game.ship.ability.cooldown > ABILITY_COOLDOWN.long - 0.5, 'and the cooldown starts there');
    }
});

test('Kestrel: the breach torpedo homes, flies half as far again, and its blast takes every shield within 1.5 km down for 10 s', () => {
    const { breach } = WEAPONS.breachTorpedo;
    assert.deepEqual([breach.radius, breach.shieldDownSeconds], [1500, 10]);
    const game = scene('kestrel');
    const { ship, world } = game;
    assert.ok(Math.abs(playerTorpedoRange(ship, WEAPONS.breachTorpedo) / playerTorpedoRange(ship, WEAPONS.playerTorpedo) - 1.5) < 1e-9);

    // Off to one side: a torpedo that flew straight would miss it.
    const target = game.put('raider', [500, 0, -1500]);
    const near = game.put('raider', [900, 400, -2300]);
    const far = game.put('raider', [0, 0, -4200]);
    const friend = game.put('dart', [450, 60, -1500]);
    const foePilot = enemyPilot(game, [300, -500, -1900]);
    world.setPlayerTarget(target);
    const torpedoes = ship.weapons.find((weapon) => weapon.def.type === 'torpedo').ammo;

    assert.equal(game.press(), null);
    const warhead = world.projectiles.at(-1);
    assert.equal(warhead.def, WEAPONS.breachTorpedo);
    assert.equal(warhead.target, target);
    assert.equal(ship.weapons.find((weapon) => weapon.def.type === 'torpedo').ammo, torpedoes, 'it is not one of the six in the tubes');
    assert.equal(abilityStatus(ship).state, 'armed');
    assert.ok(ship.ability.cooldown > ABILITY_COOLDOWN.medium - 0.1, 'the cooldown counts from the launch');

    const blast = () => game.events.find((event) => event.phase === ABILITY_PHASE.BLAST);
    assert.ok(game.until(() => Boolean(blast()), 8) < 8, 'it reaches the target');
    assert.ok(blast().position.distanceTo(target.position) < 60, 'by homing on it');
    assert.equal(blast().radius, 1500);
    assert.equal(warhead.alive, false);
    assert.ok(target.hull < target.maxHull || target.shield === 0, 'the hit itself landed first');

    for (const [name, other] of Object.entries({ target, near, foePilot })) {
        assert.equal(other.shield, 0, `${name}: shield down`);
        assert.ok(other.shieldDown > 9.5, `${name}: for ten seconds`);
    }
    assert.equal(far.shield, far.maxShield, 'beyond 1.5 km: untouched');
    assert.equal(friend.shield, friend.maxShield, 'its own side: untouched');
    assert.equal(ship.shield, ship.maxShield);

    game.run(9.5);
    assert.equal(near.shield, 0, 'still down, long after an ordinary shield would have begun to mend');
    game.run(0.6 + near.cls.shieldDelay + 1);
    assert.ok(near.shield > 0, 'then it comes back as it always does');
    assert.equal(abilityStatus(ship).state, 'cooldown');
});

test('Kestrel: pressed again while the warhead flies, it goes off where it is', () => {
    const game = scene('kestrel');
    const { ship, world } = game;
    const beside = game.put('raider', [400, 0, -500]);
    const ahead = game.put('raider', [0, 0, -2600]);
    // Nothing locked: it flies straight on.
    game.press();
    const warhead = world.projectiles.at(-1);
    assert.equal(warhead.target, null);
    game.run(1);
    assert.equal(abilityStatus(ship).state, 'armed');
    assert.equal(beside.shield, beside.maxShield);

    assert.equal(game.press(), null, 'the second press is not refused by the cooldown');
    const blast = game.events.find((event) => event.phase === ABILITY_PHASE.BLAST);
    assert.ok(blast, 'it went off');
    assert.ok(blast.position.z < -300 && blast.position.z > -700, `where it was: ${blast.position.z.toFixed(0)}`);
    assert.equal(warhead.alive, false);
    assert.equal(beside.shield, 0);
    assert.equal(ahead.shield, ahead.maxShield, 'out of its reach from there');
    game.run(0.1);
    assert.equal(abilityStatus(ship).state, 'cooldown');
    assert.equal(game.press(), ABILITY_DENIED_CUE, 'and a third press has to wait');

    // Left alone, the warhead goes off when its fuel is gone.
    const second = scene('kestrel');
    second.press();
    assert.ok(second.until(() => second.events.some((event) => event.phase === ABILITY_PHASE.BLAST), 8) > WEAPONS.breachTorpedo.lifetime - 0.2);
});

test('Shrike: the lance reaches 20 km and kills a shielded pilot in five seconds, a bare one in three', () => {
    const lance = ABILITIES.focusLance;
    assert.deepEqual([lance.duration, lance.shieldedKillSeconds, lance.bareKillSeconds, WEAPONS.focusLance.range], [15, 5, 3, 20000]);

    for (const [shielded, seconds] of [[true, 5], [false, 3]]) {
        const game = scene('shrike');
        const { ship, world } = game;
        // Two sturdy ships with all the shield there is: the lance does not care.
        const foe = enemyPilot(game, [0, 0, -18000], 'bulwark');
        foe.powerMode = 'defense';
        // Bare: its shield is being held down (by a breach blast, say).
        if (!shielded) foe.shieldDown = 60;
        world.setPlayerTarget(foe);
        game.controls.firePrimary = true;
        game.run(1);
        assert.equal(foe.hull + foe.shield, foe.maxHull + (shielded ? foe.maxShield : 0), 'the beams do not reach that far');

        game.press();
        assert.equal(playerBeamRange(ship, WEAPONS.playerBeam), 20000);
        const energy = ship.energy;
        const took = game.until(() => !foe.alive, 12);
        assert.ok(Math.abs(took - seconds) < 0.15, `${shielded ? 'shielded' : 'bare'}: dead in ${took.toFixed(2)} s`);
        assert.ok(ship.energy >= energy, 'it does not drain the capacitor');
    }
});

test('Shrike: the lance lasts fifteen seconds, wears a ship of the line down at a flat rate, and spares what cannot be hurt', () => {
    const game = scene('shrike');
    const { ship, world } = game;
    const frigate = game.put('harrier', [0, 0, -9000], { faction: UMBRA });
    world.setPlayerTarget(frigate);
    game.controls.firePrimary = true;
    game.press();
    const before = frigate.hull + frigate.shield;
    game.run(5);
    const lost = before - frigate.hull - frigate.shield;
    assert.ok(Math.abs(lost - ABILITIES.focusLance.capitalDps * 5) < ABILITIES.focusLance.capitalDps * 0.2, `${lost.toFixed(0)} in five seconds`);

    frigate.invulnerable = true;
    const held = frigate.hull + frigate.shield;
    game.run(2);
    assert.equal(frigate.hull + frigate.shield, held);
    frigate.invulnerable = false;

    game.run(8.1);
    assert.equal(ship.effect('lance'), null, 'fifteen seconds');
    assert.equal(playerBeamRange(ship, WEAPONS.playerBeam), WEAPONS.playerBeam.range * ship.cls.weaponRange);
    assert.ok(Math.abs(ship.ability.cooldown - ABILITY_COOLDOWN.medium) < 0.2);
});

test('an ability is not for a ship the story has the helm of, or one that is gone', () => {
    const game = scene('swift');
    game.world.controlsLocked = true;
    assert.equal(game.press(), null);
    assert.equal(game.ship.effect('overdrive'), null);
    game.world.controlsLocked = false;
    game.ship.alive = false;
    assert.equal(game.press(), null);
    assert.equal(game.events.length, 0);
});

// ---- In a match: the host decides, every device is told ---------------------------------------

const flying = (classes) => ({
    players: Object.entries(classes).map(([playerId, shipClassId]) => ({ playerId, displayName: playerId, shipClassId, loadout: { upgrades: {}, equipment: [] } })),
});

test('in a match the ability is used on the host, and its state comes back to the player who pressed', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules(), start: flying({ host: 'kestrel', ann: 'swift' }) });
    match.run(0.5);
    const [ann] = match.clients;
    const heard = [];
    ann.world.events.on(GAME_EVENTS.ABILITY, (event) => heard.push(event));
    const seenByHost = [];
    match.host.world.events.on(GAME_EVENTS.ABILITY, (event) => seenByHost.push(event));
    assert.equal(ann.ui.hud.ability.state, 'ready');

    ann.session.handleAction('ability');
    match.run(0.3);
    const onServer = serverShipOf(match.server, 'ann');
    assert.ok(onServer.effect('overdrive'), 'running on the server');
    assert.ok(ann.world.player.effect('overdrive'), 'and on the player\'s own copy, which flies the dash with it');
    assert.equal(ann.ui.hud.ability.state, 'active');
    assert.deepEqual(heard.map((event) => [event.ship, event.ability, event.phase]), [[ann.world.player, 'overdrive', ABILITY_PHASE.START]]);
    assert.deepEqual(seenByHost.map((event) => [event.ship, event.phase]), [[shipOf(match.host.world, 'ann'), ABILITY_PHASE.START]], 'the others are told, with the ship as they see it');

    match.run(2.2);
    assert.equal(onServer.effect('overdrive'), null);
    assert.equal(ann.ui.hud.ability.state, 'cooldown');
    assert.ok(Math.abs(ann.world.player.ability.cooldown - onServer.ability.cooldown) < 0.5);
    assert.ok(ann.world.player.position.distanceTo(onServer.position) < 40, 'the prediction kept up with the dash');
    assert.equal(heard.at(-1).phase, ABILITY_PHASE.END);
});

test('in a match a cloaked ship is shown as cloaked on every device, and a breached shield as held down', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { rules: arenaRules({ spacing: 300 }), start: flying({ host: 'kestrel', ann: 'peregrine', bo: 'kestrel' }) });
    match.run(0.5);
    const [ann, bo] = match.clients;
    ann.session.handleAction('ability');
    match.run(0.4);
    assert.equal(serverShipOf(match.server, 'ann').cloaked, true);
    assert.equal(ann.ui.hud.cloaked, true);
    assert.equal(shipOf(bo.world, 'ann').cloaked, true);
    assert.equal(shipOf(match.host.world, 'ann').cloaked, true);
    match.run(5);
    assert.equal(shipOf(bo.world, 'ann').cloaked, false);
    assert.equal(ann.ui.hud.cloaked, false);

    // The arena puts everybody on one side: turn Bo's coat, then breach beside him.
    const boOnServer = serverShipOf(match.server, 'bo');
    boOnServer.faction = UMBRA;
    const blasts = [];
    bo.world.events.on(GAME_EVENTS.ABILITY, (event) => event.phase === ABILITY_PHASE.BLAST && blasts.push(event));
    match.host.session.handleAction('ability');
    match.run(0.5);
    assert.equal(match.host.ui.hud.ability.state, 'armed');
    match.host.session.handleAction('ability');
    match.run(0.5);
    assert.equal(boOnServer.shield, 0);
    assert.equal(blasts.length, 1, 'the blast is drawn on every device');
    assert.equal(blasts[0].radius, WEAPONS.breachTorpedo.breach.radius);
    assert.ok(bo.ui.hud.shieldDown >= 9, `Bo is told how long: ${bo.ui.hud.shieldDown}`);
    assert.equal(serverShipOf(match.server, 'ann').shield, serverShipOf(match.server, 'ann').maxShield, 'the host\'s own side is spared');
    assert.equal(match.host.ui.hud.ability.state, 'cooldown');
});
