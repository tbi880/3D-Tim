import { DEFAULT_GAME_MODE, gameModeOf } from '../../modes/index.js';
import { ClientMatch } from '../match/ClientMatch.js';
import { HostSeat } from '../match/HostSeat.js';
import { normalizeMatchInfo } from '../match/matchInfo.js';
import { NET, cleanIceServers } from '../netConfig.js';
import { MSG } from '../protocol.js';
import { MatchServer } from '../server/MatchServer.js';
import { LINK_STATUS } from '../transport/PeerLink.js';
import { LOBBY_ERROR } from './LobbyClient.js';
import { packSnapshot, unpackSnapshot } from './matchSnapshot.js';

/** Values of the backend's LanRoomState. */
export const ROOM_STATE = Object.freeze({ LOBBY: 'Lobby', IN_MATCH: 'InMatch' });

/** Values of the backend's LanRoomVisibility: who can find a room (anybody with its code can join it). */
export const ROOM_VISIBILITY = Object.freeze({
    /** Listed to the players on the network it was created from. */
    NETWORK: 'Network',
    /** Filled by quick match from anywhere; the server starts it once enough players are in. */
    PUBLIC: 'Public',
    /** Code only. */
    PRIVATE: 'Private',
});

/** Which multiplayer the player opened from the title screen. */
export const LOBBY_SCOPE = Object.freeze({
    /** Players on one Wi-Fi: rooms on this network are listed. */
    LAN: 'lan',
    /** Players anywhere: quick match, or a room's code. */
    GLOBAL: 'global',
});

export const LAN_STATUS = Object.freeze({ OFFLINE: 'offline', CONNECTING: 'connecting', ONLINE: 'online' });

/** Errors this side raises itself, next to the server's `lan.*` codes (all have text in the i18n files). */
export const LAN_ERROR = Object.freeze({
    ROOM_CLOSED: 'lan.roomClosed', NO_LINK: 'lan.noLink', LINK_FAILED: 'lan.linkFailed',
    /** The host put this player out of the room. */
    KICKED: 'lan.kicked',
    /** Quick match: no host could be reached, in any of the rooms tried. */
    NO_HOST_REACHABLE: 'lan.noHostReachable',
});

const MAX_NAME_LENGTH = 20;
/** Seconds before a joining player's device tries again to reach the host after a failed attempt. */
const RELINK_DELAY = 1.5;
const RELINK_ATTEMPTS = 3;
/** Seconds between a change in this device's links and its report of them to the lobby server. */
const REPORT_DELAY = 1;
/** Quick match: rooms whose host this device could not reach that are tried before giving up. */
const MATCH_ROOMS_TRIED = 3;

export const initialLanState = () => ({
    /** LAN_STATUS: the connection to the lobby server. */
    status: LAN_STATUS.OFFLINE,
    /** Code of the last thing that went wrong (a `lan.*` i18n key), or null. */
    error: null,
    /** Who the lobby server takes this device to be: { playerId, isGuest, accountName }. */
    me: null,
    /** Rooms on this network that can be joined (LanRoomSummaryDTO). */
    rooms: [],
    /** The room this device is in (LanRoomStateDTO), or null. */
    room: null,
    /** Links to other devices by player id (LINK_STATUS): on the host one per player, elsewhere the one to the host. */
    links: {},
    /** The name this player goes by. */
    pilotName: '',
    /** What the player takes into the next match: { equipment } - a piece of the mode's equipment, or null. */
    loadout: { equipment: null },
    /** LOBBY_SCOPE: which multiplayer the player opened. */
    scope: LOBBY_SCOPE.LAN,
    /** True from asking for a quick match until the match starts (or the player gives up): rooms come and go by themselves. */
    matching: false,
    /** A public room's countdown: the time (`Date.now()` milliseconds) the server starts the match at, or null. */
    startsAt: null,
});

/**
 * Multiplayer, from the lobby to the match and back: the one object the menus talk to. It
 * serves both kinds (LOBBY_SCOPE): players on one Wi-Fi, who see each other's rooms, and
 * players anywhere, who are matched into public rooms or share a room's code. The rooms,
 * the links and the match are the same; only how a room is found differs. (The names say
 * "LAN" because that came first.)
 *
 * It keeps three things in step:
 *  - the lobby server (LobbyClient): which rooms exist, who is in this one, who is ready;
 *  - the links between the devices (PeerLink): every device in a room connects straight to
 *    every other as soon as it enters, so a link that will not work shows up in the lobby
 *    and not when the match starts - and, in a quick match, sends this device on to another
 *    room by itself;
 *  - the game session: when the server announces a match, the host's device starts a
 *    MatchServer and every device a ClientMatch on the same GameSession the campaign uses.
 *
 *
 * Whose device runs a match is not whoever owns the room. Every device measures how fast it
 * simulates and its round trip to each of the others, and reports it; the lobby server
 * gives the match to the best of them. And because every device is linked to every other,
 * the match can outlive that device: if it is lost, the next in the line it kept (it also
 * kept them supplied with checkpoints of the whole match) builds a server from the last
 * checkpoint, tells the others, and they turn to it ("Who runs the match" below). Across the
 * internet the lobby server is the referee of that: the host sends it a snapshot every second,
 * and a device that has lost the host asks it what to do ("The lobby server as referee").
 *
 * It has no React in it; the menus read its state from a store (`store.set` / `store.get`).
 */
