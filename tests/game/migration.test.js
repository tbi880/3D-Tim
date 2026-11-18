import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { destroyShip } from '../../src/game/core/systems/damage.js';
import { BR_REQUEST } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { EQUIPMENT } from '../../src/game/modes/battleRoyale/equipment.js';
import { STATION_TAG } from '../../src/game/modes/battleRoyale/station.js';
import { gameModeOf } from '../../src/game/modes/index.js';
import { measureStepCost } from '../../src/game/net/lobby/hostFitness.js';
import { normalizeMatchInfo } from '../../src/game/net/match/matchInfo.js';
import { NET } from '../../src/game/net/netConfig.js';
import { packSnapshot, unpackSnapshot } from '../../src/game/net/lobby/matchSnapshot.js';
import { MSG } from '../../src/game/net/protocol.js';
import { MatchServer } from '../../src/game/net/server/MatchServer.js';
import { createMemoryLinkPair } from '../../src/game/net/transport/MemoryLink.js';
import { createTestMatch, createTestServer } from './support/matchHarness.js';

/**
 * Handing a match from one device to another: the checkpoint a host writes, a server going
 * on from one, who is next in line, and what a client does when its host falls silent.
 * (Devices finding each other and taking over are in lan.test.js.)
 */

const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);

/** A second server for the same match, going on from the first one's checkpoint as it would arrive: as JSON text. */
function resumeFrom(game, { hostPlayerId = game.info.players.at(-1).id, checkpoint = JSON.parse(JSON.stringify(game.server.capture())) } = {}) {
    const server = new MatchServer({ info: game.info, mode: gameModeOf(game.info).createRules(game.info), hostPlayerId, checkpoint, term: 1, now: () => 0 });
    server.start();
    return server;
}

const describe = (server) => ({
    time: Math.round(server.time * 10) / 10,
    zones: [...server.zones.values()].map((zone) => `${zone.id}:${zone.world.ships.length}:${zone.destroyedRocks.length}`),
    places: [...server.mode.places.values()].map((place) => `${place.planet.id}:${place.owner}:${place.status}:${[...place.scouts]}`),
    contestants: [...server.mode.contestants.values()].map((who) => ({
        id: who.pilot.id, bot: who.pilot.bot, faction: who.faction, alive: who.alive, zone: who.pilot.zone?.id ?? null,
        score: who.score, kills: who.kills, points: who.points, summons: who.summons, picks: who.inventory.picks, items: who.inventory.describe(),
        hull: Math.round(who.pilot.ship?.hull ?? 0), shield: Math.round(who.pilot.ship?.shield ?? 0), upgrades: who.pilot.upgrades,
    })),
});

// ---- The checkpoint --------------------------------------------------------------------------

test('a match resumed from a checkpoint is the match that was captured', () => {
    const game = createTestServer(['ann', 'bo'], { start: { seed: 3, settings: { bots: 'fill', pace: 'quick' } } });
    game.run(70);
    const before = describe(game.server);

    const next = resumeFrom(game);

    assert.deepEqual(describe(next), before);
    assert.equal(next.hostPlayerId, 'bo');
    assert.equal(next.term, 1);
    assert.equal([...next.pilots.values()].filter((pilot) => pilot.bot).length, BATTLE_ROYALE.bots.fillTo - 2, 'the bots are back in their seats');
    for (const place of next.mode.places.values()) assert.equal(place.station.ship, place.zone.world.findByTag(STATION_TAG), `${place.planet.id} has its station`);
});

test('an ability still recharging, and a shield held down, go on from where they were', () => {
    const game = createTestServer(['ann', 'bo'], { start: { seed: 3, settings: { bots: 'none', pace: 'quick' } } });
    game.run(1);
    const ship = game.server.pilots.get('ann').ship;
    ship.ability.cooldown = 17;
    ship.shield = 0;
    ship.shieldDown = 6;

    const resumed = resumeFrom(game).pilots.get('ann').ship;

    assert.equal(resumed.ability.def, ship.ability.def);
    assert.deepEqual([resumed.ability.cooldown, resumed.ability.active, resumed.shieldDown, resumed.cloaked], [17, 0, 6, false]);
});

