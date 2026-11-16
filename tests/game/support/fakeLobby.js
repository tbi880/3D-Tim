import { LobbyError } from '../../../src/game/net/lobby/LobbyClient.js';
import { LINK_STATUS } from '../../../src/game/net/transport/PeerLink.js';
import { createMemoryLinkPair } from '../../../src/game/net/transport/MemoryLink.js';

/** A public room's countdown in the fake server (the real one's is the backend's LanRoomManager.AutoStartDelay). */
export const FAKE_AUTO_START_SECONDS = 20;

/**
 * A stand-in for the lobby server and for WebRTC, in memory, so several LanMultiplayer
 * controllers can meet in one test. It follows the real server's rules where the controller
 * depends on them (the host is ready, a match needs everybody ready, signals carry the real
 * sender, the room closes with its host, only network rooms are listed, quick match fills a
 * public room or opens one, a public room counts down once everybody is ready); the real
 * rules are tested in the backend.
 */
export class FakeLobbyServer {
    constructor() {
        this.clients = new Map();
        /** Rooms by code, in the order they were opened. */
        this.rooms = new Map();
        this.nextId = 1;
        this.nextRoom = 0;
        this.signals = 0;
        /** What GetIceServers answers. */
        this.iceServers = [{ urls: ['stun:stun.test:3478'] }];
    }

    roomOf(playerId) {
        return [...this.rooms.values()].find((room) => room.players.some((player) => player.playerId === playerId)) ?? null;
    }

    openRoom(host, options, visibility) {
        // The first room keeps the code the older tests type in.
        const code = this.nextRoom === 0 ? 'ABCDE' : `ROOM${String.fromCharCode(65 + this.nextRoom)}`;
        this.nextRoom += 1;
        const room = {
            code, state: 'Lobby', hostPlayerId: host.playerId, mode: options?.mode ?? 'battleRoyale', settings: options?.settings ?? {},
            maxPlayers: 6, matchId: null, players: [host], visibility, startsInSeconds: null,
        };
        this.rooms.set(code, room);
        return room;
    }

    /** What a LanMultiplayer is given as `createLobby`. */
    createLobby = (handlers) => {
        const server = this;
        let me = null;
        const myRoom = () => {
            const room = me && server.roomOf(me.playerId);
            if (!room) throw new LobbyError('lan.notInRoom');
            return room;
        };
        const hostedRoom = () => {
            const room = myRoom();
            if (room.hostPlayerId !== me.playerId) throw new LobbyError('lan.notHost');
            return room;
        };
        const player = (profile, isHost) => ({ ...profile, playerId: me.playerId, ready: isHost, isHost, isGuest: true, accountName: null });
        const enter = (room, profile) => {
            if (room.state !== 'Lobby') throw new LobbyError('lan.matchInProgress');
            if (room.players.length >= room.maxPlayers) throw new LobbyError('lan.roomFull');
            room.players.push(player(profile, false));
            server.broadcast(room);
            return server.snapshot(room);
        };
        const lobby = {
            handlers,
            async connect() {
                me = { playerId: `p${server.nextId++}`, isGuest: true, accountName: null };
                server.clients.set(me.playerId, lobby);
                return me;
            },
            async disconnect() {
                if (!me) return;
                await lobby.leaveRoom().catch(() => {});
                server.clients.delete(me.playerId);
                me = null;
            },
            async listRooms() {
                return [...server.rooms.values()].filter((room) => room.state === 'Lobby' && room.visibility === 'Network').map((room) => ({
                    code: room.code, hostName: room.players[0].displayName, hostDeviceName: room.players[0].deviceName,
                    hostDeviceKind: room.players[0].deviceKind, playerCount: room.players.length, maxPlayers: room.maxPlayers,
                }));
            },
            async getIceServers() {
                return JSON.parse(JSON.stringify(server.iceServers));
            },
            async createRoom(profile, options) {
                return server.snapshot(server.openRoom(player(profile, true), options, options?.visibility ?? 'Network'));
            },
            async joinRoom(code, profile) {
                const room = server.rooms.get(code);
                if (!room) throw new LobbyError('lan.roomNotFound');
                return enter(room, profile);
            },
            async quickMatch(profile, criteria) {
                const avoid = new Set(criteria?.avoid ?? []);
                const room = [...server.rooms.values()].find((candidate) => candidate.visibility === 'Public' && candidate.state === 'Lobby'
                    && candidate.players.length < candidate.maxPlayers && !avoid.has(candidate.code));
                return room ? enter(room, profile) : server.snapshot(server.openRoom(player(profile, true), { mode: criteria?.mode }, 'Public'));
            },
            async updateProfile(profile) {
                const room = myRoom();
                Object.assign(room.players.find((entry) => entry.playerId === me.playerId), profile);
                server.broadcast(room);
            },
            async setReady(ready) {
                const room = myRoom();
                const entry = room.players.find((candidate) => candidate.playerId === me.playerId);
                if (!entry.isHost) entry.ready = ready;
                server.broadcast(room);
            },
            async updateOptions(options) {
                const room = hostedRoom();
                Object.assign(room, Object.fromEntries(Object.entries(options).filter(([, value]) => value != null)));
                server.broadcast(room);
            },
            async startMatch() {
                server.start(hostedRoom());
            },
            async endMatch() {
                const room = hostedRoom();
                room.state = 'Lobby';
                room.matchId = null;
                for (const entry of room.players) entry.ready = entry.isHost;
                server.broadcast(room);
            },
            async leaveRoom() {
                const room = me && server.roomOf(me.playerId);
                if (!room) return;
                room.players.splice(room.players.findIndex((entry) => entry.playerId === me.playerId), 1);
                if (room.hostPlayerId === me.playerId) {
                    server.rooms.delete(room.code);
                    for (const entry of room.players.splice(0)) server.clients.get(entry.playerId)?.handlers.onRoomClosed(room.code);
                } else {
                    server.broadcast(room);
                }
            },
            async sendSignal(toPlayerId, type, payload) {
                myRoom();
                server.signals += 1;
                server.clients.get(toPlayerId)?.handlers.onSignal({ fromPlayerId: me.playerId, type, payload });
            },
        };
        return lobby;
    };