export class LanMultiplayer {
    /**
     * @param {object} params
     * @param {import('../../state/GameSession.js').GameSession} params.session
     * @param {{ set: (partial: object) => void, get: () => object }} params.store holds `initialLanState()`
     * @param {(handlers: object) => import('./LobbyClient.js').LobbyClient} params.createLobby
     * @param {(options: object) => object} params.createLink builds a PeerLink ({ initiator, sendSignal, onStatus })
     * @param {{ name: string, kind: string }} params.device from describeDevice
     * @param {{ load: () => string, save: (name: string) => void }} params.nameStore remembers the player's name
     * @param {{ load: () => object, save: (loadout: object) => void }} [params.loadoutStore] remembers the player's loadout
     * @param {object} [params.timers] { setTimeout, clearTimeout }
     * @param {() => number} [params.now] wall clock in milliseconds (a public room's countdown, round trips between devices)
     * @param {() => number} [params.measureStepCost] how fast this device simulates (lobby/hostFitness.js); slow to run, so asked once
     */
    constructor({ session, store, createLobby, createLink, device, nameStore, loadoutStore = null, timers = globalThis, now = Date.now, measureStepCost = () => 0 }) {
        this.session = session;
        this.store = store;
        this.createLink = createLink;
        this.device = device;
        this.nameStore = nameStore;
        this.loadoutStore = loadoutStore;
        this.timers = timers;
        this.now = now;
        /** STUN / TURN servers from the lobby server, for every link this device opens. */
        this.iceServers = cleanIceServers(null);
        /** Quick match: codes of rooms whose host this device could not reach. */
        this.unreachableRooms = [];
        this.measureStepCost = measureStepCost;
        /** Milliseconds this device takes for a step of the benchmark simulation; null until measured. */
        this.stepCost = null;
        /** @type {Map<string, object>} player id -> link: one to every other player in the room */
        this.links = new Map();
        /** Links this device is trying again, by player id: { timer, attempts }. */
        this.relinks = new Map();
        /** Round trip in milliseconds to each linked player, as last measured. */
        this.peerRtt = new Map();
        this.pingTimer = null;
        this.reportTimer = null;
        /** The match server, while this device is hosting a match. */
        this.server = null;
        /** This device's own client in the match being played (on the host's device too), or null. */
        this.client = null;
        /** The player whose device runs the match being played. */
        this.matchHostId = null;
        /** While looking for a new host: { tried: Set of player ids, timer }. */
        this.succession = null;
        /** While this device's client has lost its host and the lobby server is asked about it: { since, timer, asking, renewedAt }. */
        this.hostSearch = null;
        /** True while a snapshot is on its way to the lobby server (the next waits for it). */
        this.uploading = false;
        /** While trying to get back to the lobby server during a match: { attempt, timer }. */
        this.lobbyRetry = null;
        this.lobby = createLobby({
            onRoomUpdated: (room) => this.onRoomUpdated(room),
            onRoomClosed: () => this.onRoomClosed(),
            onRoomListChanged: (rooms) => this.store.set({ rooms: Array.isArray(rooms) ? rooms : [] }),
            onMatchStarted: (start) => this.onMatchStarted(start),
            onSignal: (signal) => this.onSignal(signal),
            onKicked: () => this.onKicked(),
            onMatchHostChanged: (ruling) => this.onMatchHost(ruling),
            onDisconnected: () => this.onDisconnected(),
        });
        store.set({ pilotName: cleanName(nameStore.load()), loadout: cleanLoadout(loadoutStore?.load()) });
    }

    get state() {
        return this.store.get();
    }

    get isHost() {
        const { room, me } = this.state;
        return Boolean(room && me && room.hostPlayerId === me.playerId);
    }

    get inMatch() {
        return Boolean(this.session.match);
    }

    // ---- The lobby server --------------------------------------------------------------------

    /**
     * Connects to the lobby server (as the signed-in account, or as a guest), lists the rooms
     * on this network and asks which STUN / TURN servers to use.
     * @param {string} [scope] LOBBY_SCOPE: which multiplayer the player opened
     */
    async open(scope = this.state.scope) {
        this.store.set({ scope });
        if (this.state.status !== LAN_STATUS.OFFLINE) return;
        this.store.set({ status: LAN_STATUS.CONNECTING, error: null });
        try {
            this.stepCost ??= this.measureStepCost();
            const me = await this.lobby.connect();
            const rooms = await this.lobby.listRooms();
            // Without the server's list the default STUN servers still connect most devices.
            this.iceServers = cleanIceServers(await this.lobby.getIceServers().catch(() => null));
            this.store.set({ status: LAN_STATUS.ONLINE, me, rooms });
        } catch (error) {
            this.store.set({ status: LAN_STATUS.OFFLINE, error: codeOf(error) });
        }
    }

    /** Leaves the room and the lobby server. */
    async close() {
        this.stopLobbyRetry();
        this.dropLinks();
        this.unreachableRooms = [];
        await this.lobby.disconnect();
        this.store.set({ ...initialLanState(), pilotName: this.state.pilotName, loadout: this.state.loadout, scope: this.state.scope });
    }

    /** Connects again as whoever is signed in now (after the player signed in or out). */
    async reopen() {
        if (this.state.room) return;
        await this.close();
        await this.open();
    }

    /** Runs a lobby request; a refusal becomes `error` in the store instead of an exception. */
    async attempt(request) {
        this.store.set({ error: null });
        try {
            return await request();
        } catch (error) {
            this.store.set({ error: codeOf(error) });
            return null;
        }
    }

    profile() {
        return {
            displayName: this.state.pilotName,
            deviceName: this.device.name,
            deviceKind: this.device.kind,
            shipClassId: this.session.settings.playerShip,
            // Two games that speak different versions cannot play each other: the lobby keeps them apart.
            protocol: NET.protocolVersion,
        };
    }

    // ---- Rooms -------------------------------------------------------------------------------