test('a checkpoint is plain data, small enough to send every few seconds', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: { settings: { bots: 'fill' } } });
    game.run(30);
    const text = JSON.stringify(game.server.capture());

    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(game.server.capture())), 'nothing in it is lost in JSON (no Infinity, no objects of the game\'s own)');
    assert.ok(text.length < NET.checkpointChunk * NET.checkpointMaxChunks, `${text.length} characters`);
    assert.ok(text.length < 80000, `${text.length} characters for six pilots and six garrisoned planets`);
});

test('what was going on goes on: a jump being spooled, a docking, equipment in use', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: { settings: {} } });
    const { mode, server } = game;
    const [ann, bo, cy] = ['ann', 'bo', 'cy'].map((id) => mode.contestants.get(id));
    const ask = (who, request, data = {}) => mode.onRequest(who.pilot, request, data);
    // Ann is spooling a jump; Bo is docked; Cy has taken a gravity shield and refit points.
    ann.jumpReadyAt = 0;
    const annFrom = ann.pilot.zone.id;
    const annTo = mode.map.neighbours(annFrom)[0];
    ask(ann, BR_REQUEST.JUMP, { to: annTo });
    const boPlace = mode.placeOf(bo);
    for (const ship of [...boPlace.zone.world.ships]) if (!ship.isPlayer && ship.faction !== FACTION.NEUTRAL) boPlace.zone.world.removeShip(ship);
    bo.pilot.ship.position.copy(boPlace.station.mouth);
    ask(bo, BR_REQUEST.DOCK);
    ask(cy, BR_REQUEST.PICK, { item: EQUIPMENT.GRAVITY_SHIELD });
    cy.points = 2;
    ask(cy, BR_REQUEST.REFIT, { added: { hull: 2 } });
    game.run(1);

    const next = resumeFrom(game, { hostPlayerId: 'cy' });
    const [ann2, bo2, cy2] = ['ann', 'bo', 'cy'].map((id) => next.mode.contestants.get(id));

    assert.equal(ann2.jump.to, annTo);
    assert.ok(Math.abs(ann2.jump.left - ann.jump.left) < 0.01);
    assert.ok(Math.abs(bo2.dock.left - bo.dock.left) < 0.01, 'the docking has as long to go');
    assert.equal(bo2.dock.place.planet.id, boPlace.planet.id);
    assert.equal(bo2.pilot.helmHeld, true);
    assert.equal(cy2.inventory.counts.gravityShield, 1);
    assert.deepEqual(cy2.pilot.upgrades, { hull: 2 });
    assert.equal(cy2.pilot.ship.maxHull, cy.pilot.ship.maxHull, 'the refit is in the rebuilt ship');
    assert.ok(Math.abs((next.mode.clock.secondsToChange(0) ?? 0) - (mode.clock.secondsToChange(0) ?? 0)) < 0.01, 'the sun collapses to the same timetable');

    // And it plays on: the jump lands, the docking completes.
    for (let step = 0; step < 30 * (BATTLE_ROYALE.station.seconds + 1); step++) next.update(1 / 30);
    assert.equal(ann2.pilot.zone.id, annTo);
    assert.equal(next.mode.places.get(boPlace.planet.id).owner, bo2.faction);
    assert.equal(server.pilots.get('bo').zone.id, bo2.pilot.zone.id);
});

test('a player who has left stays out, and the dead stay dead until they come back', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: { settings: {} } });
    game.server.removePlayer('bo');
    const cy = game.mode.contestants.get('cy');
    const cyZone = cy.pilot.zone.id;
    cy.pilot.zone.world.removeShip(cy.pilot.ship);
    cy.pilot.ship = null;
    cy.alive = false;
    game.run(0.5);

    const next = resumeFrom(game, { hostPlayerId: 'ann' });

    assert.equal(next.pilots.get('bo').gone, true);
    assert.equal(next.pilots.get('bo').ship, null);
    assert.equal(next.mode.contestants.get('cy').alive, false);
    assert.equal(next.pilots.get('cy').ship, null);
    assert.equal(typeof cyZone, 'string');
});

