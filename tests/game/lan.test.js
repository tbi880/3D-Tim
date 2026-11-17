import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_KIND, describeDevice } from '../../src/game/net/lobby/deviceInfo.js';
import { LAN_ERROR, LAN_STATUS, LOBBY_SCOPE, LanMultiplayer, ROOM_STATE, ROOM_VISIBILITY, cleanName, initialLanState } from '../../src/game/net/lobby/LanMultiplayer.js';
import { LOBBY_ERROR, LobbyClient, LobbyError } from '../../src/game/net/lobby/LobbyClient.js';
import { unpackSnapshot } from '../../src/game/net/lobby/matchSnapshot.js';
import { ICE_SERVERS, NET, cleanIceServers } from '../../src/game/net/netConfig.js';
import { LINK_STATUS } from '../../src/game/net/transport/PeerLink.js';
import { PHASE } from '../../src/game/state/GameSession.js';
import { FAKE_AUTO_START_SECONDS, FakeLobbyServer, FakeNetwork } from './support/fakeLobby.js';
import { createTestSession, idle } from './support/matchHarness.js';

// ---- Devices ---------------------------------------------------------------------------------

const UA = {
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    pico: 'Mozilla/5.0 (X11; Linux x86_64; Pico 4 OS5.8.2 like Quest) AppleWebKit/537.36 (KHTML, like Gecko) PicoBrowser/3.3.38 Chrome/105.0.5195.68 VR Safari/537.36',
    quest: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 Chrome/128.0.0.0 VR Safari/537.36',
};

test('computers, phones and headsets are told apart and described', () => {
    assert.deepEqual(describeDevice(UA.macChrome), { kind: DEVICE_KIND.DESKTOP, name: 'Chrome · macOS' });
    assert.deepEqual(describeDevice(UA.macSafari), { kind: DEVICE_KIND.DESKTOP, name: 'Safari · macOS' });
    assert.deepEqual(describeDevice(UA.winEdge), { kind: DEVICE_KIND.DESKTOP, name: 'Edge · Windows' });
    assert.deepEqual(describeDevice(UA.winFirefox), { kind: DEVICE_KIND.DESKTOP, name: 'Firefox · Windows' });
    assert.deepEqual(describeDevice(UA.iphone, true), { kind: DEVICE_KIND.MOBILE, name: 'Safari · iPhone' });
    assert.deepEqual(describeDevice(UA.android, true), { kind: DEVICE_KIND.MOBILE, name: 'Chrome · Android' });
    assert.deepEqual(describeDevice(UA.pico, true), { kind: DEVICE_KIND.VR, name: 'Pico · Pico Browser' });
    assert.deepEqual(describeDevice(UA.quest), { kind: DEVICE_KIND.VR, name: 'Meta Quest · Meta Browser' });
});

test('an iPad pretending to be a Mac is still a tablet, and nonsense is still a device', () => {
    assert.deepEqual(describeDevice(UA.macSafari, true), { kind: DEVICE_KIND.MOBILE, name: 'Safari · iPad' });
    assert.deepEqual(describeDevice(''), { kind: DEVICE_KIND.DESKTOP, name: 'Browser · Unknown device' });
    assert.deepEqual(describeDevice(undefined), { kind: DEVICE_KIND.DESKTOP, name: 'Browser · Unknown device' });
});

test('names are trimmed, single-spaced and capped', () => {
    assert.equal(cleanName('  Captain   Tim  '), 'Captain Tim');
    assert.equal(cleanName('x'.repeat(50)).length, 20);
    assert.equal(cleanName(null), '');
});

// ---- LobbyClient -----------------------------------------------------------------------------

/** A stand-in for @microsoft/signalr that records what the client does with it. */
function fakeSignalR({ failStart = false, invoke = async () => null } = {}) {
    const log = { url: null, options: null, events: [], invoked: [], stopped: 0, closeHandler: null };
    const connection = {
        on: (event) => log.events.push(event),
        onclose: (handler) => { log.closeHandler = handler; },
        start: async () => { if (failStart) throw new Error('no route to host'); },
        stop: async () => { log.stopped += 1; },
        invoke: async (method, ...args) => {
            log.invoked.push([method, ...args]);
            return invoke(method, ...args);
        },
    };
    class HubConnectionBuilder {
        withUrl(url, options) { log.url = url; log.options = options; return this; }
        configureLogging() { return this; }
        build() { return connection; }
    }
    return { signalR: { HubConnectionBuilder, LogLevel: { Warning: 3 } }, log };
}

test('the client connects as a guest without a token, and with one when signed in', async () => {
    const guest = fakeSignalR({ invoke: async () => ({ playerId: 'p1', isGuest: true }) });
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR: guest.signalR, handlers: {} });
    assert.deepEqual(await client.connect(), { playerId: 'p1', isGuest: true });
    assert.equal(guest.log.url, '/hub');
    assert.equal(guest.log.options.accessTokenFactory, undefined);
    assert.deepEqual(guest.log.invoked, [['GetSession']]);
    assert.deepEqual(guest.log.events.sort(), ['Kicked', 'MatchHostChanged', 'MatchStarted', 'RoomClosed', 'RoomListChanged', 'RoomUpdated', 'Signal']);

    const account = fakeSignalR();
    await new LobbyClient({ url: '/hub', getToken: () => 'jwt', signalR: account.signalR, handlers: {} }).connect();
    assert.equal(account.log.options.accessTokenFactory(), 'jwt');
});

test('requests go to the hub under its method names', async () => {
    const { signalR, log } = fakeSignalR();
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: {} });
    await client.connect();
    const profile = { displayName: 'Tim' };

    await client.createRoom(profile, { mode: 'battleRoyale' });
    await client.joinRoom('ABCDE', profile);
    await client.setReady(true);
    await client.sendSignal('p2', 'offer', 'sdp');
    await client.startMatch();
    await client.leaveRoom();
    await client.quickMatch(profile, { mode: 'battleRoyale', avoid: ['ABCDE'] });
    await client.getIceServers();
    await client.kickPlayer('p2');

    assert.deepEqual(log.invoked.slice(1), [
        ['CreateRoom', profile, { mode: 'battleRoyale' }], ['JoinRoom', 'ABCDE', profile], ['SetReady', true],
        ['SendSignal', 'p2', 'offer', 'sdp'], ['StartMatch'], ['LeaveRoom'],
        ['QuickMatch', profile, { mode: 'battleRoyale', avoid: ['ABCDE'] }], ['GetIceServers'], ['KickPlayer', 'p2'],
    ]);
});

test('the server\'s refusals come back as codes the UI can translate', async () => {
    const { signalR } = fakeSignalR({
        invoke: async (method) => {
            if (method === 'JoinRoom') throw new Error("An unexpected error occurred invoking 'JoinRoom' on the server. HubException: lan.roomFull");
            if (method === 'StartMatch') throw new Error('Something else entirely');
            return null;
        },
    });
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: {} });
    await client.connect();

    await assert.rejects(client.joinRoom('ABCDE', {}), (error) => error instanceof LobbyError && error.code === 'lan.roomFull');
    await assert.rejects(client.startMatch(), (error) => error.code === LOBBY_ERROR.UNKNOWN);
});

test('the resume token stays with the client, and takes the place back after a drop', async () => {
    let session = 1;
    const { signalR, log } = fakeSignalR({
        invoke: async (method, ...args) => {
            if (method === 'GetSession') return { playerId: `p${session++}`, isGuest: true, resumeToken: `secret-${session}` };
            if (method === 'ResumeSession') {
                if (args[0] !== 'secret-2') throw new Error('HubException: lan.resumeFailed');
                return { session: { playerId: 'p1', isGuest: true, resumeToken: 'secret-new' }, room: { code: 'ABCDE' }, match: { matchId: 'm', term: 1, hostPlayerId: 'p9' } };
            }
            return null;
        },
    });
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: {} });
    assert.deepEqual(await client.connect(), { playerId: 'p1', isGuest: true }, 'nobody else gets to see it');

    const back = await client.resume();
    assert.deepEqual(back, { me: { playerId: 'p1', isGuest: true }, room: { code: 'ABCDE' }, match: { matchId: 'm', term: 1, hostPlayerId: 'p9' } });
    assert.deepEqual(log.invoked.at(-1), ['ResumeSession', 'secret-2']);
    assert.equal(client.resumeToken, 'secret-new');

    // A token the server no longer knows: a new player.
    client.resumeToken = 'stale';
    assert.deepEqual(await client.resume(), { me: { playerId: 'p3', isGuest: true }, room: null, match: null });
});