    /** Opens a room: one listed to this network by default; `options.visibility` (ROOM_VISIBILITY) says otherwise. */
    async createRoom(options = { mode: DEFAULT_GAME_MODE }) {
        this.enterRoom(await this.attempt(() => this.lobby.createRoom(this.profile(), options)));
    }

    /**
     * The lobby server's answer to creating or joining a room. A room that has been joined
     * is also announced to everybody in it, and by the time the answer is read newer news of
     * it may already be here: the answer only counts if nothing else has said so yet.
     */
    enterRoom(room) {
        if (room && this.state.room?.code !== room.code) this.onRoomUpdated(room);
    }

    /** Opens a room nobody finds by themselves: for friends anywhere who are given its code. */
    createPrivateRoom() {
        return this.createRoom({ mode: DEFAULT_GAME_MODE, visibility: ROOM_VISIBILITY.PRIVATE });
    }

    /**
     * Quick match: asks the lobby server for the best public room that is gathering players
     * (it opens one if there is none). Finding a room that works is this device's business: one
     * that closes, or whose host cannot be reached, is swapped for another. In the room the
     * player says when they are ready, as in any room; the server starts the match once
     * everybody has.
     */
    async quickMatch() {
        this.unreachableRooms = [];
        this.store.set({ matching: true });
        await this.seekMatch();
    }

    async seekMatch() {
        const criteria = { mode: DEFAULT_GAME_MODE, avoid: this.unreachableRooms };
        const room = await this.attempt(() => this.lobby.quickMatch(this.profile(), criteria));
        if (room) this.enterRoom(room);
        else this.store.set({ matching: false });
    }

    async joinRoom(code) {
        this.enterRoom(await this.attempt(() => this.lobby.joinRoom(code, this.profile())));
    }

    /** Leaves the room - and, in a quick match, stops looking for another. */
    async leaveRoom() {
        this.dropLinks();
        this.store.set({ room: null, links: {}, matching: false, startsAt: null });
        if (this.inMatch) this.endMatch();
        await this.attempt(() => this.lobby.leaveRoom());
        await this.refreshRooms();
    }

    /** Asks for the list of rooms again (it is also pushed by the server whenever it changes). */
    async refreshRooms() {
        try {
            this.store.set({ rooms: await this.lobby.listRooms() });
        } catch {
            // Not being able to refresh is not worth an error on screen: the list is pushed as well.
        }
    }

    setReady(ready) {
        return this.attempt(() => this.lobby.setReady(ready));
    }

    /** Host: puts a player out of the room (in the lobby; they cannot come back into this room). */
    kick(playerId) {
        return this.attempt(() => this.lobby.kickPlayer(playerId));
    }

    /** Changes the name the player goes by, here and in the room if they are in one. */
    setPilotName(name) {
        const pilotName = cleanName(name);
        this.nameStore.save(pilotName);
        this.store.set({ pilotName });
        return this.pushProfile();
    }

    /**
     * Changes what the player takes into the next match. It stays on this device: nobody in
     * the room is told, and the game mode asks the host for it when the match begins.
     */
    setLoadout(changes) {
        const loadout = cleanLoadout({ ...this.state.loadout, ...changes });
        this.loadoutStore?.save(loadout);
        this.store.set({ loadout });
    }

    /** Tells the room about a change to the player's name or ship (the ship is the session's `playerShip` setting). */
    pushProfile() {
        if (!this.state.room || this.state.room.state !== ROOM_STATE.LOBBY) return Promise.resolve(null);
        return this.attempt(() => this.lobby.updateProfile(this.profile()));
    }

    /** Host: changes the room's options ({ mode, settings, maxPlayers }; what is left out stays). */
    setOptions(options) {
        return this.attempt(() => this.lobby.updateOptions(options));
    }

    /** Owner: true when the match can start: everybody is ready and this device is linked to every other. */
    get canStart() {
        const { room, links } = this.state;
        if (!this.isHost || room.state !== ROOM_STATE.LOBBY) return false;
        return room.players.every((player) => player.isHost || (player.ready && links[player.playerId] === LINK_STATUS.OPEN));
    }

    startMatch() {
        return this.attempt(() => this.lobby.startMatch());
    }

    /** Host: ends the match for everybody and reopens the lobby. */
    returnToLobby() {
        return this.attempt(() => this.lobby.endMatch());
    }

    // ---- What the lobby server tells us ------------------------------------------------------

    onRoomUpdated(room) {
        const seconds = room.startsInSeconds;
        this.store.set({ room, startsAt: Number.isFinite(seconds) ? this.now() + Math.max(0, seconds) * 1000 : null });
        // The host has ended the match: back to the lobby with everybody else - and then the
        // links follow the room again, also for those who dropped off its list during the match.
        if (room.state === ROOM_STATE.LOBBY && this.inMatch) this.endMatch();
        this.syncLinks(room);
    }

    onRoomClosed() {
        const seeking = this.state.matching && !this.inMatch;
        this.dropLinks();
        this.store.set({ room: null, links: {}, startsAt: null, error: seeking ? null : LAN_ERROR.ROOM_CLOSED });
        if (this.inMatch) this.endMatch();
        // A quick match whose room went away before it started (its host left) simply looks for another.
        if (seeking) this.seekMatch();
        else this.refreshRooms();
    }

    /** The host has put this player out of the room. They are not looking for another: that is theirs to ask for. */
    onKicked() {
        this.dropLinks();
        this.store.set({ room: null, links: {}, matching: false, startsAt: null, error: LAN_ERROR.KICKED });
        if (this.inMatch) this.endMatch();
        this.refreshRooms();
    }

