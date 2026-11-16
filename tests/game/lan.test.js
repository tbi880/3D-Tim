import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_KIND, describeDevice } from '../../src/game/net/lobby/deviceInfo.js';
import { LAN_ERROR, LAN_STATUS, LanMultiplayer, ROOM_STATE, cleanName, initialLanState } from '../../src/game/net/lobby/LanMultiplayer.js';
import { LOBBY_ERROR, LobbyClient, LobbyError } from '../../src/game/net/lobby/LobbyClient.js';
import { LINK_STATUS } from '../../src/game/net/transport/PeerLink.js';
import { PHASE } from '../../src/game/state/GameSession.js';
import { FakeLobbyServer, FakeNetwork } from './support/fakeLobby.js';
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
    assert.deepEqual(guest.log.events.sort(), ['MatchStarted', 'RoomClosed', 'RoomListChanged', 'RoomUpdated', 'Signal']);

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

    assert.deepEqual(log.invoked.slice(1), [
        ['CreateRoom', profile, { mode: 'battleRoyale' }], ['JoinRoom', 'ABCDE', profile], ['SetReady', true],
        ['SendSignal', 'p2', 'offer', 'sdp'], ['StartMatch'], ['LeaveRoom'],
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

/** One device: a session, a store and a controller on the shared fake lobby and network. */
function device(server, network, name, ship = 'kestrel') {
    const { session, ui } = createTestSession({ playerShip: ship });
    let state = initialLanState();
    const store = { set: (partial) => { state = { ...state, ...partial }; }, get: () => state };
    let saved = name;
    const lan = new LanMultiplayer({
        session, store, createLobby: server.createLobby, createLink: network.createLink,
        device: { name: `${name}'s device`, kind: DEVICE_KIND.DESKTOP },
        nameStore: { load: () => saved, save: (value) => { saved = value; } },
        timers: { setTimeout: (callback) => { network.timers.push(callback); return callback; }, clearTimeout: (callback) => { network.timers = network.timers.filter((timer) => timer !== callback); } },
    });
    return { lan, session, ui, controls: idle(), get state() { return state; }, get savedName() { return saved; } };
}

function lanParty(names) {
    const server = new FakeLobbyServer();
    const network = new FakeNetwork();
    network.timers = [];
    const devices = names.map((name) => device(server, network, name));
    const settle = () => new Promise((resolve) => { setImmediate(resolve); });
    const run = (seconds) => {
        for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
            network.pump();
            for (const each of devices) each.session.update(1 / 60, each.controls);
        }
    };
    const fireTimers = () => { for (const timer of network.timers.splice(0)) timer(); };
    return { server, network, devices, settle, run, fireTimers };
}

/** Everybody online, the first hosting a room the others have joined and are linked to. */
async function gathered(names) {
    const party = lanParty(names);
    const [host, ...guests] = party.devices;
    for (const each of party.devices) await each.lan.open();
    await host.lan.createRoom({ mode: 'battleRoyale', settings: { pace: 'quick', intro: 'skip' } });
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

test('a joiner links to the host on entering the room, not when the match starts', async () => {
    const { host, guests: [ann, bo], server } = await gathered(['Tim', 'Ann', 'Bo']);
    const idOf = (each) => each.state.me.playerId;

    assert.deepEqual(ann.state.links, { [idOf(host)]: LINK_STATUS.OPEN });
    assert.deepEqual(bo.state.links, { [idOf(host)]: LINK_STATUS.OPEN });
    assert.deepEqual(host.state.links, { [idOf(ann)]: LINK_STATUS.OPEN, [idOf(bo)]: LINK_STATUS.OPEN });
    assert.equal(server.signals, 4, 'an offer and an answer per joiner; joiners do not link to each other');
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

test('a guest who leaves is gone from the room; the host leaving closes it for everybody', async () => {
    const { host, guests: [ann, bo], settle } = await gathered(['Tim', 'Ann', 'Bo']);

    await ann.lan.leaveRoom();
    await settle();
    assert.equal(ann.state.room, null);
    assert.deepEqual(ann.state.links, {});
    assert.deepEqual(host.state.room.players.map((player) => player.displayName), ['Tim', 'Bo']);
    assert.deepEqual(Object.keys(host.state.links), [bo.state.me.playerId], 'and the host lets go of the link');

    await host.lan.leaveRoom();
    await settle();
    assert.equal(bo.state.room, null);
    assert.equal(bo.state.error, LAN_ERROR.ROOM_CLOSED);
    assert.deepEqual(bo.state.links, {});
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

test('signals from anybody but the host are ignored by a joiner', async () => {
    const { guests: [ann, bo] } = await gathered(['Tim', 'Ann', 'Bo']);
    const linksBefore = { ...ann.state.links };

    ann.lan.onSignal({ fromPlayerId: bo.state.me.playerId, type: 'offer', payload: 'offer-99' });
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