test('the host\'s snapshots and a lost host go to the hub under its method names', async () => {
    const { signalR, log } = fakeSignalR();
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: {} });
    await client.connect();

    await client.putMatchSnapshot('m', 2, 'H4sI', ['p2', 'p3']);
    await client.reportHostLost('m', 2);

    assert.deepEqual(log.invoked.slice(1), [['PutMatchSnapshot', 'm', 2, 'H4sI', ['p2', 'p3']], ['ReportHostLost', 'm', 2]]);
});

test('no server, or no connection yet, is "offline"', async () => {
    const { signalR } = fakeSignalR({ failStart: true });
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: {} });

    await assert.rejects(client.connect(), (error) => error.code === LOBBY_ERROR.OFFLINE);
    await assert.rejects(client.listRooms(), (error) => error.code === LOBBY_ERROR.OFFLINE);
    assert.equal(client.connected, false);
});

test('a dropped connection is reported once, a deliberate disconnect not at all', async () => {
    const { signalR, log } = fakeSignalR();
    let drops = 0;
    const client = new LobbyClient({ url: '/hub', getToken: () => null, signalR, handlers: { onDisconnected: () => { drops += 1; } } });
    await client.connect();
    log.closeHandler();
    assert.equal(drops, 1);
    assert.equal(client.connected, false);

    await client.connect();
    await client.disconnect();
    log.closeHandler();
    assert.equal(drops, 1);
    assert.equal(log.stopped, 1);
});

// ---- LanMultiplayer --------------------------------------------------------------------------

/** How fast each test device says it simulates (milliseconds a step); the others say 0.5. */
const STEP_COSTS = { Tim: 3, Ann: 0.1, Bo: 1, Cy: 2 };

/** One device: a session, a store and a controller on the shared fake lobby and network. */
function device(server, network, name, ship = 'kestrel') {
    const { session, ui } = createTestSession({ playerShip: ship });
    let state = initialLanState();
    const store = { set: (partial) => { state = { ...state, ...partial }; }, get: () => state };
    let saved = name;
    let savedLoadout = null;
    const lan = new LanMultiplayer({
        session, store, createLobby: server.createLobby, createLink: (options) => network.createLink({ ...options, owner: name }),
        device: { name: `${name}'s device`, kind: DEVICE_KIND.DESKTOP },
        nameStore: { load: () => saved, save: (value) => { saved = value; } },
        loadoutStore: { load: () => savedLoadout, save: (value) => { savedLoadout = value; } },
        timers: { setTimeout: (callback) => { network.timers.push(callback); return callback; }, clearTimeout: (callback) => { network.timers = network.timers.filter((timer) => timer !== callback); } },
        now: () => network.clockMs,
        measureStepCost: () => STEP_COSTS[name] ?? 0.5,
        networkEvents: network.events,
    });
    return { lan, session, ui, controls: idle(), get state() { return state; }, get savedName() { return saved; }, get savedLoadout() { return savedLoadout; } };
}

function lanParty(names) {
    const server = new FakeLobbyServer();
    const network = new FakeNetwork();
    network.timers = [];
    /** What the browser window says of the devices' network ('online'). */
    network.events = new EventTarget();
    /** The wall clock every device reads (milliseconds). */
    network.clockMs = 1_000_000;
    const devices = names.map((name) => device(server, network, name));
    const settle = () => new Promise((resolve) => { setImmediate(resolve); });
    const run = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
            network.pump();
            for (const each of devices) each.session.update(1 / 60, each.controls);
        }
    };
    const fireTimers = () => { for (const timer of network.timers.splice(0)) timer(); };
    /** A device drops off the face of the earth: its links close and nothing on it runs any more. */
    const lose = (gone) => {
        devices.splice(devices.indexOf(gone), 1);
        for (const link of [...gone.lan.links.values()]) link.close();
    };
    return { server, network, devices, settle, run, fireTimers, lose };
}

/** Everybody online, the first hosting a room the others have joined and are linked to. */
async function gathered(names) {
    const party = lanParty(names);
    const [host, ...guests] = party.devices;
    for (const each of party.devices) await each.lan.open();
    // Only the people: what the computer-flown players do is tested with the rules (battleRoyale.test.js).
    await host.lan.createRoom({ mode: 'battleRoyale', settings: { pace: 'quick', intro: 'skip', bots: 'none' } });
    for (const guest of guests) await guest.lan.joinRoom(host.state.room.code);
    await party.settle();
    return { ...party, host, guests };
}

test('going online lists the rooms on the network; a host\'s room appears for the others', async () => {
    const { devices: [tim, ann], settle } = lanParty(['Tim', 'Ann']);
    await tim.lan.open();
    await ann.lan.open();
    assert.equal(tim.state.status, LAN_STATUS.ONLINE);
    assert.equal(tim.state.me.isGuest, true);
    assert.deepEqual(ann.state.rooms, []);

    await tim.lan.createRoom();
    await ann.lan.close();
    await ann.lan.open();
    await settle();

    assert.equal(tim.lan.isHost, true);
    assert.equal(ann.state.rooms.length, 1);
    assert.equal(ann.state.rooms[0].hostName, 'Tim');
});

test('the room shows every player\'s own name, device and ship', async () => {
    const { host, guests: [ann] } = await gathered(['Tim', 'Ann']);

    const players = ann.state.room.players;
    assert.deepEqual(players.map((player) => [player.displayName, player.deviceName, player.deviceKind, player.shipClassId, player.isHost]), [
        ['Tim', "Tim's device", DEVICE_KIND.DESKTOP, 'kestrel', true],
        ['Ann', "Ann's device", DEVICE_KIND.DESKTOP, 'kestrel', false],
    ]);
    assert.deepEqual(host.state.room, ann.state.room, 'everybody sees the same room');
});

test('every device links to every other on entering the room, not when the match starts', async () => {
    const { host, guests: [ann, bo], server } = await gathered(['Tim', 'Ann', 'Bo']);
    const idOf = (each) => each.state.me.playerId;
    const { OPEN } = LINK_STATUS;

    assert.deepEqual(host.state.links, { [idOf(ann)]: OPEN, [idOf(bo)]: OPEN });
    assert.deepEqual(ann.state.links, { [idOf(host)]: OPEN, [idOf(bo)]: OPEN });
    assert.deepEqual(bo.state.links, { [idOf(host)]: OPEN, [idOf(ann)]: OPEN });
    assert.equal(server.signals, 6, 'an offer and an answer for each pair: the one who joined later calls');
});

test('a changed name or ship reaches the room, and the name is remembered', async () => {
    const { host, guests: [ann], settle } = await gathered(['Tim', 'Ann']);

    await ann.lan.setPilotName('  Ann   of the  Veil and then some more ');
    ann.session.updateSettings({ playerShip: 'swift' });
    await ann.lan.pushProfile();
    await settle();

    const shown = host.state.room.players[1];
    assert.equal(shown.displayName, 'Ann of the Veil and');
    assert.equal(shown.shipClassId, 'swift');
    assert.equal(ann.savedName, 'Ann of the Veil and');
    assert.equal(ann.state.pilotName, 'Ann of the Veil and');
});

test('the host can start only when everybody is ready and linked', async () => {
    const { host, guests: [ann, bo], settle } = await gathered(['Tim', 'Ann', 'Bo']);
    assert.equal(host.lan.canStart, false);
    assert.equal(ann.lan.canStart, false, 'never a guest');

    await ann.lan.setReady(true);
    await settle();
    assert.equal(host.lan.canStart, false, 'Bo is not ready');
    await host.lan.startMatch();
    assert.equal(host.state.error, 'lan.playersNotReady', 'and the server agrees');

    await bo.lan.setReady(true);
    await settle();
    assert.equal(host.lan.canStart, true);
    host.lan.dropLink(bo.state.me.playerId);
    assert.equal(host.lan.canStart, false, 'ready, but the link is gone');
});

test('starting the match puts every device in it, each flying its own ship', async () => {
    const party = await gathered(['Tim', 'Ann', 'Bo']);
    const { host, guests, devices, run } = party;
    for (const guest of guests) await guest.lan.setReady(true);
    await host.lan.startMatch();
    run(1);

    for (const each of devices) {
        assert.equal(each.state.room.state, ROOM_STATE.IN_MATCH);
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.ui.match.mode, 'battleRoyale');
        assert.equal(each.ui.match.localId, each.state.me.playerId);
        assert.equal(each.session.world.player?.pilotId, each.state.me.playerId, 'in a ship of its own');
        assert.equal(each.session.world.player.callsign, each.state.pilotName);
        assert.equal(each.ui.match.players.length, 3);
    }
    assert.ok(host.lan.server, 'the host\'s device runs the server');
    assert.equal(guests[0].lan.server, null);
});