    /**
     * The lobby server is gone. A match in progress does not need it - the devices talk to
     * each other - so it plays on, and this device tries to get its place back (the server
     * keeps it for a while; see `rejoinLobby`). Otherwise the lobby is over.
     */
    onDisconnected() {
        if (!this.inMatch) this.dropLinks();
        this.store.set({ status: LAN_STATUS.OFFLINE, me: this.inMatch ? this.state.me : null, room: this.inMatch ? this.state.room : null, rooms: [], error: LOBBY_ERROR.OFFLINE });
        if (this.inMatch) this.retryLobbySoon();
    }

    retryLobbySoon() {
        if (this.lobbyRetry) return;
        this.lobbyRetry = { attempt: 0, timer: null };
        this.scheduleLobbyRetry();
    }

    scheduleLobbyRetry() {
        const retry = this.lobbyRetry;
        const delay = NET.lobbyRetryDelays[retry.attempt];
        if (delay === undefined) {
            this.lobbyRetry = null;
            return;
        }
        retry.attempt += 1;
        retry.timer = this.timers.setTimeout(() => this.rejoinLobby(retry), delay * 1000);
    }

    stopLobbyRetry() {
        if (this.lobbyRetry) this.timers.clearTimeout(this.lobbyRetry.timer);
        this.lobbyRetry = null;
    }

    /**
     * Connects to the lobby server again and takes back this device's place: the same player,
     * in the same room, in the same match - so the others can reach it again (links are made
     * through the server) and, across the internet, the server can be asked who runs the match.
     * A place that is gone (too long away) is not replaced by a new one: a match in progress
     * has no use for a stranger, so the device plays on without the lobby.
     */
    async rejoinLobby(retry) {
        if (this.lobbyRetry !== retry) return;
        if (!this.inMatch || this.state.status !== LAN_STATUS.OFFLINE) {
            this.lobbyRetry = null;
            return;
        }
        let back = null;
        try {
            back = await this.lobby.resume();
        } catch {
            back = null;
        }
        if (this.lobbyRetry !== retry) return;
        if (!back) {
            this.scheduleLobbyRetry();
            return;
        }
        this.lobbyRetry = null;
        if (!back.room || !this.inMatch || back.me?.playerId !== this.state.me?.playerId) {
            await this.lobby.disconnect();
            return;
        }
        this.store.set({ status: LAN_STATUS.ONLINE, error: null, me: back.me });
        this.onRoomUpdated(back.room);
        if (back.match) await this.onMatchHost(back.match);
    }

    onMatchStarted(start) {
        const info = normalizeMatchInfo(start);
        const mode = gameModeOf(info);
        const localPlayerId = this.state.me.playerId;
        // Players anywhere are further apart than players on one Wi-Fi: their ships are drawn a little later, and smoother for it;
        // and a host across the internet that goes quiet for a moment is given longer before it is given up.
        const global = this.state.scope === LOBBY_SCOPE.GLOBAL;
        const interpolationDelay = global ? NET.internetInterpolationDelay : NET.interpolationDelay;
        const hostLostTimeout = global ? NET.internetHostLostTimeout : NET.hostLostTimeout;
        const createClient = (link) => {
            this.client = new ClientMatch({
                info, localPlayerId, link, interpolationDelay, hostLostTimeout,
                presenter: mode.createPresenter(this.state.loadout),
                onHostLost: () => this.onHostLost(),
                linkReport: () => this.fitness(),
            });
            return this.client;
        };
        this.store.set({ matching: false, startsAt: null });
        this.matchHostId = info.hostPlayerId;
        this.succession = null;

        // The lobby server has chosen whose device runs the match: maybe this one, maybe not the room owner's.
        if (info.hostPlayerId === localPlayerId) {
            this.server = this.createServer(info, { hostPlayerId: localPlayerId });
            for (const [playerId, link] of this.links) {
                if (link.isOpen) this.server.attachLink(playerId, link);
            }
            this.session.beginMatch(new HostSeat({ server: this.server, createClient, localPlayerId }));
            return;
        }
        const link = this.links.get(info.hostPlayerId);
        if (!link?.isOpen) {
            this.matchHostId = null;
            this.store.set({ error: LAN_ERROR.NO_LINK });
            return;
        }
        this.session.beginMatch(createClient(link));
    }

    createServer(info, options) {
        // Across the internet a player whose link breaks keeps their ship for a while, to come back to.
        const rejoinGrace = this.global ? NET.rejoinGrace : 0;
        const server = new MatchServer({ info, mode: gameModeOf(info).createRules(info), rejoinGrace, ...options });
        // A device that has taken the match over says so on every link; one that hears of a later takeover stands down.
        server.onTakeover = (fromPlayerId, term, hostPlayerId) => this.onTakeoverNotice(fromPlayerId, term, hostPlayerId);
        if (this.global) server.onSnapshotDue = () => { this.sendSnapshot(server); };
        return server;
    }

    endMatch() {
        this.server = null;
        this.client = null;
        this.matchHostId = null;
        this.clearSuccession();
        this.stopHostSearch();
        this.stopLobbyRetry();
        this.session.enterTitle();
        // The match had the links' packets; in the lobby they are this controller's again.
        for (const [playerId, link] of this.links) this.watchLink(playerId, link);
    }

    // ---- Links between the devices -----------------------------------------------------------