    start(room) {
        if (room.players.some((entry) => !entry.ready)) throw new LobbyError('lan.playersNotReady');
        room.state = 'InMatch';
        room.matchId = `match-${this.nextId++}`;
        const start = {
            matchId: room.matchId, seed: 11, hostPlayerId: room.hostPlayerId, mode: room.mode, settings: room.settings,
            players: room.players.map((entry) => ({ playerId: entry.playerId, displayName: entry.displayName, shipClassId: entry.shipClassId, loadout: { upgrades: {}, equipment: [] } })),
        };
        this.toRoom(room, (client) => client.handlers.onMatchStarted(start));
        this.broadcast(room);
    }

    /** The countdowns run out: every public room that was counting starts (the backend's LanAutoStartService). */
    startDueRooms() {
        for (const room of [...this.rooms.values()]) {
            if (this.countingDown(room)) this.start(room);
        }
    }

    countingDown(room) {
        return room.visibility === 'Public' && room.state === 'Lobby' && room.players.length >= 2 && room.players.every((entry) => entry.ready);
    }

    snapshot(room) {
        return JSON.parse(JSON.stringify({ ...room, startsInSeconds: this.countingDown(room) ? FAKE_AUTO_START_SECONDS : null }));
    }

    toRoom(room, action) {
        for (const entry of [...room.players]) action(this.clients.get(entry.playerId));
    }

    broadcast(room) {
        this.toRoom(room, (client) => client.handlers.onRoomUpdated(this.snapshot(room)));
    }

    /** The lobby server goes away for everybody (the internet drops; the Wi-Fi is still there). */
    crash() {
        for (const client of this.clients.values()) client.handlers.onDisconnected();
    }
}

/**
 * Stand-in for WebRTC: links that open after an offer / answer exchange through the fake
 * lobby, carried by in-memory pipes. `ends` collects every pipe so a test can pump them.
 */
export class FakeNetwork {
    constructor() {
        this.offers = new Map();
        /** Links that have sent an offer and not heard back, by offer. */
        this.calling = new Map();
        this.ends = [];
        this.nextOffer = 1;
        /** Set to true to make every new link fail to connect. */
        this.blocked = false;
        /** Owners (see `createLink`) whose devices nobody can reach: an offer to one of them goes unanswered and fails. */
        this.unreachable = new Set();
        /** The `iceServers` every link was made with, in order. */
        this.iceServersUsed = [];
    }

    /**
     * What a LanMultiplayer is given as `createLink`. `owner` names the device the link is
     * on, for `unreachable`; tests that need it wrap this function to pass it.
     */
    createLink = ({ initiator, sendSignal, onStatus, iceServers = null, owner = null }) => {
        const network = this;
        network.iceServersUsed.push(iceServers);
        const link = {
            status: LINK_STATUS.CONNECTING,
            end: null,
            onClose: null,
            get isOpen() { return link.status === LINK_STATUS.OPEN; },
            set onState(handler) { link.pendingState = handler; if (link.end) link.end.onState = handler; },
            get onState() { return link.end?.onState ?? link.pendingState ?? null; },
            set onMessage(handler) { link.pendingMessage = handler; if (link.end) link.end.onMessage = handler; },
            get onMessage() { return link.end?.onMessage ?? link.pendingMessage ?? null; },
            sendState(buffer) { link.end?.sendState(buffer); },
            sendMessage(text) { link.end?.sendMessage(text); },
            open(end) {
                link.end = end;
                network.ends.push(end);
                end.onClose = () => link.close();
                if (link.pendingState) end.onState = link.pendingState;
                if (link.pendingMessage) end.onMessage = link.pendingMessage;
                link.status = LINK_STATUS.OPEN;
                onStatus(link.status);
            },
            handleSignal(type, payload) {
                if (link.status !== LINK_STATUS.CONNECTING) return;
                if (network.blocked) {
                    link.close();
                    return;
                }
                if (type === 'offer' && !initiator && network.unreachable.has(owner)) {
                    // The caller never hears back: for them the attempt times out.
                    link.close();
                    network.calling.get(payload)?.close();
                    return;
                }
                if (type === 'offer' && !initiator) {
                    const [here, there] = createMemoryLinkPair();
                    network.offers.set(payload, there);
                    link.open(here);
                    sendSignal('answer', payload);
                } else if (type === 'answer' && initiator) {
                    link.open(network.offers.get(payload));
                    network.offers.delete(payload);
                }
            },
            close() {
                if (link.status === LINK_STATUS.CLOSED) return;
                link.status = LINK_STATUS.CLOSED;
                onStatus(link.status);
                const { end } = link;
                if (end) {
                    end.onClose = null;
                    end.close();
                }
                link.onClose?.();
            },
        };
        // Like the real thing, nothing happens before the caller has the link in its hands.
        if (initiator) {
            queueMicrotask(() => {
                if (network.blocked) link.close();
                else if (link.status === LINK_STATUS.CONNECTING) {
                    const offer = `offer-${network.nextOffer++}`;
                    network.calling.set(offer, link);
                    sendSignal('offer', offer);
                }
            });
        }
        return link;
    };

    /** Carries every packet in flight to its other end. */
    pump() {
        for (const end of this.ends) end.deliver();
    }
}
