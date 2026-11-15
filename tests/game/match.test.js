import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { destroyShip } from '../../src/game/core/systems/damage.js';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { PHASE } from '../../src/game/state/GameSession.js';
import { arenaRules, createTestMatch, serverShipOf, shipOf } from './support/matchHarness.js';

/**
 * The match machinery, whatever the game: every device (the host's included) is a client of
 * the server, sends controls and shows a copy of the world. Played in the bare "arena" mode.
 */

/** An arena with one stationary drone ahead of the start line. */
const withDrone = (x = 700) => arenaRules({ populate: (zone) => zone.world.spawnShip('drone', { position: [x, 300, 3600], facing: [0, 0, 1] }) });
const umbra = (world) => world.ships.filter((ship) => ship.alive && ship.faction === FACTION.UMBRA);
const arenaWorld = (match) => match.server.zones.get('arena').world;

test('every device ends up with the same ships, each flying its own', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { rules: arenaRules() });
    match.run(0.5);

    for (const device of match.devices) {
        assert.equal(device.world.ships.filter((ship) => ship.isPlayer).length, 3, `${device.id} sees three player ships`);
        assert.equal(device.world.player?.pilotId, device.id, `${device.id} flies its own ship`);
        assert.equal(device.session.phase, PHASE.PLAYING);
        assert.equal(device.world.sectorId, 'cinder');
    }
    assert.equal(arenaWorld(match).player, null, 'the server has no player of its own');
    // Names travel as the ships' callsigns.
    assert.equal(shipOf(match.clients[0].world, 'bo').callsign, 'bo');
});

test('the host plays through a client like everybody else', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const before = serverShipOf(match.server, 'host').quaternion.clone();

    match.host.controls.yaw = 1;
    match.host.controls.throttle = 1;
    match.run(1.5);

    const onServer = serverShipOf(match.server, 'host');
    assert.notEqual(match.host.world, arenaWorld(match), 'the host\'s screen shows a copy, not the simulation');
    assert.ok(onServer.quaternion.angleTo(before) > 0.5, 'the server flew the host\'s ship from its controls');
    assert.ok(match.host.world.player.position.distanceTo(onServer.position) < onServer.velocity.length() / 60 + 0.5);
    assert.ok(shipOf(match.clients[0].world, 'host').quaternion.angleTo(before) > 0.4, 'and the others see it turn');
});

test('a client steers its own ship and the server flies it the same way', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const [ann] = match.clients;
    const before = serverShipOf(match.server, 'ann').quaternion.clone();

    ann.controls.yaw = 1;
    ann.controls.throttle = 1;
    match.run(2);

    const onServer = serverShipOf(match.server, 'ann');
    const onClient = ann.world.player;
    assert.ok(onServer.quaternion.angleTo(before) > 0.5, 'the server turned the ship');
    // The client is always the one input it has just sent ahead of the server: one frame of travel.
    const frameOfTravel = onServer.velocity.length() / 60;
    const apart = onClient.position.distanceTo(onServer.position);
    assert.ok(apart < frameOfTravel + 0.5, `prediction within a frame of the server (${apart.toFixed(2)} m apart, a frame is ${frameOfTravel.toFixed(2)} m)`);
    assert.ok(onClient.quaternion.angleTo(onServer.quaternion) < 0.02, 'and pointing the same way');
    assert.ok(serverShipOf(match.server, 'host').quaternion.angleTo(before) < 1e-6, 'nobody else\'s ship moved to that stick');
});

test('the client feels its controls at once, before the server has answered', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules(), latency: 0.2 });
    match.run(1);
    const [ann] = match.clients;
    const ownBefore = ann.world.player.quaternion.clone();
    const serverBefore = serverShipOf(match.server, 'ann').quaternion.clone();

    ann.controls.yaw = 1;
    match.run(0.1);

    assert.ok(ann.world.player.quaternion.angleTo(ownBefore) > 0.01, 'turning on the client already');
    assert.ok(serverShipOf(match.server, 'ann').quaternion.angleTo(serverBefore) < 1e-6, 'while the input is still on its way');
});