    /**
     * Keeps the links in step with who is in the room: one to every other player. Of two
     * players the one who joined later reaches for the other, so both ends never call at once.
     *
     * While a match is on, a player missing from the room keeps their link. The room is the
     * lobby server's list, and a device whose connection to the lobby server dropped (a blip
     * of its network, a phone between masts) is taken off it - while its link, and its place
     * in the match, are fine. A player who really leaves closes their links themselves
     * (`leaveRoom`), and a device that is gone loses its link with it; either way the match
     * hears of it from the link.
     */
    syncLinks(room) {
        const { me } = this.state;
        if (!me) return;
        const order = room.players.map((player) => player.playerId);
        const mine = order.indexOf(me.playerId);
        for (const playerId of [...this.links.keys()]) {
            if (!order.includes(playerId) && !(this.inMatch && this.links.get(playerId).isOpen)) this.dropLink(playerId);
        }
        for (const playerId of [...this.relinks.keys()]) {
            if (!order.includes(playerId)) this.forgetRelink(playerId);
        }
        // (A player whose connection to the server is lost cannot be signalled until they are back.)
        const away = new Set(room.players.filter((player) => player.connected === false).map((player) => player.playerId));
        order.slice(0, Math.max(0, mine)).forEach((playerId) => {
            if (!this.links.has(playerId) && !this.relinks.has(playerId) && !away.has(playerId)) this.openLink(playerId, true);
        });
        this.keepPinging();
    }

    /** True when this device is the one that calls `playerId` (it joined the room after them). */
    calls(playerId) {
        const order = this.state.room?.players.map((player) => player.playerId) ?? [];
        const theirs = order.indexOf(playerId);
        return theirs !== -1 && theirs < order.indexOf(this.state.me?.playerId);
    }

    openLink(playerId, initiator) {
        this.dropLink(playerId);
        const link = this.createLink({
            initiator,
            iceServers: this.iceServers,
            sendSignal: (type, payload) => { this.lobby.sendSignal(playerId, type, payload).catch(() => {}); },
            onStatus: (status) => this.onLinkStatus(playerId, link, status),
        });
        this.links.set(playerId, link);
        this.watchLink(playerId, link);
        this.publishLinks();
        return link;
    }

    /**
     * Takes a link's messages while no match is using it: the pings that measure the round
     * trip, and a device saying it has taken a match over. (A link the match is using - the
     * one to its host, or on the host all of them - is the match's until it ends.)
     */
    watchLink(playerId, link) {
        if (this.inMatch && (this.server || playerId === this.matchHostId)) return;
        link.onState = null;
        link.onMessage = (text) => this.onPeerMessage(playerId, link, text);
    }

    onLinkStatus(playerId, link, status) {
        if (this.links.get(playerId) !== link) return;
        if (status === LINK_STATUS.OPEN) {
            this.forgetRelink(playerId);
            this.unreachableRooms = [];
            // A device that linked up late (or again) joins the match that is running.
            if (this.server && this.inMatch) this.server.attachLink(playerId, link);
            // The new link to the host this device's client was waiting for: it turns to it.
            const { client } = this;
            if (!this.server && this.inMatch && client?.migrating && playerId === this.matchHostId && client.link !== link) client.switchLink(link);
        } else if (status === LINK_STATUS.CLOSED) {
            this.links.delete(playerId);
            this.peerRtt.delete(playerId);
            if (this.calls(playerId) && !this.inMatch) this.scheduleRelink(playerId);
        }
        this.publishLinks();
        this.reportFitnessSoon();
    }

    /** A link this device called for and that failed is tried a few more times before it is given up. */
    scheduleRelink(playerId) {
        const relink = this.relinks.get(playerId) ?? { timer: null, attempts: 0 };
        this.relinks.set(playerId, relink);
        if (relink.attempts >= RELINK_ATTEMPTS) {
            this.onUnreachable();
            return;
        }
        relink.attempts += 1;
        this.timers.clearTimeout(relink.timer);
        relink.timer = this.timers.setTimeout(() => {
            if (this.calls(playerId) && !this.links.has(playerId)) this.openLink(playerId, true);
        }, RELINK_DELAY * 1000);
    }

    forgetRelink(playerId) {
        const relink = this.relinks.get(playerId);
        if (!relink) return;
        this.timers.clearTimeout(relink.timer);
        this.relinks.delete(playerId);
    }

    /**
     * A player could not be reached. One missing link is not the end - the match is given
     * to a device everybody reaches - but a device that reaches nobody cannot play here: in a
     * quick match it moves on to another room, otherwise it says so.
     */
    onUnreachable() {
        if (this.links.size > 0) return;
        if (this.state.matching) this.tryAnotherRoom();
        else this.store.set({ error: LAN_ERROR.LINK_FAILED });
    }

    /**
     * Quick match: nobody in this room can be reached from here (networks that will not let
     * each other in, and no relay). Others may be: leave, and ask for a room that is not one
     * of those already tried - a few times, then say so.
     */
    async tryAnotherRoom() {
        const { room } = this.state;
        if (room) this.unreachableRooms.push(room.code);
        const givingUp = this.unreachableRooms.length >= MATCH_ROOMS_TRIED;
        this.dropLinks();
        this.store.set({ room: null, links: {}, startsAt: null });
        await this.lobby.leaveRoom().catch(() => {});
        if (!this.state.matching) return;
        if (givingUp) this.store.set({ matching: false, error: LAN_ERROR.NO_HOST_REACHABLE });
        else await this.seekMatch();
    }

    /** Tries the links that failed again from scratch (the lobby's "retry" button). */
    retryLink() {
        const { room } = this.state;
        if (!room) return;
        for (const playerId of [...this.relinks.keys()]) this.forgetRelink(playerId);
        this.store.set({ error: null });
        this.syncLinks(room);
    }

    onSignal(signal) {
        const { room, me } = this.state;
        const from = signal?.fromPlayerId;
        if (!room || typeof from !== 'string' || typeof signal.type !== 'string' || typeof signal.payload !== 'string') return;
        if (from === me?.playerId || !room.players.some((player) => player.playerId === from)) return;
        // An offer starts a link (again, if that player's device is retrying) - but only from a player who is the one to call.
        // During a match either may call (a client whose link to its host broke calls it again): then an offer is taken
        // unless this device has an offer of its own on the way to that player - of two at once, the caller's wins.
        if (signal.type === 'offer') {
            const mine = this.links.get(from);
            if (this.calls(from) && !(this.inMatch && mine?.status !== LINK_STATUS.CONNECTING)) return;
            this.openLink(from, false);
        }
        this.links.get(from)?.handleSignal(signal.type, signal.payload);
    }