test('a pilot waiting to come back waits on where they were on the new host, and their waits keep growing', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: { settings: {} } });
    const cy = game.mode.contestants.get('cy');
    const station = [...game.mode.places.values()].find((place) => place.zone !== cy.pilot.zone);
    station.owner = cy.faction;
    cy.respawns = 2;
    destroyShip(cy.pilot.zone.world, cy.pilot.ship, null);
    game.run(3);
    const left = cy.respawnAt - game.server.time;

    const next = resumeFrom(game, { hostPlayerId: 'ann' });
    const cy2 = next.mode.contestants.get('cy');

    assert.equal(cy2.alive, false);
    assert.equal(cy2.respawns, 2);
    assert.ok(Math.abs((cy2.respawnAt - next.time) - left) < 0.01, 'the same wait left');
    assert.equal(left > BATTLE_ROYALE.respawn.wait, true, 'the third wait is the longest yet');
    for (let step = 0; step < 30 * (left + 0.5); step++) next.update(1 / 30);
    next.mode.onRequest(cy2.pilot, BR_REQUEST.RESPAWN, { at: station.planet.id });
    assert.equal(cy2.alive, true);
    assert.equal(cy2.pilot.zone.id, station.planet.id);
    assert.equal(cy2.respawns, 3);
});

test('a checkpoint of another match, or of another version, is refused', () => {
    const game = createTestServer(['ann', 'bo']);
    const checkpoint = JSON.parse(JSON.stringify(game.server.capture()));

    assert.throws(() => resumeFrom(game, { checkpoint: { ...checkpoint, matchId: 'another' } }));
    assert.throws(() => resumeFrom(game, { checkpoint: { ...checkpoint, v: NET.protocolVersion + 1 } }));
    assert.throws(() => resumeFrom(game, { checkpoint: {} }));
});