test('the equipment chosen in the lobby is this device\'s secret until the match, where it is in the pilot\'s hold', async () => {
    const party = await gathered(['Tim', 'Ann', 'Bo']);
    const { host, guests, devices, run } = party;
    const [ann, bo] = guests;
    assert.deepEqual(ann.state.loadout, { equipment: null });
    ann.lan.setLoadout({ equipment: 'overdrive' });
    host.lan.setLoadout({ equipment: 'beacon' });
    bo.lan.setLoadout({ equipment: { toString: () => 'beacon' } });
    assert.equal(ann.savedLoadout.equipment, 'overdrive', 'remembered for next time');
    assert.equal(bo.state.loadout.equipment, null, 'only a name is a choice');
    assert.equal(JSON.stringify(host.state.room).includes('overdrive'), false, 'the room is not told');

    for (const guest of guests) await guest.lan.setReady(true);
    await host.lan.startMatch();
    run(1);

    const carried = (each) => each.ui.match.you.equipment;
    assert.deepEqual([carried(ann).overdrive, ann.ui.match.you.picks], [1, 0]);
    assert.deepEqual([carried(host).beacon, host.ui.match.you.picks], [1, 0]);
    assert.deepEqual([Object.values(carried(bo)).reduce((sum, count) => sum + count, 0), bo.ui.match.you.picks], [0, 1], 'Bo can still choose');
    assert.equal(host.lan.server.mode.contestants.get(ann.state.me.playerId).inventory.counts.overdrive, 1);
    for (const each of devices) assert.equal(each.session.phase, PHASE.PLAYING);
});

test('a choice of equipment this build does not know is simply not asked for', async () => {
    const { host, guests, run } = await gathered(['Tim', 'Ann']);
    guests[0].lan.setLoadout({ equipment: 'deathStar' });
    await guests[0].lan.setReady(true);
    await host.lan.startMatch();
    run(1);

    assert.equal(guests[0].ui.match.you.picks, 1);
});

test('when the host ends the match everybody is back in the lobby, not ready', async () => {
    const { host, guests, devices, run, settle } = await gathered(['Tim', 'Ann']);
    await guests[0].lan.setReady(true);
    await host.lan.startMatch();
    run(0.5);

    await guests[0].lan.returnToLobby();
    assert.equal(guests[0].state.error, 'lan.notHost');
    await host.lan.returnToLobby();
    await settle();

    for (const each of devices) {
        assert.equal(each.session.phase, PHASE.TITLE);
        assert.equal(each.session.match, null);
        assert.equal(each.state.room.state, ROOM_STATE.LOBBY);
    }
    assert.equal(host.state.room.players[1].ready, false);
    assert.equal(host.lan.server, null);
    assert.deepEqual(Object.values(guests[0].state.links), [LINK_STATUS.OPEN], 'the link is kept for the next match');
});

test('a second match can be played on the same links', async () => {
    const { host, guests: [ann], run, settle } = await gathered(['Tim', 'Ann']);
    for (let round = 0; round < 2; round++) {
        await ann.lan.setReady(true);
        await host.lan.startMatch();
        run(0.5);
        assert.equal(ann.session.world.player?.pilotId, ann.state.me.playerId, `round ${round + 1}`);
        await host.lan.returnToLobby();
        await settle();
    }
});

test('a guest who leaves is gone from the room; when the owner leaves the room passes to the next player', async () => {
    const { host, guests: [ann, bo], settle } = await gathered(['Tim', 'Ann', 'Bo']);

    await ann.lan.leaveRoom();
    await settle();
    assert.equal(ann.state.room, null);
    assert.deepEqual(ann.state.links, {});
    assert.deepEqual(host.state.room.players.map((player) => player.displayName), ['Tim', 'Bo']);
    assert.deepEqual(Object.keys(host.state.links), [bo.state.me.playerId], 'and everybody lets go of the link to them');
    assert.deepEqual(Object.keys(bo.state.links), [host.state.me.playerId]);

    await host.lan.leaveRoom();
    await settle();
    assert.equal(bo.state.room.hostPlayerId, bo.state.me.playerId, 'the room is Bo\'s now');
    assert.equal(bo.lan.isHost, true);
    assert.equal(bo.state.error, null);
    assert.deepEqual(bo.state.links, {});
    assert.equal(host.state.room, null);
});

test('leaving in the middle of a match takes the player back to the title screen', async () => {
    // Three players are three sides: with one gone, two are still left to fight it out.
    const { host, guests: [ann, bo], run, settle } = await gathered(['Tim', 'Ann', 'Bo']);
    await ann.lan.setReady(true);
    await bo.lan.setReady(true);
    await host.lan.startMatch();
    run(0.5);

    await ann.lan.leaveRoom();
    await settle();
    run(0.5);

    assert.equal(ann.session.phase, PHASE.TITLE);
    assert.equal(ann.session.match, null);
    assert.equal(host.session.phase, PHASE.PLAYING, 'the others play on');
    assert.deepEqual(host.ui.match.players.map((player) => player.name), ['Tim', 'Bo']);
});

test('a match survives the lobby server going away', async () => {
    const { server, host, guests: [ann], run } = await gathered(['Tim', 'Ann']);
    await ann.lan.setReady(true);
    await host.lan.startMatch();
    run(0.5);

    server.crash();
    ann.controls.yaw = 1;
    run(1);

    assert.equal(ann.state.status, LAN_STATUS.OFFLINE);
    assert.equal(ann.session.phase, PHASE.PLAYING, 'the devices still talk to each other');
    assert.ok(ann.session.world.player.angularVelocity.length() > 0.3);
    assert.equal(host.ui.match.players.length, 2);
});

test('a player whose lobby connection drops during a match stays in it: the link says who is there, not the room list', async () => {
    // Two players are two sides: had Ann been put out of the match, Tim's side would have won on the spot.
    const { server, host: tim, guests: [ann], run, settle } = await gathered(['Tim', 'Ann']);
    await ann.lan.setReady(true);
    await tim.lan.startMatch();
    run(0.5);
    const annId = ann.state.me.playerId;

    // Ann's connection to the lobby server drops (her network blinked): the server takes her
    // off the room's list and tells the others - but her link to Tim is fine.
    const room = server.roomOf(annId);
    room.players.splice(room.players.findIndex((player) => player.playerId === annId), 1);
    server.broadcast(room);
    server.clients.get(annId).handlers.onDisconnected();
    await settle();
    run(1);

    assert.equal(tim.lan.links.get(annId)?.isOpen, true, 'Tim keeps his link to Ann');
    for (const each of [tim, ann]) {
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.ui.match.phase, 'playing', 'nobody has won, nobody is cut off');
        assert.deepEqual(each.ui.match.players.map((player) => player.name).sort(), ['Ann', 'Tim']);
    }

    // Back in the lobby the room's list counts again: Ann is no longer in it, nor linked to.
    await tim.lan.returnToLobby();
    await settle();
    run(0.2);
    assert.equal(tim.session.phase, PHASE.TITLE);
    assert.equal(tim.lan.links.has(annId), false);
});

test('a refused join says why', async () => {
    const { devices: [tim, ann] } = lanParty(['Tim', 'Ann']);
    await tim.lan.open();
    await ann.lan.open();
    await tim.lan.createRoom();

    await ann.lan.joinRoom('ZZZZZ');

    assert.equal(ann.state.error, 'lan.roomNotFound');
    assert.equal(ann.state.room, null);
});

test('a link that will not open is retried, then reported', async () => {
    const party = lanParty(['Tim', 'Ann']);
    const { network, devices: [tim, ann], settle, fireTimers } = party;
    await tim.lan.open();
    await ann.lan.open();
    await tim.lan.createRoom();
    network.blocked = true;
    await ann.lan.joinRoom(tim.state.room.code);
    await settle();
    assert.deepEqual(ann.state.links, {}, 'the first attempt failed');

    for (let attempt = 0; attempt < 5; attempt++) {
        fireTimers();
        await settle();
    }
    assert.equal(ann.state.error, LAN_ERROR.LINK_FAILED);

    network.blocked = false;
    ann.lan.retryLink();
    await settle();
    assert.deepEqual(Object.values(ann.state.links), [LINK_STATUS.OPEN]);
    assert.equal(ann.state.error, null);
});

