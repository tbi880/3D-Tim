import { LobbyError } from '../../../src/game/net/lobby/LobbyClient.js';
import { LINK_STATUS } from '../../../src/game/net/transport/PeerLink.js';
import { createMemoryLinkPair } from '../../../src/game/net/transport/MemoryLink.js';

/** A public room's countdown in the fake server (the real one's is the backend's LanRoomManager.AutoStartDelay). */
export const FAKE_AUTO_START_SECONDS = 20;

/**
 * A stand-in for the lobby server and for WebRTC, in memory, so several LanMultiplayer
 * controllers can meet in one test. It follows the real server's rules where the controller
 * depends on them (the owner is ready, a match needs everybody ready, signals carry the real
 * sender, a room passes to the next player when its owner leaves, only network rooms are
 * listed, quick match fills a public room or opens one, a public room counts down once
 * everybody is ready, the match goes to the device the reports favour, a player who drops
 * during a match keeps their place and takes it back with their resume token, the server rules
 * who runs a match from the host's snapshots); the real rules are tested in the backend.
 */
export class FakeLobbyServer {
    constructor() {
        this.clients = new Map();
        /** Rooms by code, in the order they were opened. */
        this.rooms = new Map();
        this.nextId = 1;
        this.nextRoom = 0;
        this.signals = 0;
        this.fitnessReports = 0;
        /** What GetIceServers answers. */
        this.iceServers = [{ urls: ['stun:stun.test:3478'] }];
        /** The server's clock (milliseconds); tests move it. */
        this.now = () => 0;
        /** Every snapshot a host sent: { playerId, term, snapshot }. */
        this.snapshots = [];
        /** True while a device that reconnects cannot reach the server either. */
        this.offline = false;
        /** Answer nothing to these lobby calls (their promise never settles), by method name: a server out of reach for them. */
        this.unanswered = new Set();
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
            maxPlayers: 10, matchId: null, players: [host], visibility, startsInSeconds: null,
            /** Players the host has put out: not let or matched back in. */
            removed: [],
        };
        this.rooms.set(code, room);
        return room;
    }

    /** What a LanMultiplayer is given as `createLobby`. */
    createLobby = (handlers) => {
        const server = this;
        let me = null;
        const myRoom = () => {
            // A connection the server has dropped can say nothing more.
            if (me && server.clients.get(me.playerId) !== lobby) throw new LobbyError('lan.offline');
            const room = me && server.roomOf(me.playerId);
            if (!room) throw new LobbyError('lan.notInRoom');
            return room;
        };
        const hostedRoom = () => {
            const room = myRoom();
            if (room.hostPlayerId !== me.playerId) throw new LobbyError('lan.notHost');
            return room;
        };
        const player = (profile, isHost) => ({ ...profile, playerId: me.playerId, ready: isHost, isHost, isGuest: true, accountName: null, connected: true, token: me.token });
        const hosting = (matchId) => {
            const room = myRoom();
            if (room.state !== 'InMatch' || !room.hosting || room.matchId !== matchId) throw new LobbyError('lan.noMatchRunning');
            return room;
        };
        const hang = (method) => (server.unanswered.has(method) ? new Promise(() => {}) : null);
        const enter = (room, profile) => {
            if (room.removed.includes(me.playerId)) throw new LobbyError('lan.kicked');
            if (room.state !== 'Lobby') throw new LobbyError('lan.matchInProgress');
            if (room.players.length >= room.maxPlayers) throw new LobbyError('lan.roomFull');
            room.players.push(player(profile, false));
            server.broadcast(room);
            return server.snapshot(room);
        };
        const lobby = {
            handlers,
            async connect() {
                const id = server.nextId++;
                me = { playerId: `p${id}`, isGuest: true, accountName: null, token: `token-${id}` };
                server.clients.set(me.playerId, lobby);
                return { playerId: me.playerId, isGuest: true, accountName: null };
            },
            /**
             * As LobbyClient.resume: a new connection, back in the place the last one held if the server still keeps it -
             * also when the server has not noticed the old connection go yet (it replaces it, as the backend does).
             */
            async resume() {
                const pending = hang('resume');
                if (pending) return pending;
                if (server.offline) throw new LobbyError('lan.offline');
                const token = me?.token;
                const seat = token && [...server.rooms.values()].flatMap((room) => room.players.map((entry) => ({ room, entry })))
                    .find(({ entry }) => entry.token === token);
                const fresh = await lobby.connect();
                if (!seat || seat.room.state !== 'InMatch') return { me: fresh, room: null, match: null };
                server.clients.delete(fresh.playerId);
                me = { ...me, playerId: seat.entry.playerId, token: `token-${server.nextId++}` };
                Object.assign(seat.entry, { connected: true, token: me.token });
                server.clients.set(me.playerId, lobby);
                server.broadcast(seat.room);
                const { hosting: rule } = seat.room;
                return {
                    me: { playerId: me.playerId, isGuest: true, accountName: null },
                    room: server.snapshot(seat.room),
                    match: rule ? { matchId: seat.room.matchId, term: rule.term, hostPlayerId: rule.hostPlayerId, snapshot: null } : null,
                };
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
                    && candidate.players.length < candidate.maxPlayers && !avoid.has(candidate.code) && !candidate.removed.includes(me.playerId));
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
            async reportFitness(fitness) {
                const room = myRoom();
                room.players.find((entry) => entry.playerId === me.playerId).fitness = JSON.parse(JSON.stringify(fitness));
                server.fitnessReports += 1;
            },
            async kickPlayer(playerId) {
                const room = hostedRoom();
                const index = room.players.findIndex((entry) => entry.playerId === playerId && !entry.isHost);
                if (index === -1) throw new LobbyError('lan.playerNotFound');
                room.players.splice(index, 1);
                room.removed.push(playerId);
                server.clients.get(playerId)?.handlers.onKicked(room.code);
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
                room.hosting = null;
                room.players = room.players.filter((entry) => entry.connected);
                for (const entry of room.players) entry.ready = entry.isHost;
                server.broadcast(room);
            },
            async leaveRoom() {
                const room = me && server.roomOf(me.playerId);
                if (!room) return;
                room.players.splice(room.players.findIndex((entry) => entry.playerId === me.playerId), 1);
                if (room.players.length === 0) {
                    server.rooms.delete(room.code);
                    return;
                }
                // The owner has gone: the room is the next player's.
                if (room.hostPlayerId === me.playerId) {
                    room.hostPlayerId = room.players[0].playerId;
                    Object.assign(room.players[0], { isHost: true, ready: true });
                }
                server.broadcast(room);
            },
            async sendSignal(toPlayerId, type, payload) {
                const room = myRoom();
                if (room.players.find((entry) => entry.playerId === toPlayerId)?.connected === false) throw new LobbyError('lan.invalidSignal');
                server.signals += 1;
                server.clients.get(toPlayerId)?.handlers.onSignal({ fromPlayerId: me.playerId, type, payload });
            },
            async putMatchSnapshot(matchId, term, snapshot, succession) {
                const pending = hang('putMatchSnapshot');
                if (pending) return pending;
                const room = hosting(matchId);
                const rule = room.hosting;
                const now = server.now();
                let changed = false;
                if (me.playerId !== rule.hostPlayerId || term !== rule.term) {
                    if (term <= rule.term || server.hostAlive(room, now)) return server.ruling(room, false);
                    Object.assign(rule, { hostPlayerId: me.playerId, term, reports: new Map() });
                    changed = true;
                }
                if (snapshot != null) rule.snapshot = snapshot;
                if (Array.isArray(succession)) rule.succession = [...succession];
                rule.freshUntil = now + 4000;
                server.snapshots.push({ playerId: me.playerId, term, snapshot });
                if (changed) server.announceHost(room);
                return server.ruling(room, false);
            },
            async reportHostLost(matchId, term) {
                const pending = hang('reportHostLost');
                if (pending) return pending;
                const room = hosting(matchId);
                const rule = room.hosting;
                if (term !== rule.term || me.playerId === rule.hostPlayerId) return server.ruling(room, true);
                const now = server.now();
                rule.reports.set(me.playerId, now);
                const reports = [...rule.reports.values()].filter((at) => now - at <= 10000).length;
                const others = room.players.filter((entry) => entry.connected && entry.playerId !== rule.hostPlayerId).length;
                if (server.hostAlive(room, now) && !(reports >= 2 && reports * 2 > others)) return server.ruling(room, true);
                const next = [...rule.succession, ...room.players.map((entry) => entry.playerId)]
                    .filter((id) => id !== rule.hostPlayerId)
                    .map((id) => room.players.find((entry) => entry.playerId === id))
                    .find((entry) => entry?.connected);
                if (!next) return server.ruling(room, true);
                Object.assign(rule, { hostPlayerId: next.playerId, term: rule.term + 1, reports: new Map(), freshUntil: now + 8000 });
                server.announceHost(room);
                return server.ruling(room, true);
            },
        };
        return lobby;
    };

    hostAlive(room, now) {
        const { hosting } = room;
        return now <= hosting.freshUntil && room.players.some((entry) => entry.playerId === hosting.hostPlayerId && entry.connected);
    }

    ruling(room, withSnapshot) {
        const { hosting } = room;
        return { matchId: room.matchId, term: hosting.term, hostPlayerId: hosting.hostPlayerId, snapshot: withSnapshot ? hosting.snapshot ?? null : null };
    }

    /** The room is told its match is run by another device now (EchoesLanEvents.MatchHostChanged). */
    announceHost(room) {
        const ruling = this.ruling(room, true);
        this.toRoom(room, (client) => client.handlers.onMatchHostChanged?.(JSON.parse(JSON.stringify(ruling))));
    }

    /**
     * A player's connection to the lobby drops (what the backend's EchoesLanHub.OnDisconnectedAsync does): during a
     * match they keep their place, shown as not connected; otherwise they leave the room. Their device is told.
     */
    drop(playerId) {
        const client = this.clients.get(playerId);
        const room = this.roomOf(playerId);
        const entry = room?.players.find((candidate) => candidate.playerId === playerId);
        this.clients.delete(playerId);
        if (room && room.state === 'InMatch') {
            entry.connected = false;
            if (room.hostPlayerId === playerId) {
                const owner = room.players.find((candidate) => candidate.connected);
                if (owner) {
                    room.hostPlayerId = owner.playerId;
                    for (const each of room.players) each.isHost = each === owner;
                }
            }
            this.broadcast(room);
        } else if (room) {
            room.players.splice(room.players.indexOf(entry), 1);
            this.broadcast(room);
        }
        client?.handlers.onDisconnected();
    }

    start(room) {
        if (room.players.some((entry) => !entry.ready)) throw new LobbyError('lan.playersNotReady');
        room.state = 'InMatch';
        room.matchId = `match-${this.nextId++}`;
        const succession = this.rankHosts(room);
        room.hosting = { hostPlayerId: succession[0], term: 0, succession, snapshot: null, freshUntil: this.now() + 15000, reports: new Map() };
        const start = {
            matchId: room.matchId, seed: 11, hostPlayerId: succession[0], succession, mode: room.mode, settings: room.settings,
            players: room.players.map((entry) => ({ playerId: entry.playerId, displayName: entry.displayName, shipClassId: entry.shipClassId, loadout: { upgrades: {}, equipment: [] } })),
        };
        this.toRoom(room, (client) => client.handlers.onMatchStarted(start));
        this.broadcast(room);
    }

    /**
     * Player ids, the best host first, as the backend's LanRoomManager.RankHosts orders them:
     * linked to everybody first, then the lower "average round trip + 40 x step cost", then
     * joining order (which, with nothing reported, leaves the owner first).
     */
    rankHosts(room) {
        const rtt = (from, to) => from.fitness?.rttMs?.[to.playerId] ?? to.fitness?.rttMs?.[from.playerId] ?? null;
        return room.players.map((player, index) => {
            const others = room.players.filter((other) => other !== player).map((other) => rtt(player, other));
            const average = others.length === 0 ? 0 : others.reduce((sum, ms) => sum + (ms ?? 2000), 0) / others.length;
            return { id: player.playerId, index, unlinked: others.filter((ms) => ms === null).length, score: average + (player.fitness?.stepCostMs ?? 0) * 40 };
        }).sort((a, b) => a.unlinked - b.unlinked || a.score - b.score || a.index - b.index).map((entry) => entry.id);
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
        const { removed, hosting, ...shown } = room;
        shown.players = room.players.map(({ fitness, token, ...player }) => player);
        return JSON.parse(JSON.stringify({ ...shown, startsInSeconds: this.countingDown(room) ? FAKE_AUTO_START_SECONDS : null }));
    }

    toRoom(room, action) {
        for (const entry of [...room.players]) {
            const client = this.clients.get(entry.playerId);
            if (client && entry.connected !== false) action(client);
        }
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