test('rubbish in a checkpoint is left out, not built', () => {
    const game = createTestServer(['ann', 'bo'], { start: { settings: { bots: 'fill' } } });
    game.run(2);
    const checkpoint = JSON.parse(JSON.stringify(game.server.capture()));
    const [first] = PLANETS;
    checkpoint.time = 'late';
    checkpoint.pilots.push({ id: 'ghost', name: 'Ghost', classId: 'kestrel', bot: false }, { id: 'bot:99', bot: true, classId: 'deathStar' }, null, 7);
    checkpoint.zones[first].ships.push(
        { classId: 'deathStar', position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        { classId: 'drone', position: ['x', 0, 0], quaternion: [0, 0, 0, 1] },
        { classId: 'drone', position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: -50, shield: 1e12, energy: 'full' },
        { classId: 'drone', position: [0, 0, 0], quaternion: [0, 0, 0, 1], parent: 9999 },
        { classId: 'kestrel', position: [0, 0, 0], quaternion: [0, 0, 0, 1], pilotId: 'ghost', hull: NaN },
        null,
    );
    checkpoint.zones[PLANETS[1]] = 'gone';
    checkpoint.mode.places.push({ id: 'pluto', owner: 'admin' });
    checkpoint.mode.contestants.push({ id: 'ann', faction: 'gods', score: -5, points: 1e9 }, { id: 'ghost' });
    checkpoint.mode.clock = { schedule: 'soon' };
    const shipsBefore = game.server.zones.get(first).world.ships.length;

    const next = resumeFrom(game, { checkpoint });

    assert.equal(next.time, 0);
    assert.equal(next.pilots.has('ghost'), false, 'nobody joins a match through a checkpoint');
    assert.equal(next.pilots.has('bot:99'), false);
    const ships = next.zones.get(first).world.ships;
    assert.equal(ships.length, shipsBefore + 1, 'of the made-up ships only the one that is a ship was built');
    assert.ok(ships.every((ship) => ship.hull > 0 && ship.hull <= ship.maxHull && ship.shield <= ship.maxShield && Number.isFinite(ship.energy)));
    assert.equal(ships.some((ship) => ship.pilotId === 'ghost'), false);
    assert.ok(next.zones.get(PLANETS[1]).world.findByTag(STATION_TAG), 'a planet whose zone was missing still has its station');
    assert.ok(Object.values(FACTION).includes(next.mode.contestants.get('ann').faction));
    assert.ok(next.mode.clock.schedule.length === PLANETS.length - 1, 'a broken timetable is replaced by a new one');
    for (let step = 0; step < 60; step++) next.update(1 / 30);
});

// ---- Who is next in line ---------------------------------------------------------------------

/** A server with a link (never read) for each player, so every one of them could take over. */
function linkedServer(names, reports = {}) {
    const game = createTestServer(names);
    const { server } = game;
    const links = {};
    for (const name of names) {
        const [serverEnd, clientEnd] = createMemoryLinkPair();
        links[name] = clientEnd;
        clientEnd.received = [];
        clientEnd.onMessage = (text) => clientEnd.received.push(JSON.parse(text));
        server.attachLink(name, serverEnd);
        clientEnd.sendMessage(JSON.stringify({ t: MSG.HELLO, v: NET.protocolVersion, m: game.info.matchId }));
        if (reports[name]) clientEnd.sendMessage(JSON.stringify({ t: MSG.LINKS, c: reports[name].c, r: reports[name].r }));
        serverEnd.deliver();
    }
    const pump = () => { for (const link of Object.values(links)) link.deliver(); };
    return { ...game, links, pump };
}

test('with nothing reported the line of succession is the lobby\'s, without the host', () => {
    const { server } = linkedServer(['host', 'ann', 'bo', 'cy']);
    assert.deepEqual(server.rankSuccessors(), ['ann', 'bo', 'cy']);
});

test('the next host is the device nearest the others, a fast one before a slow one', () => {
    const near = linkedServer(['host', 'ann', 'bo', 'cy'], {
        ann: { c: 0.1, r: { bo: 200, cy: 220 } },
        bo: { c: 0.1, r: { ann: 200, cy: 20 } },
        cy: { c: 0.1, r: { ann: 220, bo: 20 } },
    });
    assert.deepEqual(near.server.rankSuccessors(), ['bo', 'cy', 'ann']);

    const fast = linkedServer(['host', 'ann', 'bo', 'cy'], {
        ann: { c: 4, r: { bo: 30, cy: 30 } },
        bo: { c: 0.1, r: { ann: 30, cy: 40 } },
        cy: { c: 1, r: { ann: 30, bo: 40 } },
    });
    assert.deepEqual(fast.server.rankSuccessors(), ['bo', 'cy', 'ann']);
});

test('a device that is not linked to everybody, has left, or is a bot is not put first', () => {
    const { server } = linkedServer(['host', 'ann', 'bo', 'cy'], {
        ann: { c: 0.1, r: { bo: 10 } },
        bo: { c: 0.1, r: { ann: 10, cy: 90 } },
        cy: { c: 0.1, r: { bo: 90 } },
    });
    assert.equal(server.rankSuccessors()[0], 'bo', 'only Bo reaches both of the others');

    server.removePlayer('bo');
    assert.deepEqual(server.rankSuccessors(), ['ann', 'cy']);
    const withBots = createTestServer(['host'], { start: { settings: { bots: 'fill' } } });
    assert.deepEqual(withBots.server.rankSuccessors(), [], 'a bot has no device to take a match over on');
});

test('everybody is told the line; only the first two in it are sent the checkpoint, in pieces', () => {
    const { server, links, pump, run } = linkedServer(['host', 'ann', 'bo', 'cy']);
    run(0.2);
    pump();

    const of = (name, type) => links[name].received.filter((message) => message.t === type);
    for (const name of ['host', 'ann', 'bo', 'cy']) {
        assert.deepEqual(of(name, MSG.SUCCESSION).at(-1), { t: MSG.SUCCESSION, o: ['ann', 'bo', 'cy'], n: 0 });
    }
    assert.equal(of('cy', MSG.CHECKPOINT).length, 0, 'third in line: no checkpoint');
    assert.equal(of('host', MSG.CHECKPOINT).length, 0, 'nor the host itself');
    for (const name of ['ann', 'bo']) {
        const pieces = of(name, MSG.CHECKPOINT);
        assert.ok(pieces.length > 1, 'more than one piece');
        assert.ok(pieces.every((piece) => piece.d.length <= NET.checkpointChunk && piece.n === pieces.length && piece.id === pieces[0].id));
        const whole = JSON.parse(pieces.sort((a, b) => a.i - b.i).map((piece) => piece.d).join(''));
        assert.equal(whole.matchId, server.info.matchId);
        assert.equal(Object.keys(whole.zones).length, PLANETS.length);
    }

    const before = of('ann', MSG.CHECKPOINT).length;
    run(NET.checkpointInterval + 0.1);
    pump();
    assert.ok(of('ann', MSG.CHECKPOINT).length > before, 'and again every few seconds');
});

test('a game mode that cannot hand itself on sends no checkpoints and names no line', () => {
    const arena = { setup() {}, update() {}, onShipDestroyed() {}, onRequest() {}, describeState: () => ({ mode: 'arena', phase: 'playing', players: [] }) };
    const game = createTestServer(['host', 'ann'], { rules: arena });
    const [serverEnd, clientEnd] = createMemoryLinkPair();
    const received = [];
    clientEnd.onMessage = (text) => received.push(JSON.parse(text).t);
    game.server.attachLink('ann', serverEnd);
    clientEnd.sendMessage(JSON.stringify({ t: MSG.HELLO, v: NET.protocolVersion, m: game.info.matchId }));
    serverEnd.deliver();
    game.run(NET.checkpointInterval * 2);
    clientEnd.deliver();

    assert.equal(game.server.canMigrate, false);
    assert.equal(received.includes(MSG.CHECKPOINT) || received.includes(MSG.SUCCESSION), false);
});

test('the lobby\'s order of succession is cleaned: players of this match only, each once, the host first', () => {
    const start = (succession, hostPlayerId = 'b') => normalizeMatchInfo({
        matchId: 'm', seed: 1, hostPlayerId, mode: 'battleRoyale', succession,
        players: ['a', 'b', 'c'].map((id) => ({ playerId: id, displayName: id, shipClassId: 'kestrel' })),
    }).succession;

    assert.deepEqual(start(['b', 'c', 'a']), ['b', 'c', 'a']);
    assert.deepEqual(start(['c', 'stranger', 'c', 5, null, 'a']), ['b', 'c', 'a'], 'the host leads whatever the list says');
    assert.deepEqual(start(undefined), ['b', 'a', 'c']);
    assert.deepEqual(start('abc', 'a'), ['a', 'b', 'c']);
    assert.deepEqual(start(['a'], 'nobody'), ['a', 'b', 'c'], 'a host that is not a player hosts nothing');
});

// ---- A client whose host falls silent --------------------------------------------------------

test('a client with somebody to turn to gives up on a silent host sooner, and stands still instead of ending', () => {
    const match = createTestMatch(['host', 'ann', 'bo']);
    match.run(1);
    const [ann, bo] = match.clients;
    let asked = 0;
    ann.match.onHostLost = () => { asked += 1; return true; };
    const frozenAt = ann.world.player.position.clone();

    // The host stops: nothing is sent any more, though the links stay up.
    const hostOnly = match.devices[0];
    const silent = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
            match.advanceClock(1 / 30);
            for (const client of [ann, bo]) client.session.update(1 / 30, client.controls);
        }
    };
    silent(NET.hostLostTimeout - 0.5);
    assert.equal(asked, 0, 'not yet');
    silent(1);

    assert.equal(asked, 1);
    assert.equal(ann.match.migrating, true);
    assert.equal(ann.ui.match.phase, 'playing', 'the match is not over for Ann');
    assert.equal(ann.ui.toast?.key, 'mp.host.lost');
    ann.controls.throttleTarget = 1;
    silent(1);
    assert.ok(ann.world.player.position.distanceTo(frozenAt) < 60, 'her picture stands still while she waits');

    assert.notEqual(bo.ui.match.phase, 'disconnected', 'Bo, with nobody to turn to, waits the full time...');
    silent(NET.linkTimeout - NET.hostLostTimeout);
    assert.equal(bo.ui.match.phase, 'disconnected', '...and then it is over for him');
    assert.equal(typeof hostOnly.id, 'string');
});