test('signals from outside the room, and offers from a player who is not the one to call, are ignored', async () => {
    const { host, guests: [ann] } = await gathered(['Tim', 'Ann', 'Bo']);
    const linksBefore = { ...ann.state.links };

    // Tim was in the room before Ann: it is Ann who calls Tim, never the other way round.
    ann.lan.onSignal({ fromPlayerId: host.state.me.playerId, type: 'offer', payload: 'offer-99' });
    ann.lan.onSignal({ fromPlayerId: ann.state.me.playerId, type: 'offer', payload: 'offer-97' });
    ann.lan.onSignal({ fromPlayerId: 'stranger', type: 'offer', payload: 'offer-98' });
    ann.lan.onSignal(null);
    ann.lan.onSignal({ fromPlayerId: 5, type: 'offer' });

    assert.deepEqual(ann.state.links, linksBefore);
});

test('a guest without a link is not put into a match it cannot play', async () => {
    const { host, guests: [ann], run } = await gathered(['Tim', 'Ann']);
    await ann.lan.setReady(true);
    ann.lan.dropLinks();

    await host.lan.startMatch();
    run(0.3);

    assert.equal(ann.session.phase, PHASE.TITLE);
    assert.equal(ann.state.error, LAN_ERROR.NO_LINK);
    assert.equal(host.session.phase, PHASE.PLAYING);
});

// ---- Across the internet: quick match, private rooms, relays ---------------------------------

/** Players anywhere, online in the global lobby; nobody is in a room yet. */
async function strangers(names) {
    const party = lanParty(names);
    for (const each of party.devices) await each.lan.open(LOBBY_SCOPE.GLOBAL);
    /** Lets promises and (failed link) timers run until things have settled. */
    party.settleLinks = async (rounds = 8) => {
        for (let round = 0; round < rounds; round++) {
            await party.settle();
            party.fireTimers();
        }
        await party.settle();
    };
    return party;
}

test('going online asks the lobby which STUN and TURN servers to use, and every link is made with them', async () => {
    const party = lanParty(['Tim', 'Ann']);
    const { server, network, devices: [tim, ann], settle } = party;
    server.iceServers = [
        { urls: ['stun:stun.example.com:3478'] },
        { urls: ['turn:turn.example.com:3478?transport=udp', 'javascript:alert(1)'], username: 'user', credential: 'pass' },
    ];
    await tim.lan.open();
    await ann.lan.open();
    await tim.lan.createRoom();
    await ann.lan.joinRoom(tim.state.room.code);
    await settle();

    const expected = [{ urls: ['stun:stun.example.com:3478'] }, { urls: ['turn:turn.example.com:3478?transport=udp'], username: 'user', credential: 'pass' }];
    assert.equal(network.iceServersUsed.length, 2, 'the joiner\'s end and the host\'s');
    for (const used of network.iceServersUsed) assert.deepEqual(used, expected);
});

test('a lobby that names no servers leaves the game its own STUN servers', async () => {
    const party = lanParty(['Tim', 'Ann']);
    const { server, network, devices: [tim, ann], settle } = party;
    server.iceServers = 'none';
    await tim.lan.open();
    await ann.lan.open();
    assert.equal(tim.state.status, LAN_STATUS.ONLINE, 'being online does not depend on it');
    await tim.lan.createRoom();
    await ann.lan.joinRoom(tim.state.room.code);
    await settle();

    assert.deepEqual(network.iceServersUsed[0], [...ICE_SERVERS]);
});

test('ICE servers from the lobby are checked before the browser gets them', () => {
    assert.deepEqual(cleanIceServers([{ urls: 'stun:a.example:3478' }]), [{ urls: ['stun:a.example:3478'] }], 'one address is a list of one');
    assert.deepEqual(
        cleanIceServers([{ urls: ['turns:t.example:443?transport=tcp'], username: 'u', credential: 'c', extra: 'dropped' }]),
        [{ urls: ['turns:t.example:443?transport=tcp'], username: 'u', credential: 'c' }],
    );
    const junk = [
        null, 7, 'stun:x', {}, { urls: [] }, { urls: ['http://evil.example'] }, { urls: ['stun:bad host'] },
        { urls: ['turn:t.example:3478'] }, { urls: ['turn:t.example:3478'], username: 5, credential: {} },
    ];
    assert.deepEqual(cleanIceServers(junk), [...ICE_SERVERS], 'nothing usable: the defaults; a relay without credentials is no use');
    for (const nothing of [null, undefined, 'servers', {}, 12]) assert.deepEqual(cleanIceServers(nothing), [...ICE_SERVERS]);
    assert.equal(cleanIceServers(Array.from({ length: 50 }, (_, index) => ({ urls: [`stun:s${index}.example`] }))).length, 8, 'and not any number of them');
});

test('quick match opens a public room for the first player and puts the next ones in it; it counts down once everybody is ready', async () => {
    const { server, devices: [tim, ann, bo], settle, run } = await strangers(['Tim', 'Ann', 'Bo']);
    await tim.lan.quickMatch();
    assert.equal(tim.state.room.visibility, ROOM_VISIBILITY.PUBLIC);
    assert.equal(tim.state.matching, true);
    assert.equal(tim.state.startsAt, null, 'one pilot is not a match');
    assert.deepEqual(await server.createLobby({}).listRooms(), [], 'a public room is on no network\'s list');

    await ann.lan.quickMatch();
    await bo.lan.quickMatch();
    await settle();

    assert.equal(ann.state.room.code, tim.state.room.code);
    assert.equal(bo.state.room.code, tim.state.room.code);
    assert.deepEqual(tim.state.room.players.map((player) => player.ready), [true, false, false], 'being matched in is not being ready: each pilot says so');
    await ann.lan.setReady(true);
    assert.equal(tim.state.startsAt, null, 'the countdown waits for Bo too');
    await bo.lan.setReady(true);
    for (const each of [tim, ann, bo]) {
        assert.equal(each.state.startsAt, 1_000_000 + FAKE_AUTO_START_SECONDS * 1000, 'the countdown is on every screen');
    }

    server.startDueRooms();
    run(1);
    for (const each of [tim, ann, bo]) {
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.state.matching, false, 'matched');
        assert.equal(each.state.startsAt, null);
        assert.equal(each.ui.match.players.filter((player) => !player.bot).length, 3);
        assert.equal(each.ui.match.players.length, 6, 'a public match short of players is made up with computer-flown ones');
    }
});

