import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destroyShip } from '../../src/game/core/systems/damage.js';
import { createControls, encodeInput } from '../../src/game/net/codec/inputPacket.js';
import { NET } from '../../src/game/net/netConfig.js';
import { MSG } from '../../src/game/net/protocol.js';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { normalizeMatchInfo } from '../../src/game/net/match/matchInfo.js';
import { MatchServer } from '../../src/game/net/server/MatchServer.js';
import { createMemoryLinkPair } from '../../src/game/net/transport/MemoryLink.js';
import { arenaRules, createTestMatch, matchStart, serverShipOf, shipOf } from './support/matchHarness.js';

/**
 * What a player with a modified client can and cannot do to a match. Each test plays the
 * cheat: it writes straight onto the link, past the game's own client code.
 */

const withDrone = () => arenaRules({ populate: (zone) => zone.world.spawnShip('drone', { position: [700, 300, 3600], facing: [0, 0, 1] }) });
const arenaWorld = (match) => match.server.zones.get('arena').world;
const say = (link, message) => link.sendMessage(JSON.stringify(message));

/** A server whose one player, "ann", is a bare link ("mallory") instead of the game's client code. */
function serverWithRawClient() {
    let time = 0;
    const info = normalizeMatchInfo(matchStart(['ann']));
    const server = new MatchServer({ info, mode: arenaRules(), now: () => time });
    const [serverEnd, mallory] = createMemoryLinkPair({ clock: () => time });
    server.attachLink('ann', serverEnd);
    server.start();
    const received = [];
    mallory.onMessage = (text) => received.push(JSON.parse(text));
    const pump = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
            time += 1 / 60;
            serverEnd.deliver();
            server.update(1 / 60);
            mallory.deliver();
        }
    };
    return { server, serverEnd, mallory, received, pump };
}

test('a link from someone who is not in the match is refused', () => {
    const { server } = serverWithRawClient();
    const [strangerEnd] = createMemoryLinkPair();
    assert.equal(server.attachLink('mallory', strangerEnd), false);
    assert.equal(server.pilots.has('mallory'), false);
});

test('a client must say hello for this very match before it is told anything', () => {
    const { server, mallory, received, pump } = serverWithRawClient();
    mallory.onState = () => received.push({ t: 'snapshot' });

    pump(0.5);
    assert.deepEqual(received, [], 'nothing is sent to a link that has not asked');

    say(mallory, { t: MSG.HELLO, v: NET.protocolVersion, m: 'some-other-match' });
    say(mallory, { t: MSG.HELLO, v: NET.protocolVersion + 1, m: server.info.matchId });
    pump(0.5);
    assert.deepEqual(received.map((message) => [message.t, message.reason]), [[MSG.REFUSED, 'match'], [MSG.REFUSED, 'version']]);

    say(mallory, { t: MSG.HELLO, v: NET.protocolVersion, m: server.info.matchId });
    pump(0.5);
    assert.equal(received[2].t, MSG.WELCOME, 'the right hello is answered with the world');
    assert.equal(received[2].you, 'ann');
    assert.equal(received[2].ships.length, 1);
    assert.ok(received.some((message) => message.t === 'snapshot'), 'and snapshots follow');
});

test('inputs cannot fly a ship faster or turn it harder than the game allows', () => {
    const fair = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    const cheat = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    fair.run(0.5);
    cheat.run(0.5);
    fair.clients[0].controls.yaw = 1;
    fair.clients[0].controls.throttle = 1;
    fair.clients[0].controls.boost = true;
    // The cheat asks for a hundred times the deflection and floods inputs ten at a time.
    const ann = cheat.clients[0];
    let seq = 1e6;
    const honest = { speed: 0, turn: 0 };
    const cheater = { speed: 0, turn: 0 };
    for (let i = 0; i < 180; i++) {
        fair.step();
        for (let n = 0; n < 10; n++) ann.link.sendState(encodeInput(seq++, { ...createControls(), yaw: 100, throttle: 100, boost: true }));
        cheat.step();
        honest.speed = Math.max(honest.speed, serverShipOf(fair.server, 'ann').speed);
        honest.turn = Math.max(honest.turn, serverShipOf(fair.server, 'ann').angularVelocity.length());
        cheater.speed = Math.max(cheater.speed, serverShipOf(cheat.server, 'ann').speed);
        cheater.turn = Math.max(cheater.turn, serverShipOf(cheat.server, 'ann').angularVelocity.length());
    }

    assert.ok(cheater.speed <= honest.speed + 0.01, `never faster than an honest pilot flat out (${cheater.speed.toFixed(1)} vs ${honest.speed.toFixed(1)} m/s)`);
    assert.ok(cheater.turn <= honest.turn + 1e-3, 'never a tighter turn than full stick');
    // Flooding buys nothing either: inputs over the budget are simply not flown.
    assert.equal(cheat.server.pilots.get('ann').guard.strikes, 0);
});

test('a client cannot report its own position: the host only reads controls', () => {
    const match = createTestMatch(['host', 'ann'], { rules: arenaRules() });
    match.run(0.5);
    const ann = match.clients[0];
    const before = serverShipOf(match.server, 'ann').position.clone();

    // The client "teleports" its copy; its next snapshots pull it straight back.
    ann.world.player.position.set(9000, 9000, 9000);
    match.run(1);

    assert.ok(serverShipOf(match.server, 'ann').position.distanceTo(before) < 200, 'the real ship never left');
    assert.ok(ann.world.player.position.distanceTo(serverShipOf(match.server, 'ann').position) < 5, 'and the client is back in line');
});