test('a client waits longer for the first word from its host, which may still be setting the match up', () => {
    const match = createTestMatch(['host', 'ann']);
    const [ann] = match.clients;
    let asked = 0;
    ann.match.onHostLost = () => { asked += 1; return true; };
    // The host's device is busy with its first frames of the match: it runs nothing and says nothing.
    const hostBusy = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
            match.advanceClock(1 / 30);
            ann.session.update(1 / 30, ann.controls);
        }
    };
    hostBusy(NET.firstContactTimeout - 1);
    assert.equal(asked, 0, 'Ann is still waiting');
    assert.ok(NET.firstContactTimeout > NET.hostLostTimeout);

    // The host comes round and answers her hello (she has been repeating it). From then on the usual patience applies.
    match.run(1);
    assert.equal(ann.match.welcomed, true);
    hostBusy(NET.hostLostTimeout + 0.5);
    assert.equal(asked, 1);
});

test('a client whose own page stopped does not hold that against its host', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(1);
    const [ann] = match.clients;
    let asked = 0;
    ann.match.onHostLost = () => { asked += 1; return true; };

    // Nothing runs on Ann's device for a while (her page was in the background, or busy with a scene).
    match.advanceClock(NET.hostLostTimeout * 3);
    ann.session.update(1 / 30, ann.controls);
    assert.equal(asked, 0, 'coming back is no reason to give the host up');

    // Silence once she is back counts as before.
    const silent = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
            match.advanceClock(1 / 30);
            ann.session.update(1 / 30, ann.controls);
        }
    };
    silent(NET.hostLostTimeout - 0.5);
    assert.equal(asked, 0);
    silent(1);
    assert.equal(asked, 1);
});