    dropLink(playerId) {
        const link = this.links.get(playerId);
        if (!link) return;
        this.links.delete(playerId);
        this.peerRtt.delete(playerId);
        link.close();
        this.publishLinks();
    }

    dropLinks() {
        for (const playerId of [...this.relinks.keys()]) this.forgetRelink(playerId);
        for (const playerId of [...this.links.keys()]) this.dropLink(playerId);
        this.timers.clearTimeout(this.pingTimer);
        this.timers.clearTimeout(this.reportTimer);
        this.pingTimer = null;
        this.reportTimer = null;
    }

    publishLinks() {
        this.store.set({ links: Object.fromEntries([...this.links].map(([playerId, link]) => [playerId, link.status])) });
    }

    // ---- How good a host this device would be ------------------------------------------------

    /** Pings every link the match is not using, every couple of seconds, for as long as there are links. */
    keepPinging() {
        if (this.pingTimer !== null || this.links.size === 0) return;
        this.pingTimer = this.timers.setTimeout(() => {
            this.pingTimer = null;
            const ping = JSON.stringify({ t: MSG.LINK_PING, n: this.now() });
            for (const [playerId, link] of this.links) {
                const busy = this.inMatch && (this.server || playerId === this.matchHostId);
                if (link.isOpen && !busy) link.sendMessage(ping);
            }
            this.keepPinging();
        }, NET.pingInterval * 1000);
    }