test('prediction stays close to the server over a slow, lossy link', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules(), latency: 0.06, loss: 0.1 });
    match.run(1);
    const [ann] = match.clients;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
        // Weave about: full stick one way, then the other, with bursts of afterburner.
        ann.controls.yaw = Math.sin(i / 40);
        ann.controls.pitch = Math.cos(i / 55);
        ann.controls.throttle = 1;
        ann.controls.boost = i % 200 < 60;
        match.step();
        worst = Math.max(worst, ann.world.player.position.distanceTo(serverShipOf(match.server, 'ann').position));
    }
    // At up to 360 m/s with ~0.12 s of round trip the two legitimately differ by tens of metres;
    // what matters is that the error does not grow.
    assert.ok(worst < 80, `stayed within 80 m (worst ${worst.toFixed(1)})`);
    Object.assign(ann.controls, { yaw: 0, pitch: 0, boost: false, throttle: 0 });
    match.run(3);
    assert.ok(ann.world.player.position.distanceTo(serverShipOf(match.server, 'ann').position) < 15, 'and settles once the stick is still');
});

test('other ships are shown a moment behind the server, smoothly', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    match.host.controls.throttle = 1;
    match.host.controls.yaw = 0.5;
    const [ann] = match.clients;
    let previous = shipOf(ann.world, 'host').position.clone();
    let largestJump = 0;
    for (let i = 0; i < 240; i++) {
        match.step();
        const now = shipOf(ann.world, 'host').position;
        largestJump = Math.max(largestJump, now.distanceTo(previous));
        previous = now.clone();
    }
    const real = serverShipOf(match.server, 'host');
    const shown = shipOf(ann.world, 'host');
    // At 150 m/s a frame is 2.5 m: no frame may jump much further than that...
    assert.ok(largestJump < 6, `no stutter (largest step ${largestJump.toFixed(2)} m)`);
    // ...and the copy trails the real ship by well under a tenth of a second.
    assert.ok(shown.position.distanceTo(real.position) < 15, `trails by ${shown.position.distanceTo(real.position).toFixed(1)} m`);
    assert.ok(shown.velocity.length() > 100, 'with a velocity for its engine flames');
});

test('enemies, damage and kills come from the server', () => {
    const match = createTestMatch(['host', 'ann'], { rules: withDrone(735) });
    match.run(0.5);
    const [ann] = match.clients;
    assert.equal(umbra(ann.world).length, 1, 'the client sees the drone');
    const droneOnClient = umbra(ann.world)[0];
    const droneOnHost = umbra(match.host.world)[0];

    ann.session.handleAction('cycleTarget');
    ann.controls.firePrimary = true;
    match.run(0.5);
    assert.ok(droneOnHost.hullFraction < 1, 'another device sees the hull going down');
    assert.ok(match.host.world.beams.length > 0, 'and the beams doing it');
    match.run(4);

    assert.equal(umbra(arenaWorld(match)).length, 0, 'destroyed on the server');
    assert.equal(umbra(ann.world).length, 0, 'and so on the device that shot it');
    assert.equal(umbra(match.host.world).length, 0, 'and on the others');
    assert.equal(droneOnClient.alive, false);
});

test('pilot actions are carried out by the server for the player who asked', () => {
    const match = createTestMatch(['host', 'ann'], { rules: withDrone() });
    match.run(0.5);
    const [ann] = match.clients;

    ann.session.handleAction('cycleTarget');
    ann.session.handleAction('power:attack');
    match.run(0.3);

    assert.equal(serverShipOf(match.server, 'ann').target, umbra(arenaWorld(match))[0], 'locked on the server');
    assert.equal(ann.world.player.target, umbra(ann.world)[0], 'and shown as locked on the client');
    assert.equal(serverShipOf(match.server, 'ann').powerMode, 'attack');
    assert.equal(ann.world.player.powerMode, 'attack');
    assert.equal(serverShipOf(match.server, 'host').target, null, 'nobody else\'s lock is touched');
});

test('requests reach the game mode with the sender attached by the server', () => {
    const rules = arenaRules();
    const match = createTestMatch(['host', 'ann'], { rules });
    match.run(0.3);

    match.clients[0].match.request('jump', { to: 'somewhere', pilot: 'host' });
    match.host.seat.request('summon');
    match.run(0.2);

    // "pilot" inside the data is just data: who asked is what the server says, not what the device claims.
    assert.deepEqual(rules.requests.sort((a, b) => a.name.localeCompare(b.name)), [
        { pilot: 'ann', name: 'jump', data: { to: 'somewhere', pilot: 'host' } },
        { pilot: 'host', name: 'summon', data: {} },
    ]);
});