test('what reaches a client while its page is stopped counts when it arrived, not when the page reads it', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(1);
    const [ann] = match.clients;
    let asked = 0;
    ann.match.onHostLost = () => { asked += 1; return true; };
    // Ann's page stops; the host goes on, and what it sends arrives on her device.
    for (let elapsed = 0; elapsed < NET.hostLostTimeout * 2; elapsed += 1 / 30) {
        match.advanceClock(1 / 30);
        for (const link of match.links) link.deliver();
        match.host.session.update(1 / 30, match.host.controls);
        for (const link of match.links) link.deliver();
    }
    ann.session.update(1 / 30, ann.controls);
    assert.equal(asked, 0);
    assert.ok(match.clock() - ann.match.lastHeardAt < 0.1, 'heard just now');
});

test('a client given another link asks it for the world, again and again until it answers', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(1);
    const [ann] = match.clients;
    ann.match.onHostLost = () => true;
    ann.match.hostLost();
    const [nearEnd, farEnd] = createMemoryLinkPair({ clock: match.clock });
    const hellos = [];
    farEnd.onMessage = (text) => hellos.push(JSON.parse(text));

    ann.match.switchLink(nearEnd);
    farEnd.deliver();
    assert.deepEqual(hellos, [{ t: MSG.HELLO, v: NET.protocolVersion, m: match.info.matchId }]);
    assert.equal(ann.link.onMessage, null, 'the old link is let go, not closed');
    assert.equal(ann.link.isOpen, true);

    for (let elapsed = 0; elapsed < 4; elapsed += 1 / 30) {
        match.advanceClock(1 / 30);
        ann.session.update(1 / 30, ann.controls);
    }
    farEnd.deliver();
    assert.ok(hellos.length >= 3, `${hellos.length} requests in four seconds of silence`);
    assert.equal(ann.match.migrating, true);
});

test('a checkpoint arrives in pieces, in any order; only a whole one counts, and the newest wins', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    const client = match.clients[0].match;
    client.latestCheckpoint = null;
    const piece = (id, i, n, d) => client.onMessage(JSON.stringify({ t: MSG.CHECKPOINT, id, i, n, d }));

    piece(7, 2, 3, 'c');
    piece(7, 0, 3, 'a');
    assert.equal(client.latestCheckpoint, null, 'two of three');
    piece(7, 0, 3, 'X');
    piece(7, 1, 3, 'b');
    assert.equal(client.latestCheckpoint, 'abc', 'a piece sent twice does not overwrite');

    piece(8, 0, 2, 'new-');
    assert.equal(client.latestCheckpoint, 'abc', 'the old one stands until the new one is whole');
    piece(8, 1, 2, 'one');
    assert.equal(client.latestCheckpoint, 'new-one');

    for (const junk of [[9, 0, 0, 'x'], [9, 5, 2, 'x'], [9, -1, 2, 'x'], ['9', 0, 1, 'x'], [9, 0, 1, 5], [9, 0, NET.checkpointMaxChunks + 1, 'x'], [9, 0, 1, 'x'.repeat(NET.checkpointChunk + 1)]]) piece(...junk);
    assert.equal(client.latestCheckpoint, 'new-one');
});

test('a client keeps the line of succession and the term the host last named', () => {
    const match = createTestMatch(['host', 'ann', 'bo']);
    match.run(0.5);
    const client = match.clients[0].match;
    assert.deepEqual(client.succession, ['ann', 'bo']);
    assert.equal(client.term, 0);

    client.onMessage(JSON.stringify({ t: MSG.SUCCESSION, o: ['bo', 7, 'ann', null], n: 2 }));
    assert.deepEqual(client.succession, ['bo', 'ann']);
    assert.equal(client.term, 2);
    client.onMessage(JSON.stringify({ t: MSG.SUCCESSION, o: 'everyone', n: 9 }));
    client.onMessage(JSON.stringify({ t: MSG.SUCCESSION, o: ['ann'], n: 1 }));
    assert.deepEqual(client.succession, ['ann']);
    assert.equal(client.term, 2, 'a term never goes back');
});