    /** A message on a link no match is using: a ping, its answer, or news of a takeover. */
    onPeerMessage(playerId, link, text) {
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return;
        }
        if (!message || typeof message !== 'object') return;
        if (message.t === MSG.LINK_PING && Number.isFinite(message.n)) {
            if (link.isOpen) link.sendMessage(JSON.stringify({ t: MSG.LINK_PONG, n: message.n }));
        } else if (message.t === MSG.LINK_PONG && Number.isFinite(message.n)) {
            const rtt = Math.round(this.now() - message.n);
            if (rtt >= 0 && rtt < 60000) {
                this.peerRtt.set(playerId, rtt);
                this.reportFitnessSoon();
            }
        } else if (message.t === MSG.TAKEOVER) {
            this.onTakeoverNotice(playerId, message.n, message.h);
        }
    }

    /**
     * What this device knows of its fitness to run a match: how fast it simulates, and its
     * round trip to each player it is linked to (to the match's host, as the match measures it).
     */
    fitness() {
        const rtt = Object.fromEntries(this.peerRtt);
        if (this.client && !this.server && this.matchHostId && Number.isFinite(this.client.rtt)) rtt[this.matchHostId] = this.client.rtt;
        return { stepCost: this.stepCost ?? 0, rtt };
    }

    /** Tells the lobby server, which chooses the host when the match starts. A moment's wait gathers changes that come together. */
    reportFitnessSoon() {
        if (this.reportTimer !== null || !this.state.room || this.inMatch) return;
        this.reportTimer = this.timers.setTimeout(() => {
            this.reportTimer = null;
            if (!this.state.room || this.state.room.state !== ROOM_STATE.LOBBY) return;
            const { stepCost, rtt } = this.fitness();
            this.lobby.reportFitness({ stepCostMs: stepCost, rttMs: rtt }).catch(() => {});
        }, REPORT_DELAY * 1000);
    }

    // ---- Who runs the match when its host is lost --------------------------------------------

    /**
     * This device's client has lost the host. The host named who comes next (and kept them in
     * checkpoints): follow that line. Returns true: the client waits to be given another host.
     */
    onHostLost() {
        if (!this.inMatch || !this.client || this.server) return false;
        // Across the internet, with the lobby server there to ask, it is the referee.
        if (this.refereed) this.askReferee();
        else this.walkSuccession();
        return true;
    }

    walkSuccession() {
        // (Called again if the device this one turned to is lost as well: that one is crossed off too.)
        const tried = this.succession?.tried ?? new Set();
        tried.add(this.matchHostId);
        this.clearSuccession();
        this.succession = { tried, timer: null };
        this.followSuccession();
    }

    /**
     * Turns to the first device in the line that can still be reached - which may be this one.
     * Every device walks the same line, so they arrive at the same device; one that does not
     * answer in time is passed over.
     */
    followSuccession() {
        const { client, succession } = this;
        if (!client || !succession) return;
        const me = this.state.me.playerId;
        for (const playerId of client.succession) {
            if (succession.tried.has(playerId)) continue;
            if (playerId === me) {
                if (this.takeOver()) return;
                succession.tried.add(me);
                continue;
            }
            if (this.links.get(playerId)?.isOpen) {
                this.turnTo(playerId);
                succession.timer = this.timers.setTimeout(() => {
                    // Still no welcome from them: they are gone too, or have no checkpoint. On down the line.
                    if (this.succession !== succession || !client.migrating) return;
                    succession.tried.add(playerId);
                    this.followSuccession();
                }, NET.takeoverTimeout * 1000);
                return;
            }
        }
        this.clearSuccession();
        client.giveUp();
    }

    clearSuccession() {
        if (this.succession) this.timers.clearTimeout(this.succession.timer);
        this.succession = null;
    }

    /** Makes `playerId`'s device this client's host: asks it for the world over the link there already is to it. */
    turnTo(playerId) {
        this.matchHostId = playerId;
        this.client.switchLink(this.links.get(playerId));
    }

    /**
     * This device is next in line: it builds a server from the last checkpoint the old host
     * sent it, takes every link it has for it, and tells the others. The match goes on from
     * the checkpoint - a few seconds back. Returns false if it cannot (it has no checkpoint).
     */
    takeOver({ term = null, snapshot = null } = {}) {
        const { client, session } = this;
        const me = this.state.me.playerId;
        // What there is to go on from - the old host's last checkpoint, the lobby server's last snapshot (JSON text) -
        // newest first. Without either there is nothing (a server made without one would start the match afresh).
        const candidates = [client.latestCheckpoint, snapshot].map(readCheckpoint).filter(Boolean).sort((a, b) => b.time - a.time);
        let server = null;
        for (const { checkpoint } of candidates) {
            try {
                server = this.createServer(client.info, { hostPlayerId: me, checkpoint, term: term ?? client.term + 1 });
                server.start();
                break;
            } catch {
                // One this device cannot read: the other may do (and the next in line may have a better one).
                server = null;
            }
        }
        if (!server) return false;
        // First this device's own client turns to the new server (letting go of the link it had
        // to the old host); only then are the links given to the server - that one among them.
        this.server = server;
        this.matchHostId = me;
        client.term = server.term;
        this.clearSuccession();
        session.replaceMatch(new HostSeat({ server, client, localPlayerId: me }));
        for (const [playerId, link] of this.links) {
            if (link.isOpen) server.attachLink(playerId, link);
        }
        // Whoever cannot be reached from here is out of the match - the device that was lost, first of all. (Across the
        // internet they are away instead: back in their ship if their device comes back in time.)
        for (const pilot of [...server.pilots.values()]) {
            if (!pilot.bot && pilot.id !== me && !pilot.link) server.linkLost(pilot.id);
        }
        const notice = JSON.stringify({ t: MSG.TAKEOVER, n: server.term, h: me });
        for (const link of this.links.values()) {
            if (link.isOpen) link.sendMessage(notice);
        }
        this.stopHostSearch();
        // The server hears of the new host at once: its first snapshot.
        if (this.refereed) this.sendSnapshot(server);
        return true;
    }

    /** This device was running the match and another one does now: its own copy is thrown away, and it plays on as a client. */
    standDown() {
        const { server } = this;
        if (!server) return;
        this.server = null;
        server.dispose();
        this.session.replaceMatch(this.client);
        for (const [playerId, other] of this.links) this.watchLink(playerId, other);
    }

    /**
     * A device says the match is `hostPlayerId`'s now, in term `term`. News of a later term
     * than this device knows wins: a client turns to the new host at once (without waiting to
     * miss the old one), and a device that was running the match itself - it had only stalled,
     * or was cut off from the others - stands down and becomes a client again.
     *
     * Two devices can take over in the same term (each noticed the loss before hearing of the
     * other). Then the one whose player id sorts first is the host, on every device alike.
     */
    onTakeoverNotice(fromPlayerId, term, hostPlayerId) {
        const { client } = this;
        if (!this.inMatch || !client || !Number.isInteger(term)) return;
        const me = this.state.me.playerId;
        if (typeof hostPlayerId !== 'string' || hostPlayerId === me || hostPlayerId === this.matchHostId) return;
        const sameTermButFirst = term === client.term && term > 0 && typeof this.matchHostId === 'string' && hostPlayerId < this.matchHostId;
        if (term < client.term || (term === client.term && !sameTermButFirst)) return;
        client.term = term;
        this.clearSuccession();
        const previousHost = this.matchHostId;
        const link = this.links.get(hostPlayerId);

        if (this.server) {
            // Stand down: the server here is a match nobody is in any more.
            this.standDown();
        } else if (previousHost && previousHost !== hostPlayerId && previousHost !== fromPlayerId) {
            // The old host may not have heard (it is why it was replaced): pass the news on.
            const old = this.links.get(previousHost);
            if (old?.isOpen) old.sendMessage(JSON.stringify({ t: MSG.TAKEOVER, n: term, h: hostPlayerId }));
        }
        // Across the internet a link that is not there is made.
        if (this.global) {
            this.followHost(hostPlayerId);
            return;
        }
        if (!link?.isOpen) {
            client.giveUp();
            return;
        }
        if (previousHost && previousHost !== hostPlayerId) {
            const old = this.links.get(previousHost);
            this.matchHostId = hostPlayerId;
            if (old) this.watchLink(previousHost, old);
        }
        this.turnTo(hostPlayerId);
    }

    // ---- The lobby server as referee (across the internet) -----------------------------------
    //
    // Across the internet a device cannot tell a host that is gone from a link to it that is
    // broken, and devices that guess differently each go on with a match of their own. So there
    // the lobby server rules: the host sends it a snapshot of the whole match every second (its
    // sign of life, and what another device goes on from), and a client that has lost the host
    // asks it. If the host is still sending, the client's link to it is what broke, and is made
    // again; if not, the server gives the match to the next in line, in a new term, with its
    // snapshot, and tells the room. A host that was replaced meanwhile hears it in the answer to
    // its next snapshot, stands down, and joins the new host as a client - its player's ship has
    // been kept for it (NET.rejoinGrace). Without the server (this device cannot reach it) the
    // devices settle it among themselves, as on one Wi-Fi.

    /** True for a match among players anywhere. */
    get global() {
        return this.state.scope === LOBBY_SCOPE.GLOBAL;
    }

    /** True when the lobby server can be asked who runs the match: across the internet, while connected to it. */
    get refereed() {
        return this.global && this.state.status === LAN_STATUS.ONLINE;
    }

    /**
     * The host's snapshot for the lobby server (MatchServer.onSnapshotDue), with its line of
     * succession. It goes without the snapshot if that cannot be packed small enough: it is
     * the host's sign of life all the same. The answer says who runs the match.
     */
    async sendSnapshot(server) {
        if (this.uploading || this.server !== server || !this.refereed) return;
        this.uploading = true;
        try {
            let packed = server.canMigrate ? await packSnapshot(JSON.stringify(server.capture())) : null;
            if (packed && packed.length > NET.serverSnapshotMaxChars) packed = null;
            const ruling = await this.lobby.putMatchSnapshot(server.info.matchId, server.term, packed, server.succession);
            if (this.server === server) await this.onMatchHost(ruling);
        } catch {
            // Not this time (the server is out of reach for a moment): the next snapshot goes in a second.
        } finally {
            this.uploading = false;
        }
    }

    /** This device's client has lost its host: the server is asked who runs the match (if it cannot be, the devices settle it). */
    async askReferee() {
        const { client } = this;
        if (!client || this.server) return;
        this.searchForHost();
        const search = this.hostSearch;
        if (search.asking) return;
        search.asking = true;
        let ruling = null;
        try {
            ruling = await this.lobby.reportHostLost(client.info.matchId, client.term);
        } catch {
            ruling = null;
        }
        search.asking = false;
        if (this.client !== client || this.server || !this.inMatch) return;
        if (ruling) await this.onMatchHost(ruling);
        else this.walkSuccession();
    }

    /**
     * Keeps after the match's host until one welcomes this client: the server is asked again
     * every NET.takeoverTimeout seconds (the device it named may not be able to take over, or
     * the link to it may not come up), for NET.rejoinGrace seconds - then the match ends here.
     */
    searchForHost() {
        if (this.hostSearch) return;
        const search = { since: this.now(), timer: null, asking: false, renewedAt: -Infinity };
        this.hostSearch = search;
        const check = () => {
            if (this.hostSearch !== search) return;
            const { client } = this;
            if (!client || this.server || !client.migrating) {
                this.hostSearch = null;
                return;
            }
            if (this.now() - search.since > NET.rejoinGrace * 1000) {
                this.hostSearch = null;
                client.giveUp();
                return;
            }
            if (this.refereed) this.askReferee();
            search.timer = this.timers.setTimeout(check, NET.takeoverTimeout * 1000);
        };
        search.timer = this.timers.setTimeout(check, NET.takeoverTimeout * 1000);
    }

    stopHostSearch() {
        if (this.hostSearch) this.timers.clearTimeout(this.hostSearch.timer);
        this.hostSearch = null;
    }

    /**
     * The lobby server's word on who runs the match: its answer to a snapshot or to a lost
     * host, or news to the whole room. Older news than this device has is ignored. If it names
     * this device, it takes the match over (from the server's snapshot, or its own checkpoint
     * if that is newer); if it names another, a host here stands down, and the client turns
     * to that one.
     */
    async onMatchHost(ruling) {
        const { client } = this;
        if (!this.inMatch || !client || !ruling || ruling.matchId !== client.info.matchId) return;
        const { term, hostPlayerId } = ruling;
        if (!Number.isInteger(term) || typeof hostPlayerId !== 'string') return;
        if (term < (this.server ? this.server.term : client.term)) return;
        if (hostPlayerId === this.state.me?.playerId) {
            if (this.server) return;
            const snapshot = await unpackSnapshot(ruling.snapshot);
            // (Things may have moved on while it was unpacked.)
            if (this.client !== client || this.server || client.term > term) return;
            this.takeOver({ term, snapshot });
            return;
        }
        this.standDown();
        client.term = Math.max(client.term, term);
        this.followHost(hostPlayerId);
    }

    /**
     * Makes `playerId`'s device this client's host. Over the link there is to it - or, if there
     * is none, or it is the one that went quiet, over a new one this device calls for (the
     * client stands still until it opens and the host's welcome comes). A host that is the same
     * and still heard is left alone.
     */
    followHost(playerId) {
        const { client } = this;
        const previous = this.matchHostId;
        if (playerId === previous && !client.migrating) return;
        const link = this.links.get(playerId);
        const quiet = playerId === previous && link === client.link;
        this.matchHostId = playerId;
        this.searchForHost();
        const search = this.hostSearch;
        if (link?.isOpen && !quiet) {
            client.switchLink(link);
        } else if (link?.status === LINK_STATUS.CONNECTING) {
            client.awaitHost();
        } else if (!quiet || this.now() - search.renewedAt >= NET.internetHostLostTimeout * 1000) {
            // (A link made again is given a while to show it works before it is made again.)
            search.renewedAt = this.now();
            client.awaitHost();
            this.openLink(playerId, true);
        }
        if (previous && previous !== playerId) {
            const old = this.links.get(previous);
            if (old) this.watchLink(previous, old);
        }
    }
}

/** A checkpoint's JSON text as `{ checkpoint, time }`, or null if it is not JSON of an object. */
function readCheckpoint(text) {
    if (typeof text !== 'string') return null;
    try {
        const checkpoint = JSON.parse(text);
        if (!checkpoint || typeof checkpoint !== 'object') return null;
        return { checkpoint, time: Number.isFinite(checkpoint.time) ? checkpoint.time : -1 };
    } catch {
        return null;
    }
}

function codeOf(error) {
    return typeof error?.code === 'string' ? error.code : LOBBY_ERROR.UNKNOWN;
}

/** The name as it will be shown (the lobby server cleans it again; this is so the input shows the same). */
export function cleanName(name) {
    return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** A loadout as the controller keeps it. What a piece of equipment is, is the game mode's to check. */
export function cleanLoadout(loadout) {
    const equipment = loadout?.equipment;
    return { equipment: typeof equipment === 'string' && equipment.length <= 32 ? equipment : null };
}