test('made-up reliable messages do nothing to the world and count against the sender', () => {
    const match = createTestMatch(['host', 'ann'], { rules: withDrone() });
    match.run(0.5);
    const ann = match.clients[0];
    const drone = arenaWorld(match).ships.find((ship) => ship.classId === 'drone');
    const hostShip = serverShipOf(match.server, 'host');

    const forged = [
        ['destroy', drone.id, 1],
        { t: 'batch', e: [['destroy', drone.id, 1]] },
        { t: 'batch', e: [['score', 99999, 'drone', 99999]] },
        { t: 'welcome', ships: [] },
        { t: 'action', a: 'destroyShip', target: hostShip.id },
        { t: 'match', phase: 'victory' },
        'kill everyone',
    ];
    for (const message of forged) ann.link.sendMessage(typeof message === 'string' ? message : JSON.stringify(message));
    match.run(0.5);

    assert.equal(drone.alive, true);
    assert.equal(drone.hullFraction, 1);
    assert.equal(hostShip.alive, true);
    assert.equal(match.host.ui.match.phase, MATCH_PHASE.PLAYING);
    assert.equal(match.server.pilots.get('ann').guard.strikes, forged.length);
});

test('a client that floods rubbish is dropped and the others play on', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { rules: arenaRules() });
    match.run(0.5);
    const [ann, bo] = match.clients;

    for (let i = 0; i < NET.maxStrikes; i++) ann.link.sendState(new ArrayBuffer(5));
    match.run(0.5);

    assert.equal(ann.link.isOpen, false, 'the host hung up');
    assert.equal(serverShipOf(match.server, 'ann'), null);
    assert.equal(match.host.ui.match.players.some((player) => player.id === 'ann'), false);
    assert.equal(match.server.pilots.get('ann').gone, true);
    assert.equal(bo.ui.match.phase, MATCH_PHASE.PLAYING);
    assert.ok(shipOf(bo.world, 'bo'));
});

test('actions only ever act on the sender\'s own ship', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { rules: withDrone() });
    match.run(0.5);
    const [ann] = match.clients;

    // There is no field for "which ship": extra ones are dropped by the host.
    say(ann.link, { t: MSG.ACTION, a: 'power:attack', ship: serverShipOf(match.server, 'bo').id, pilotId: 'bo' });
    match.run(0.3);

    assert.equal(serverShipOf(match.server, 'ann').powerMode, 'attack');
    assert.equal(serverShipOf(match.server, 'bo').powerMode, 'balanced');
    assert.equal(serverShipOf(match.server, 'host').powerMode, 'balanced');
});

test('a dead player\'s inputs and actions fly nothing', () => {
    const match = createTestMatch(['host', 'ann'], { rules: withDrone() });
    match.run(0.5);
    const ann = match.clients[0];
    destroyShip(arenaWorld(match), serverShipOf(match.server, 'ann'));
    match.run(0.3);

    say(ann.link, { t: MSG.ACTION, a: 'cycleTarget' });
    ann.link.sendState(encodeInput(1e6, { ...createControls(), firePrimary: true, fireSecondary: true }));
    match.run(1);

    assert.equal(serverShipOf(match.server, 'ann'), null);
    assert.equal(arenaWorld(match).projectiles.filter((projectile) => projectile.owner.pilotId === 'ann').length, 0);
    assert.equal(arenaWorld(match).ships.find((ship) => ship.classId === 'drone').hullFraction, 1);
});

test('a corrupt snapshot or batch from the host cannot crash a client', () => {
    const match = createTestMatch(['host', 'ann'], { rules: withDrone() });
    match.run(0.5);
    const ann = match.clients[0];
    const shipsBefore = ann.world.ships.length;

    const rubbish = [
        '{"t":"batch","e":"nope"}',
        '{"t":"batch","e":[null, 5, "x", [], ["spawn", null], ["spawn", {"id":999,"classId":"no-such-ship"}], ["spawn", {"id":998,"classId":"drone","position":[0,"a",0],"quaternion":[0,0,0,1]}]]}',
        '{"t":"batch","e":[["destroy", 123456, 0], ["remove", "x", 1], ["hit", 1, "a", 0, 0, 0, 5], ["gone", 77, 1, 0, 0, 0], ["rock", -5], ["lance", 1, 99, 1]]}',
        '{"t":"batch","e":[["stage", "enterTitle"], ["stage", "newGame", "x"], ["stage", "setHint", {"evil":true}], ["match", {"phase":"nonsense","players":[]}], ["score", "many"]]}',
        '{"t":"batch","e":[["fire", {"id":5,"kind":"nuke","weaponId":"playerBeam","ownerId":1,"position":[0,0,0],"velocity":[0,0,0],"life":1}]]}',
        'not json at all',
    ];
    for (const text of rubbish) ann.serverLink.sendMessage(text);
    ann.serverLink.sendState(new ArrayBuffer(7));
    ann.serverLink.sendState(new Uint8Array(400).fill(255).buffer);
    match.run(0.5);

    assert.equal(ann.world.ships.length, shipsBefore, 'nothing was added or removed');
    assert.equal(ann.session.phase, 'playing', 'and the client did not leave the match or change screens');
    assert.equal(ann.ui.match.phase, MATCH_PHASE.PLAYING);
});