// ---- How fast a device simulates -------------------------------------------------------------

test('the benchmark gives a small positive number of milliseconds, by the clock it is given', () => {
    const real = measureStepCost();
    assert.ok(real > 0 && real < 1000, `${real} ms a step on this machine`);

    let time = 0;
    assert.equal(measureStepCost(() => { time += 100; return time; }), 2.5, '100 ms for 40 steps');
});

// ---- Across the internet: a player who is away, and the server's snapshots -------------------

test('across the internet a player whose link breaks keeps their ship for a while, and flies it again on a new link', () => {
    const match = createTestMatch(['host', 'ann', 'bo']);
    const { server } = match;
    server.rejoinGrace = NET.rejoinGrace;
    match.run(1);
    const ann = server.pilots.get('ann');
    const ship = ann.ship;
    assert.ok(ship?.alive);

    match.clients[0].link.close();
    match.run(NET.rejoinGrace / 2);
    assert.equal(ann.gone, false, 'away, not gone');
    assert.equal(ann.link, null);
    assert.equal(ann.ship, ship, 'the same ship, still in the match');
    assert.ok(ship.alive);
    assert.equal(server.rankSuccessors().includes('ann'), false, 'not in line while away');

    // Her device is back on a new link: she is in her own ship again.
    const [serverEnd, clientEnd] = createMemoryLinkPair();
    const received = [];
    clientEnd.onMessage = (text) => received.push(JSON.parse(text));
    assert.equal(server.attachLink('ann', serverEnd), true);
    clientEnd.sendMessage(JSON.stringify({ t: MSG.HELLO, v: NET.protocolVersion, m: match.info.matchId }));
    serverEnd.deliver();
    match.run(0.1);
    clientEnd.deliver();
    const welcome = received.find((message) => message.t === MSG.WELCOME);
    assert.ok(welcome.ships.some((description) => description.id === ship.id && description.pilotId === 'ann'));
    assert.equal(ann.awayUntil, null);

    // Bo's link breaks and stays broken: after the grace he is out.
    match.clients[1].link.close();
    match.run(NET.rejoinGrace + 1);
    assert.equal(server.pilots.get('bo').gone, true);
    assert.equal(server.pilots.get('ann').gone, false);
});

test('on one Wi-Fi a player whose link breaks is out at once, as before', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);

    match.clients[0].link.close();
    match.run(0.1);

    assert.equal(match.server.pilots.get('ann').gone, true);
});

test('the server is offered a snapshot every second, when somebody listens', () => {
    const match = createTestMatch(['host', 'ann']);
    let due = 0;
    match.run(2);
    assert.equal(due, 0);
    match.server.onSnapshotDue = () => { due += 1; };
    match.run(3.05);
    assert.ok(due >= 3 && due <= 4, `${due} in three seconds`);
});

test('a snapshot for the server is the checkpoint, about a tenth of its size, and comes back as it was', async () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { start: { settings: { bots: 'fill' } } });
    match.run(3);
    const text = JSON.stringify(match.server.capture());

    const packed = await packSnapshot(text);

    assert.match(packed, /^[A-Za-z0-9+/]+=*$/);
    assert.ok(packed.length < text.length / 5, `${packed.length} characters for ${text.length}`);
    assert.ok(packed.length < NET.serverSnapshotMaxChars);
    assert.equal(await unpackSnapshot(packed), text);
    const server = resumeFrom(match, { checkpoint: JSON.parse(await unpackSnapshot(packed)) });
    assert.deepEqual(describe(server), describe(match.server));
});

test('what does not unpack to a snapshot of reasonable size is nothing', async () => {
    assert.equal(await unpackSnapshot(null), null);
    assert.equal(await unpackSnapshot('not base64 at all!'), null);
    assert.equal(await unpackSnapshot(btoa('plain text, not gzip')), null);
    assert.equal(await unpackSnapshot(await packSnapshot('x'.repeat(5000)), 1000), null, 'too long once unpacked');
});