test('players anywhere draw other ships a little later than players on one Wi-Fi, and give a quiet host longer', async () => {
    const { server, devices: [tim, ann], settle, run } = await strangers(['Tim', 'Ann']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await settle();
    await ann.lan.setReady(true);
    server.startDueRooms();
    run(0.5);
    assert.equal(ann.session.match.timeline.delay, NET.internetInterpolationDelay);
    assert.ok(NET.internetInterpolationDelay > NET.interpolationDelay);
    assert.equal(ann.session.match.hostLostTimeout, NET.internetHostLostTimeout);
    assert.ok(NET.internetHostLostTimeout > NET.hostLostTimeout);

    const lan = await gathered(['Cy', 'Di']);
    await lan.guests[0].lan.setReady(true);
    await lan.host.lan.startMatch();
    lan.run(0.5);
    assert.equal(lan.guests[0].session.match.timeline.delay, NET.interpolationDelay);
    assert.equal(lan.guests[0].session.match.hostLostTimeout, NET.hostLostTimeout);
});

test('after a public match the room waits for everybody to be ready again before the next one', async () => {
    const { server, devices: [tim, ann], settle, run } = await strangers(['Tim', 'Ann']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await settle();
    await ann.lan.setReady(true);
    server.startDueRooms();
    run(0.5);

    await tim.lan.returnToLobby();
    await settle();
    assert.equal(ann.session.phase, PHASE.TITLE);
    assert.deepEqual(ann.state.room.players.map((player) => player.ready), [true, false]);
    assert.equal(ann.state.startsAt, null);
    await ann.lan.setReady(true);
    assert.ok(ann.state.startsAt > 0);
});

test('the host can put a player out of the room; they are told, and are not matched back into it', async () => {
    const { server, devices: [tim, ann, bo], settle } = await strangers(['Tim', 'Ann', 'Bo']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await bo.lan.quickMatch();
    await settle();
    await bo.lan.setReady(true);
    assert.equal(tim.state.startsAt, null, 'Ann has not readied up: the countdown waits');

    await ann.lan.kick(tim.state.me.playerId);
    assert.equal(ann.state.error, 'lan.notHost', 'only the host can');
    await tim.lan.kick(ann.state.me.playerId);
    await settle();

    assert.deepEqual([ann.state.room, ann.state.matching, ann.state.error], [null, false, LAN_ERROR.KICKED]);
    assert.deepEqual(ann.state.links, {}, 'her link to the host is closed');
    assert.deepEqual(tim.state.room.players.map((player) => player.displayName), ['Tim', 'Bo']);
    assert.deepEqual(Object.keys(tim.state.links), [bo.state.me.playerId], 'and the host has let go of her');
    assert.ok(tim.state.startsAt > 0, 'with her gone everybody is ready');

    await ann.lan.quickMatch();
    assert.notEqual(ann.state.room.code, tim.state.room.code, 'looking again, she gets another room');
    await ann.lan.leaveRoom();
    await ann.lan.joinRoom(tim.state.room.code);
    assert.equal(ann.state.error, LAN_ERROR.KICKED, 'nor does the code let her back in');
    assert.equal(server.rooms.get(tim.state.room.code).players.length, 2);
});

test('a host on one Wi-Fi can put a player out too, but nobody is put out of a match in progress', async () => {
    const { host, guests: [ann, bo], settle, run } = await gathered(['Tim', 'Ann', 'Bo']);
    await host.lan.kick(bo.state.me.playerId);
    await settle();
    assert.equal(bo.state.error, LAN_ERROR.KICKED);
    assert.equal(host.state.room.players.length, 2);

    await ann.lan.setReady(true);
    await host.lan.startMatch();
    run(0.5);
    await host.lan.kick('nobody');
    assert.equal(host.state.error, 'lan.playerNotFound');
    assert.equal(ann.session.phase, PHASE.PLAYING);
});

test('a quick match whose host cannot be reached moves on to another room by itself', async () => {
    const { network, devices: [tim, ann, bo], settleLinks } = await strangers(['Tim', 'Ann', 'Bo']);
    network.unreachable.add('Tim');
    await tim.lan.quickMatch();
    const timsRoom = tim.state.room.code;

    await ann.lan.quickMatch();
    assert.equal(ann.state.room.code, timsRoom, 'the server cannot know the two networks will not connect');
    await settleLinks();
    assert.notEqual(ann.state.room.code, timsRoom, 'she gave up on Tim\'s room...');
    assert.equal(ann.state.room.hostPlayerId, ann.state.me.playerId, '...and, nobody else waiting, opened one');
    assert.deepEqual([ann.state.matching, ann.state.error], [true, null], 'still matching: this is no error to show');
    assert.equal(tim.state.room.players.length, 1);

    await bo.lan.quickMatch();
    await settleLinks();
    assert.equal(bo.state.room.code, ann.state.room.code, 'Bo too ends up with somebody he can reach');
    assert.deepEqual(Object.values(bo.state.links), [LINK_STATUS.OPEN]);
});

test('when no host can be reached quick match gives up and says so', async () => {
    const { network, devices: [tim, ann, bo, cy], settleLinks } = await strangers(['Tim', 'Ann', 'Bo', 'Cy']);
    for (const name of ['Tim', 'Ann', 'Bo']) network.unreachable.add(name);
    await tim.lan.quickMatch();
    await ann.lan.createRoom({ mode: 'battleRoyale', visibility: ROOM_VISIBILITY.PUBLIC });
    await bo.lan.createRoom({ mode: 'battleRoyale', visibility: ROOM_VISIBILITY.PUBLIC });

    await cy.lan.quickMatch();
    await settleLinks(24);

    assert.equal(cy.state.room, null);
    assert.equal(cy.state.matching, false);
    assert.equal(cy.state.error, LAN_ERROR.NO_HOST_REACHABLE);
    for (const each of [tim, ann, bo]) assert.equal(each.state.room.players.length, 1, 'and is in nobody\'s room');
});

test('a public room whose owner leaves before it starts goes on under the next player: nobody has to look again', async () => {
    const { devices: [tim, ann, bo], settle } = await strangers(['Tim', 'Ann', 'Bo']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await bo.lan.quickMatch();
    await settle();
    const code = tim.state.room.code;

    await tim.lan.leaveRoom();
    await settle();

    assert.equal(tim.state.matching, false, 'the one who left has stopped looking');
    assert.deepEqual([ann.state.room.code, bo.state.room.code], [code, code], 'the others are where they were');
    assert.equal(ann.state.room.hostPlayerId, ann.state.me.playerId, 'and the room is Ann\'s now');
    assert.deepEqual([ann.state.error, bo.state.error], [null, null]);
    assert.deepEqual(Object.values(bo.state.links), [LINK_STATUS.OPEN], 'still linked to each other');
});

test('a room that is closed under a player in a quick match sends them looking again', async () => {
    const { devices: [tim, ann], settle } = await strangers(['Tim', 'Ann']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await settle();
    const code = ann.state.room.code;

    // (The lobby server no longer closes a room that still has players; an older one might.)
    await ann.lan.lobby.leaveRoom();
    ann.lan.onRoomClosed();
    await settle();

    assert.deepEqual([ann.state.matching, ann.state.error], [true, null]);
    assert.ok(ann.state.room, 'she is in a room again');
    assert.equal(typeof code, 'string');
});

test('leaving a quick match stops the search', async () => {
    const { devices: [tim, ann], settle } = await strangers(['Tim', 'Ann']);
    await tim.lan.quickMatch();
    await ann.lan.quickMatch();
    await settle();

    await ann.lan.leaveRoom();
    await settle();

    assert.deepEqual([ann.state.room, ann.state.matching, ann.state.startsAt], [null, false, null]);
    assert.equal(tim.state.startsAt, null, 'and Tim, alone again, is no longer being counted down');
});

test('a private room is found by nobody and joined with its code from anywhere', async () => {
    const { server, devices: [tim, ann, bo], settle, run } = await strangers(['Tim', 'Ann', 'Bo']);
    await tim.lan.createPrivateRoom();
    assert.equal(tim.state.room.visibility, ROOM_VISIBILITY.PRIVATE);
    assert.deepEqual(ann.state.rooms, [], 'not listed');

    await bo.lan.quickMatch();
    assert.notEqual(bo.state.room.code, tim.state.room.code, 'not matched into');

    await ann.lan.joinRoom(tim.state.room.code);
    await settle();
    assert.equal(ann.state.room.code, tim.state.room.code);
    assert.equal(ann.state.room.players.find((player) => !player.isHost).ready, false, 'friends say when they are ready');
    assert.equal(ann.state.startsAt, null, 'and their host says when to start');

    await ann.lan.setReady(true);
    server.startDueRooms();
    assert.equal(tim.session.phase, PHASE.TITLE, 'no countdown starts it');
    await tim.lan.startMatch();
    run(0.5);
    assert.equal(ann.session.phase, PHASE.PLAYING);
});

test('the game tells the lobby which protocol it speaks, and which multiplayer it opened is remembered', async () => {
    const { devices: [tim] } = await strangers(['Tim']);
    assert.equal(tim.lan.profile().protocol, NET.protocolVersion);
    assert.equal(tim.state.scope, LOBBY_SCOPE.GLOBAL);

    await tim.lan.close();
    assert.equal(tim.state.scope, LOBBY_SCOPE.GLOBAL, 'closing the lobby does not forget where the player was');
    await tim.lan.open(LOBBY_SCOPE.LAN);
    assert.equal(tim.state.scope, LOBBY_SCOPE.LAN);
});

// ---- Whose device runs the match, and what happens when it is lost ----------------------------

/**
 * Tim (the room's owner, on a slow device), Ann (a fast one) and whoever else, in Tim's room,
 * linked, their reports in, everybody ready. Ann's device is the best host.
 */
async function measured(names = ['Tim', 'Ann', 'Bo']) {
    const party = await gathered(names);
    // Links are up: the pings go out, their answers come back, and the reports follow.
    for (let round = 0; round < 3; round++) {
        party.fireTimers();
        party.network.clockMs += 20;
        party.network.pump();
        await party.settle();
    }
    for (const guest of party.guests) await guest.lan.setReady(true);
    party.byName = Object.fromEntries(party.devices.map((each) => [each.state.pilotName, each]));
    party.idOf = (name) => party.byName[name].state.me.playerId;
    return party;
}

test('every device tells the lobby how fast it simulates and how far it is from the others', async () => {
    const { server, byName, idOf } = await measured();
    const room = [...server.rooms.values()][0];
    const reported = Object.fromEntries(room.players.map((player) => [player.displayName, player.fitness]));

    assert.deepEqual([reported.Tim.stepCostMs, reported.Ann.stepCostMs, reported.Bo.stepCostMs], [STEP_COSTS.Tim, STEP_COSTS.Ann, STEP_COSTS.Bo]);
    assert.deepEqual(Object.keys(reported.Tim.rttMs).sort(), [idOf('Ann'), idOf('Bo')].sort(), 'a round trip to each of the others');
    assert.ok(Object.values(reported.Bo.rttMs).every((ms) => ms >= 0 && ms < 1000));
    assert.equal(byName.Tim.lan.fitness().stepCost, STEP_COSTS.Tim);
});

test('the match runs on the device the lobby picked, not on the room owner\'s', async () => {
    const { host: tim, byName: { Ann: ann, Bo: bo }, devices, run, idOf } = await measured();
    await tim.lan.startMatch();
    run(1);

    assert.ok(ann.lan.server, 'Ann\'s fast device runs it');
    assert.equal(tim.lan.server, null, 'Tim owns the room and plays as a client');
    assert.equal(tim.lan.isHost, true);
    for (const each of devices) {
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.lan.matchHostId, idOf('Ann'));
        assert.equal(each.session.world.player?.pilotId, each.state.me.playerId);
    }
    assert.equal(ann.session.match.isHost, true);
    assert.equal(Boolean(bo.session.match.isHost), false);
});

test('when the device running the match is lost, the next in line takes it over and the match goes on', async () => {
    const party = await measured();
    const { host: tim, byName: { Ann: ann, Bo: bo }, run, idOf, lose } = party;
    await tim.lan.startMatch();
    run(4);
    assert.ok(bo.lan.client.latestCheckpoint && tim.lan.client.latestCheckpoint, 'both of the others hold a checkpoint of the whole match');
    assert.deepEqual(tim.lan.client.succession, [idOf('Bo'), idOf('Tim')], 'and know the line: Bo\'s device is the better of the two');
    const timeBefore = tim.ui.match.time;

    lose(ann);
    run(1);

    assert.ok(bo.lan.server, 'Bo\'s device has the match now');
    assert.equal(tim.lan.server, null);
    for (const each of [tim, bo]) {
        assert.equal(each.session.phase, PHASE.PLAYING, 'nobody was thrown out');
        assert.equal(each.lan.matchHostId, idOf('Bo'));
        assert.equal(each.lan.client.migrating, false, 'and both have the new host\'s picture');
        assert.equal(each.lan.client.term, 1);
        assert.equal(each.session.world.player?.alive, true, 'in their own ships');
        assert.deepEqual(each.ui.match.players.map((player) => player.id).sort(), [idOf('Tim'), idOf('Bo')].sort(), 'Ann is out of the match');
    }
    assert.ok(tim.ui.match.time >= timeBefore - 4, 'a few seconds back at the most');
    assert.equal(bo.session.match.isHost, true);

    // And it is a match again: the ships fly under the new host.
    tim.controls.throttleTarget = 1;
    const before = tim.session.world.player.position.clone();
    run(2);
    assert.ok(tim.session.world.player.position.distanceTo(before) > 20, 'Tim\'s ship answers its helm');
    assert.ok(bo.lan.server.pilots.get(idOf('Tim')).ship.position.distanceTo(tim.session.world.player.position) < 60, 'and is where Bo\'s server has it');
});

test('the new host writes checkpoints in its turn: a match can change hands more than once', async () => {
    const party = await measured(['Tim', 'Ann', 'Bo', 'Cy']);
    const { host: tim, byName: { Ann: ann, Bo: bo, Cy: cy }, run, idOf, lose } = party;
    await tim.lan.startMatch();
    run(4);
    lose(ann);
    run(4);
    assert.ok(bo.lan.server);
    assert.ok(cy.lan.client.latestCheckpoint && cy.lan.client.term === 1);

    lose(bo);
    run(1);
    const hosting = [tim, cy].filter((each) => each.lan.server);
    assert.equal(hosting.length, 1, 'one of the two that are left has it');
    for (const each of [tim, cy]) {
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.lan.client.term, 2);
        assert.equal(each.lan.matchHostId, hosting[0].state.me.playerId);
    }
    assert.equal(hosting[0], cy, `Cy's device is faster than Tim's (${idOf('Cy')})`);
});

test('if the next in line is gone too, the one after it takes over', async () => {
    const party = await measured(['Tim', 'Ann', 'Bo', 'Cy']);
    const { host: tim, byName: { Ann: ann, Bo: bo, Cy: cy }, run, idOf, lose } = party;
    await tim.lan.startMatch();
    run(4);
    assert.equal(tim.lan.client.succession[0], idOf('Bo'));

    lose(ann);
    lose(bo);
    run(1);

    assert.ok(cy.lan.server, 'Cy was second in line and had a checkpoint too');
    assert.equal(tim.lan.matchHostId, idOf('Cy'));
    assert.equal(tim.session.phase, PHASE.PLAYING);
    assert.equal(tim.lan.client.migrating, false);
});

test('a host that had only stalled stands down when it hears that another device has the match', async () => {
    const party = await measured();
    const { host: tim, byName: { Ann: ann, Bo: bo }, run, idOf } = party;
    await tim.lan.startMatch();
    run(4);

    // Ann's device hangs: the others hear nothing for too long and move on. Her links are still up.
    tim.lan.client.hostLost();
    bo.lan.client.hostLost();
    run(1);

    assert.ok(bo.lan.server);
    assert.equal(ann.lan.server, null, 'Ann\'s device let go of its own copy of the match');
    assert.equal(Boolean(ann.session.match.isHost), false);
    for (const each of [tim, ann, bo]) {
        assert.equal(each.lan.matchHostId, idOf('Bo'));
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.lan.client.migrating, false);
    }
    assert.equal(bo.lan.server.pilots.get(idOf('Ann')).gone, false, 'she was reachable, so she is still in it');
    assert.equal(ann.ui.match.players.length, 3);
});

test('two devices that take over at the same moment settle on one of them', async () => {
    const party = await measured();
    const { host: tim, byName: { Ann: ann, Bo: bo }, run, idOf, lose } = party;
    await tim.lan.startMatch();
    run(4);
    lose(ann);
    // Each believes it is alone in having noticed: both build a server, both announce it, in the same term.
    for (const each of [tim, bo]) {
        if (!each.lan.server) {
            each.lan.clearSuccession();
            each.lan.succession = { tried: new Set(), timer: null };
            assert.equal(each.lan.takeOver(), true);
        }
    }
    assert.ok(tim.lan.server && bo.lan.server, 'for a moment there are two');

    run(1);

    const expected = [idOf('Tim'), idOf('Bo')].sort()[0];
    const hosting = [tim, bo].filter((each) => each.lan.server);
    assert.equal(hosting.length, 1, 'then one');
    assert.equal(hosting[0].state.me.playerId, expected, 'the one whose id sorts first - the same choice on both devices');
    for (const each of [tim, bo]) {
        assert.equal(each.lan.matchHostId, expected);
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.lan.client.migrating, false);
        assert.equal(each.ui.match.players.length, 2);
    }
});

test('with no checkpoint to go on from, a lost host ends the match as it used to', async () => {
    const party = await measured();
    const { host: tim, byName: { Ann: ann, Bo: bo }, run, lose } = party;
    await tim.lan.startMatch();
    run(1);
    // (The host sends its first checkpoint at once; these two have somehow never had one.)
    tim.lan.client.latestCheckpoint = null;
    bo.lan.client.latestCheckpoint = '{"not": "a checkpoint"}';

    lose(ann);
    run(0.5);
    assert.deepEqual([tim.session.phase, bo.session.phase], [PHASE.PLAYING, PHASE.PLAYING], 'each waits a while for the other to take over');
    assert.equal(bo.lan.server, null, 'Bo, first in line, could not: what he holds is not a checkpoint of this match');

    // Nobody does: the waiting runs out, down the line, to its end.
    for (let round = 0; round < 3; round++) {
        party.fireTimers();
        run(0.2);
    }
    for (const each of [tim, bo]) {
        assert.equal(each.session.phase, PHASE.MATCH_OVER);
        assert.equal(each.ui.match.phase, 'disconnected');
        assert.equal(each.lan.server, null);
    }
});

test('the last device left takes the match over for itself', async () => {
    const party = await measured(['Tim', 'Ann']);
    const { host: tim, byName: { Ann: ann }, run, lose } = party;
    await tim.lan.startMatch();
    run(4);

    lose(ann);
    run(1);

    assert.ok(tim.lan.server, 'nobody else to turn to: Tim\'s own device goes on');
    assert.notEqual(tim.ui.match.phase, 'disconnected');
    assert.deepEqual(tim.ui.match.players.map((player) => player.id), [tim.state.me.playerId]);
});

test('when the match is over its links are the lobby\'s again, and the next match picks its host afresh', async () => {
    const party = await measured();
    const { host: tim, byName: { Ann: ann, Bo: bo }, run, settle, fireTimers, network, lose } = party;
    await tim.lan.startMatch();
    run(4);
    lose(ann);
    run(1);
    await ann.lan.lobby.leaveRoom();

    await tim.lan.returnToLobby();
    await settle();
    assert.deepEqual([tim.session.phase, bo.session.phase], [PHASE.TITLE, PHASE.TITLE]);
    assert.deepEqual([tim.lan.server, bo.lan.server, tim.lan.matchHostId], [null, null, null]);

    network.clockMs += 5000;
    fireTimers();
    network.pump();
    assert.ok(tim.lan.peerRtt.has(bo.state.me.playerId), 'the pings between the two are being answered again');

    await bo.lan.setReady(true);
    await tim.lan.startMatch();
    run(1);
    assert.ok(bo.lan.server, 'of the two, Bo\'s device is the faster');
    assert.equal(tim.session.phase, PHASE.PLAYING);
});

// ---- Across the internet the lobby server is the referee -------------------------------------

/**
 * Strangers in one public room, its match started: the first of them runs it (nothing has been
 * reported, so the lobby's line is the joining order). `play` runs the devices and lets what
 * goes to and from the lobby server arrive.
 */
async function refereedMatch(names) {
    const party = await strangers(names);
    const { server, network, devices } = party;
    server.now = () => network.clockMs;
    for (const each of devices) await each.lan.quickMatch();
    await party.settle();
    [...server.rooms.values()][0].settings = { pace: 'quick', intro: 'skip', bots: 'none' };
    for (const each of devices.slice(1)) await each.lan.setReady(true);
    server.startDueRooms();
    party.byName = Object.fromEntries(devices.map((each) => [each.state.pilotName, each]));
    party.idOf = (name) => party.byName[name].state.me.playerId;
    party.play = async (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) {
            party.run(0.25);
            network.clockMs += 250;
            // (Packing and unpacking snapshots runs on the thread pool: give it a moment of real time.)
            for (let round = 0; round < 4; round++) await new Promise((resolve) => { setTimeout(resolve, 1); });
        }
    };
    await party.play(2);
    return party;
}

