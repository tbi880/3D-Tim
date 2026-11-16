import { LobbyError } from '../../../src/game/net/lobby/LobbyClient.js';
import { LINK_STATUS } from '../../../src/game/net/transport/PeerLink.js';
import { createMemoryLinkPair } from '../../../src/game/net/transport/MemoryLink.js';

/**
 * A stand-in for the lobby server and for WebRTC, in memory, so several LanMultiplayer
 * controllers can meet in one test. It follows the real server's rules where the controller
 * depends on them (the host is ready, a match needs everybody ready, signals carry the real
 * sender, the room closes with its host); the real rules are tested in the backend.
 */
export class FakeLobbyServer {
    constructor() {
        this.clients = new Map();
        this.room = null;
        this.nextId = 1;
        this.signals = 0;
    }

    /** What a LanMultiplayer is given as `createLobby`. */
    createLobby = (handlers) => {
        const server = this;
        let me = null;
        const requireRoom = () => {
            if (!server.room?.players.some((player) => player.playerId === me?.playerId)) throw new LobbyError('lan.notInRoom');
        };
        const player = (profile, isHost) => ({ ...profile, playerId: me.playerId, ready: isHost, isHost, isGuest: true, accountName: null });
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
                const { room } = server;
                return room && room.state === 'Lobby'
                    ? [{ code: room.code, hostName: room.players[0].displayName, hostDeviceName: room.players[0].deviceName, hostDeviceKind: room.players[0].deviceKind, playerCount: room.players.length, maxPlayers: room.maxPlayers }]
                    : [];
            },
            async createRoom(profile, options) {
                server.room = { code: 'ABCDE', state: 'Lobby', hostPlayerId: me.playerId, mode: options?.mode ?? 'battleRoyale', settings: options?.settings ?? {}, maxPlayers: 6, matchId: null, players: [player(profile, true)] };
                return server.snapshot();
            },
            async joinRoom(code, profile) {
                if (!server.room || code !== server.room.code) throw new LobbyError('lan.roomNotFound');
                if (server.room.state !== 'Lobby') throw new LobbyError('lan.matchInProgress');
                server.room.players.push(player(profile, false));
                server.broadcast();
                return server.snapshot();
            },
            async updateProfile(profile) {
                requireRoom();
                Object.assign(server.room.players.find((entry) => entry.playerId === me.playerId), profile);
                server.broadcast();
            },
            async setReady(ready) {
                requireRoom();
                const entry = server.room.players.find((candidate) => candidate.playerId === me.playerId);
                if (!entry.isHost) entry.ready = ready;
                server.broadcast();
            },
            async updateOptions(options) {
                requireRoom();
                if (server.room.hostPlayerId !== me.playerId) throw new LobbyError('lan.notHost');
                Object.assign(server.room, Object.fromEntries(Object.entries(options).filter(([, value]) => value != null)));
                server.broadcast();
            },
            async startMatch() {
                requireRoom();
                const { room } = server;
                if (room.hostPlayerId !== me.playerId) throw new LobbyError('lan.notHost');
                if (room.players.some((entry) => !entry.ready)) throw new LobbyError('lan.playersNotReady');
                room.state = 'InMatch';
                room.matchId = `match-${server.nextId++}`;
                const start = {
                    matchId: room.matchId, seed: 11, hostPlayerId: room.hostPlayerId, mode: room.mode, settings: room.settings,
                    players: room.players.map((entry) => ({ playerId: entry.playerId, displayName: entry.displayName, shipClassId: entry.shipClassId, loadout: { upgrades: {}, equipment: [] } })),
                };
                server.toRoom((client) => client.handlers.onMatchStarted(start));
                server.broadcast();
            },
            async endMatch() {
                requireRoom();
                if (server.room.hostPlayerId !== me.playerId) throw new LobbyError('lan.notHost');
                server.room.state = 'Lobby';
                server.room.matchId = null;
                for (const entry of server.room.players) entry.ready = entry.isHost;
                server.broadcast();
            },
            async leaveRoom() {
                const { room } = server;
                if (!room || !me) return;
                const index = room.players.findIndex((entry) => entry.playerId === me.playerId);
                if (index === -1) return;
                room.players.splice(index, 1);
                if (room.hostPlayerId === me.playerId) {
                    server.room = null;
                    for (const entry of room.players) server.clients.get(entry.playerId)?.handlers.onRoomClosed(room.code);
                } else {
                    server.broadcast();
                }
            },
            async sendSignal(toPlayerId, type, payload) {
                requireRoom();
                server.signals += 1;
                server.clients.get(toPlayerId)?.handlers.onSignal({ fromPlayerId: me.playerId, type, payload });
            },
        };
        return lobby;
    };

    snapshot() {
        return JSON.parse(JSON.stringify(this.room));
    }

    toRoom(action) {
        for (const entry of this.room.players) action(this.clients.get(entry.playerId));
    }

    broadcast() {
        this.toRoom((client) => client.handlers.onRoomUpdated(this.snapshot()));
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
        this.ends = [];
        this.nextOffer = 1;
        /** Set to true to make every new link fail to connect. */
        this.blocked = false;
    }

    /** What a LanMultiplayer is given as `createLink`. */
    createLink = ({ initiator, sendSignal, onStatus }) => {
        const network = this;
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
                else if (link.status === LINK_STATUS.CONNECTING) sendSignal('offer', `offer-${network.nextOffer++}`);
            });
        }
        return link;
    };

    /** Carries every packet in flight to its other end. */
    pump() {
        for (const end of this.ends) end.deliver();
    }
}