test('a destroyed ship is lost on every device, and its pilot keeps watching', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const [ann] = match.clients;

    destroyShip(arenaWorld(match), serverShipOf(match.server, 'ann'));
    match.run(0.5);

    assert.equal(ann.world.player.alive, false, 'the client sees its ship lost');
    assert.equal(shipOf(match.host.world, 'ann'), null);
    assert.equal(match.server.pilots.get('ann').ship, null);
    assert.equal(ann.session.phase, PHASE.PLAYING, 'the match goes on around the wreck');
    assert.ok(shipOf(ann.world, 'host'), 'and the others are still shown');
});

test('a player who leaves takes their ship with them and the match goes on', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { rules: arenaRules() });
    match.run(0.5);
    const [ann, bo] = match.clients;

    ann.link.close();
    match.run(0.5);

    assert.equal(serverShipOf(match.server, 'ann'), null);
    assert.equal(shipOf(bo.world, 'ann'), null, 'the others see the ship go');
    assert.deepEqual(bo.ui.match.players.map((player) => player.id), ['host', 'bo']);
    assert.equal(bo.ui.match.phase, MATCH_PHASE.PLAYING);
    assert.equal(ann.ui.match.phase, MATCH_PHASE.DISCONNECTED, 'the one who left is told the link is gone');
});

test('a client that stops hearing from the server gives up', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const [ann] = match.clients;

    // The host's device freezes: only the client keeps running.
    for (let i = 0; i < 60 * 7; i++) {
        match.advanceClock(1 / 60);
        ann.session.update(1 / 60, ann.controls);
    }

    assert.equal(ann.ui.match.phase, MATCH_PHASE.DISCONNECTED);
    assert.equal(ann.session.phase, PHASE.MATCH_OVER);
});

test('a silent client is flown with its controls released', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const [ann] = match.clients;
    ann.controls.yaw = 1;
    match.run(0.5);
    assert.ok(serverShipOf(match.server, 'ann').angularVelocity.length() > 0.3);

    // The client's device freezes with the stick hard over.
    for (let i = 0; i < 120; i++) {
        match.advanceClock(1 / 60);
        match.host.session.update(1 / 60, match.host.controls);
    }

    assert.ok(serverShipOf(match.server, 'ann').angularVelocity.length() < 0.01, 'the ship straightens out instead of spinning forever');
});

test('a zone nobody is in stands still', () => {
    const rules = arenaRules();
    const match = createTestMatch(['host'], { rules });
    const empty = match.server.addZone('empty', 'veil');
    empty.world.spawnShip('drone', { position: [0, 0, 0] });
    match.run(1);

    assert.equal(empty.world.time, 0, 'not simulated');
    assert.ok(arenaWorld(match).time > 0.9);
});

test('moving to another zone replaces the whole picture', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const [ann] = match.clients;
    const elsewhere = match.server.addZone('elsewhere', 'veil');
    const marker = elsewhere.world.spawnShip('raider', { position: [0, 0, 0] });
    const pilot = match.server.pilots.get('ann');

    arenaWorld(match).removeShip(pilot.ship);
    match.server.spawnPilotShip(pilot, elsewhere, { position: [0, 0, 800], facing: [0, 0, -1] });
    match.run(0.5);

    assert.equal(ann.world.sectorId, 'veil');
    assert.equal(ann.world.player.pilotId, 'ann');
    assert.equal(ann.world.player.alive, true);
    assert.equal(shipOf(ann.world, 'host'), null, 'the old zone\'s ships are gone from the screen');
    assert.equal(umbra(ann.world).length, 1, 'the new zone\'s are there');
    assert.ok(umbra(ann.world)[0].position.distanceTo(marker.position) < 40, 'where the server has it (give or take the moment it is shown behind)');
    assert.equal(shipOf(match.host.world, 'ann'), null, 'and those left behind no longer see the traveller');
    // Steering still works in the new place.
    ann.controls.yaw = 1;
    match.run(1);
    assert.ok(ann.world.player.position.distanceTo(serverShipOf(match.server, 'ann').position) < 5);
});

test('leaving a match puts the session back as it was', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const { session, ui, world } = match.host;

    session.enterTitle();

    assert.equal(session.match, null);
    assert.equal(session.phase, PHASE.TITLE);
    assert.equal(ui.match, null);
    assert.equal(world.ships.filter((ship) => ship.isPlayer).length, 1, 'only the title screen\'s ship is left');
    // The server has stopped listening: a client still sending is ignored without errors.
    match.clients[0].session.update(1 / 60, match.clients[0].controls);
    match.links.forEach((link) => link.deliver());
});