const humans = (each) => each.ui.match.players.filter((player) => !player.bot).map((player) => player.name).sort();

/**
 * The network under a link is gone (a device moved from Wi-Fi to mobile data, say): nothing gets through either way,
 * and neither end hears of the other closing it - each still takes it to be open until it closes its own end.
 */
function killQuietly(link) {
    for (const end of [link.end, link.end.peer]) {
        end.deliver = () => { end.inbox.length = 0; };
        end.close = () => {
            if (!end.isOpen) return;
            end.isOpen = false;
            end.onClose?.();
        };
    }
    return link.end;
}

test('across the internet the host sends the lobby server a snapshot of the match every second', async () => {
    const { server, idOf, byName: { Tim: tim }, play } = await refereedMatch(['Tim', 'Ann']);
    const before = server.snapshots.length;
    await play(3);

    assert.ok(tim.lan.server);
    const sent = server.snapshots.slice(before);
    assert.ok(sent.length >= 2 && sent.length <= 4, `${sent.length} in three seconds`);
    assert.ok(sent.every((entry) => entry.playerId === idOf('Tim') && entry.term === 0 && typeof entry.snapshot === 'string'));
    const checkpoint = JSON.parse(await unpackSnapshot(sent.at(-1).snapshot));
    assert.equal(checkpoint.matchId, tim.lan.server.info.matchId);
});

test('a host that is gone is replaced by the device the server names, from the server\'s snapshot', async () => {
    const party = await refereedMatch(['Tim', 'Ann', 'Bo']);
    const { server, idOf, byName: { Tim: tim, Ann: ann, Bo: bo }, play, lose } = party;
    // Neither of the others holds a checkpoint of its own: the server's snapshot is all there is to go on from.
    ann.lan.client.latestCheckpoint = null;
    bo.lan.client.latestCheckpoint = null;

    // Tim's device is gone: the lobby server loses it, and its links close.
    server.drop(idOf('Tim'));
    lose(tim);
    await play(1);

    assert.ok(ann.lan.server, 'Ann, next in line, runs the match now');
    assert.equal(ann.lan.server.term, 1);
    assert.equal(bo.lan.server, null);
    for (const each of [ann, bo]) {
        assert.equal(each.lan.matchHostId, idOf('Ann'));
        assert.equal(each.lan.client.migrating, false, 'with the new host\'s picture');
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.equal(each.session.world.player?.alive, true);
        assert.deepEqual(humans(each), ['Ann', 'Bo', 'Tim'], 'Tim\'s ship waits for him');
    }
    const away = ann.lan.server.pilots.get(idOf('Tim'));
    assert.equal(away.gone, false);
    assert.ok(away.awayUntil > 0);
    assert.equal(server.snapshots.at(-1).playerId, idOf('Ann'), 'and the new host sends its snapshots in its turn');
});

test('a client whose link broke to a host that is still there links up again: nobody takes the match over', async () => {
    const { idOf, byName: { Tim: tim, Ann: ann }, play } = await refereedMatch(['Tim', 'Ann']);

    ann.lan.links.get(idOf('Tim')).close();
    await play(1);

    assert.ok(tim.lan.server, 'Tim still runs it');
    assert.equal(ann.lan.server, null);
    assert.equal(ann.lan.links.get(idOf('Tim'))?.isOpen, true, 'a new link');
    assert.equal(ann.lan.client.migrating, false);
    assert.equal(ann.lan.client.term, 0);
    const pilot = tim.lan.server.pilots.get(idOf('Ann'));
    assert.equal(pilot.gone, false);
    assert.ok(pilot.link?.isOpen);
    assert.equal(ann.session.world.player?.pilotId, idOf('Ann'), 'in her own ship');
    assert.equal(tim.ui.match.phase, 'playing', 'nobody won for it');
});

test('a host most players have lost is replaced even if it still sends, and stands down at its next snapshot to play on as a client', async () => {
    const { idOf, byName: { Tim: tim, Ann: ann, Bo: bo }, play } = await refereedMatch(['Tim', 'Ann', 'Bo']);

    // Tim is cut off from both of the others (his links fail); his lobby connection is fine.
    for (const link of [...tim.lan.links.values()]) link.close();
    await play(3);

    assert.equal(tim.lan.server, null, 'Tim let go of his own copy of the match');
    assert.ok(ann.lan.server);
    for (const each of [tim, ann, bo]) {
        assert.equal(each.lan.matchHostId, idOf('Ann'));
        assert.equal(each.lan.client.migrating, false);
        assert.equal(each.session.phase, PHASE.PLAYING);
        assert.deepEqual(humans(each), ['Ann', 'Bo', 'Tim']);
    }
    assert.equal(tim.session.world.player?.pilotId, idOf('Tim'), 'in his own ship, now from the new host');
    assert.ok(ann.lan.server.pilots.get(idOf('Tim')).link?.isOpen);
});

test('a host that dropped off the network comes back as a client of the device that took over', async () => {
    const party = await refereedMatch(['Tim', 'Ann', 'Bo']);
    const { server, idOf, byName: { Tim: tim, Ann: ann, Bo: bo }, play, fireTimers } = party;

    // Tim's network goes: lobby connection and links both. His page keeps running.
    server.drop(idOf('Tim'));
    for (const link of [...tim.lan.links.values()]) link.close();
    await play(1);
    assert.ok(ann.lan.server, 'Ann took over');
    assert.ok(tim.lan.server, 'Tim, alone, does not know yet');
    assert.equal(tim.state.status, LAN_STATUS.OFFLINE);

    // It comes back: his device gets its place in the lobby back, hears who runs the match, and joins it.
    fireTimers();
    await play(2);

    assert.equal(tim.state.status, LAN_STATUS.ONLINE);
    assert.equal(tim.state.me.playerId, idOf('Tim'), 'the same player as before');
    assert.equal(tim.lan.server, null);
    for (const each of [tim, ann, bo]) {
        assert.equal(each.lan.matchHostId, idOf('Ann'));
        assert.equal(each.lan.client.migrating, false);
        assert.deepEqual(humans(each), ['Ann', 'Bo', 'Tim']);
    }
    assert.equal(tim.session.world.player?.pilotId, idOf('Tim'));
    assert.ok(ann.lan.server.pilots.get(idOf('Tim')).link?.isOpen);
    assert.equal(server.roomOf(idOf('Tim')).players.find((player) => player.playerId === idOf('Tim')).connected, true);
});

test('a host whose links went silent without closing (it moved network) does not wait on them when it comes back', async () => {
    const party = await refereedMatch(['Tim', 'Ann']);
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play, fireTimers } = party;
    await play(4);

    // Tim's phone moves from Wi-Fi to mobile data: the lobby connection drops; his link to Ann still looks open, but nothing gets through.
    server.drop(idOf('Tim'));
    const dead = killQuietly(tim.lan.links.get(idOf('Ann')));
    await play(9);
    // (Her device's silence timer runs on the real clock: here it is told the host went quiet.)
    ann.lan.client.hostLost();
    await play(1);
    assert.ok(ann.lan.server, 'Ann took over');
    assert.ok(tim.lan.server, 'Tim, cut off, does not know yet');
    assert.equal(tim.lan.links.get(idOf('Ann'))?.end, dead);

    // He is back on the lobby: told Ann runs the match, he calls her afresh at once rather than waiting on the dead link.
    fireTimers();
    await play(1.5);
    assert.equal(tim.lan.server, null);
    assert.equal(tim.lan.matchHostId, idOf('Ann'));
    assert.notEqual(tim.lan.links.get(idOf('Ann'))?.end, dead);
    assert.equal(tim.lan.client.migrating, false, 'welcomed by the new host');
    assert.deepEqual(humans(tim), ['Ann', 'Tim']);
    assert.ok(ann.lan.server.pilots.get(idOf('Tim')).link?.isOpen);
});

test('a client cut off from everybody waits for the server instead of starting a match of its own', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play, fireTimers } = await refereedMatch(['Tim', 'Ann']);
    await play(4);

    // Ann's network goes: no lobby, and her link to Tim (the host) carries nothing any more.
    server.drop(idOf('Ann'));
    killQuietly(ann.lan.links.get(idOf('Tim')));
    await play(9);
    ann.lan.client.hostLost();
    await play(1);
    assert.equal(ann.lan.server, null, 'next in line, but with nobody to reach she does not take over');
    assert.equal(ann.lan.client.migrating, true);
    assert.ok(tim.lan.server);

    // Back: the server says Tim still runs the match; she calls him afresh and is in it again.
    fireTimers();
    await play(1.5);
    assert.equal(ann.state.status, LAN_STATUS.ONLINE);
    assert.equal(ann.lan.server, null);
    assert.equal(ann.lan.matchHostId, idOf('Tim'));
    assert.equal(ann.lan.client.migrating, false);
    assert.ok(tim.lan.server.pilots.get(idOf('Ann')).link?.isOpen);
    assert.equal(server.roomOf(idOf('Tim')).hosting.term, 0);
});

test('a device that went on with the match alone while it could not ask the server stands down when the server says otherwise', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play, fireTimers } = await refereedMatch(['Tim', 'Ann']);
    await play(4);

    server.drop(idOf('Ann'));
    killQuietly(ann.lan.links.get(idOf('Tim')));
    await play(2);
    // (As after a takeover the devices settled among themselves: a later term than the server's.)
    assert.equal(ann.lan.takeOver(), true);
    assert.equal(ann.lan.client.term, 1);

    fireTimers();
    await play(1.5);
    assert.equal(ann.lan.server, null, 'the server\'s word stands, though its term is older');
    assert.equal(ann.lan.matchHostId, idOf('Tim'));
    assert.equal(ann.lan.client.migrating, false);
    assert.ok(tim.lan.server, 'one host again');
    assert.ok(tim.lan.server.pilots.get(idOf('Ann')).link?.isOpen);
});

test('while the lobby server can be asked, one device\'s word that it took over does not make the host stand down', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play } = await refereedMatch(['Tim', 'Ann']);
    await play(4);

    // Ann's device claims the match (as one that went on alone would); Tim's is fine and still sending to the server.
    const before = tim.lan.server;
    assert.equal(ann.lan.takeOver(), true);
    await play(2);

    assert.equal(tim.lan.server, before, 'Tim runs the match still - he never let go of it');
    assert.equal(ann.lan.server, null, 'the server told Ann otherwise');
    assert.equal(ann.lan.matchHostId, idOf('Tim'));
    assert.equal(ann.lan.client.migrating, false);
    assert.equal(server.roomOf(idOf('Tim')).hosting.term, 0);
    assert.ok(tim.lan.server.pilots.get(idOf('Ann')).link?.isOpen);
});

test('a host cut off from the lobby that hears of the takeover on its link turns to the new host over it at once', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play } = await refereedMatch(['Tim', 'Ann']);
    await play(4);

    server.drop(idOf('Tim'));
    const link = tim.lan.links.get(idOf('Ann'));
    ann.lan.client.hostLost();
    await play(1.5);

    assert.ok(ann.lan.server, 'the server gave Ann the match');
    assert.equal(tim.state.status, LAN_STATUS.OFFLINE, 'Tim is still without the lobby');
    assert.equal(tim.lan.server, null, 'but heard of it from Ann');
    assert.equal(tim.lan.links.get(idOf('Ann')), link, 'over the link he had: none can be made without the lobby');
    assert.equal(tim.lan.client.migrating, false);
    assert.deepEqual(humans(tim), ['Ann', 'Tim']);
});

test('a device whose lobby connection drops during a match gets its place back; one that took too long plays on without', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play, fireTimers } = await refereedMatch(['Tim', 'Ann']);

    server.drop(idOf('Ann'));
    await play(1);
    assert.equal(ann.state.status, LAN_STATUS.OFFLINE);
    assert.equal(tim.state.room.players.find((player) => player.playerId === idOf('Ann')).connected, false, 'shown as away, still in the room');
    assert.equal(ann.ui.match.phase, 'playing');

    fireTimers();
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.ONLINE);
    assert.equal(ann.state.me.playerId, idOf('Ann'));
    assert.equal(tim.state.room.players.find((player) => player.playerId === idOf('Ann')).connected, true);

    // Again, and this time the server has given her place up by the time she is back.
    server.drop(idOf('Ann'));
    const room = server.roomOf(idOf('Tim'));
    room.players = room.players.filter((player) => player.playerId !== idOf('Ann'));
    fireTimers();
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.OFFLINE, 'a stranger to the server is no use to a match in progress');
    assert.equal(ann.state.me.playerId, idOf('Ann'));
    assert.equal(ann.ui.match.phase, 'playing', 'which goes on over the links');
    assert.equal(tim.lan.server.pilots.get(idOf('Ann')).link?.isOpen, true);
});

test('a device whose network is back tries the lobby at once, not at its next try', async () => {
    const { server, network, idOf, byName: { Tim: tim, Ann: ann }, play } = await refereedMatch(['Tim', 'Ann']);

    server.drop(idOf('Ann'));
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.OFFLINE);
    const waiting = network.timers.length;

    network.events.dispatchEvent(new Event('online'));
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.ONLINE);
    assert.equal(ann.state.me.playerId, idOf('Ann'));
    assert.equal(tim.state.room.players.find((player) => player.playerId === idOf('Ann')).connected, true);
    assert.ok(network.timers.length < waiting, 'and the try it was waiting for is off');
    // Once back, the browser's word changes nothing.
    network.events.dispatchEvent(new Event('online'));
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.ONLINE);
});

test('a device that sees its lobby connection drop before the server does still gets its place back', async () => {
    const { server, idOf, byName: { Tim: tim, Ann: ann }, play, fireTimers } = await refereedMatch(['Tim', 'Ann']);

    // Her phone moved to another network: its end of the connection is gone; the server will take a while to notice.
    server.clients.get(idOf('Ann')).handlers.onDisconnected();
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.OFFLINE);
    assert.equal(tim.state.room.players.find((player) => player.playerId === idOf('Ann')).connected, true, 'as far as the server knows');

    fireTimers();
    await play(0.5);
    assert.equal(ann.state.status, LAN_STATUS.ONLINE);
    assert.equal(ann.state.me.playerId, idOf('Ann'));
    assert.equal(ann.lan.matchHostId, idOf('Tim'));
    assert.equal(ann.ui.match.phase, 'playing');
});

test('without the lobby server the devices settle who takes over among themselves, as on one Wi-Fi', async () => {
    const party = await refereedMatch(['Tim', 'Ann', 'Bo']);
    const { server, idOf, byName: { Tim: tim, Ann: ann, Bo: bo }, play, lose } = party;
    server.offline = true;
    server.crash();
    await play(0.25);

    lose(tim);
    await play(1);

    assert.ok(ann.lan.server, 'Ann was next in line, and held a checkpoint');
    assert.equal(bo.lan.matchHostId, idOf('Ann'));
    assert.equal(bo.lan.client.migrating, false);
});
