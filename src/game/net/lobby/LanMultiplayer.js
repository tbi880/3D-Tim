import { DEFAULT_GAME_MODE, gameModeOf } from '../../modes/index.js';
import { ClientMatch } from '../match/ClientMatch.js';
import { HostSeat } from '../match/HostSeat.js';
import { normalizeMatchInfo } from '../match/matchInfo.js';
import { MatchServer } from '../server/MatchServer.js';
import { LINK_STATUS } from '../transport/PeerLink.js';
import { LOBBY_ERROR } from './LobbyClient.js';

/** Values of the backend's LanRoomState. */
export const ROOM_STATE = Object.freeze({ LOBBY: 'Lobby', IN_MATCH: 'InMatch' });

export const LAN_STATUS = Object.freeze({ OFFLINE: 'offline', CONNECTING: 'connecting', ONLINE: 'online' });

/** Errors this side raises itself, next to the server's `lan.*` codes (all have text in the i18n files). */
export const LAN_ERROR = Object.freeze({ ROOM_CLOSED: 'lan.roomClosed', NO_LINK: 'lan.noLink', LINK_FAILED: 'lan.linkFailed' });

const MAX_NAME_LENGTH = 20;
/** Seconds before a joining player's device tries again to reach the host after a failed attempt. */
const RELINK_DELAY = 1.5;
const RELINK_ATTEMPTS = 3;

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
});

/**
 * LAN multiplayer, from the lobby to the match and back: the one object the menus talk to.
 *
 * It keeps three things in step:
 *  - the lobby server (LobbyClient): which rooms exist, who is in this one, who is ready;
 *  - the links between the devices (PeerLink): every player's device connects straight to
 *    the host's as soon as it enters the room, so a link that will not work shows up in the
 *    lobby and not when the match starts;
 *  - the game session: when the server announces a match, the host's device starts a
 *    MatchServer and every device a ClientMatch on the same GameSession the campaign uses.
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
     * @param {object} [params.timers] { setTimeout, clearTimeout }
     */
    constructor({ session, store, createLobby, createLink, device, nameStore, timers = globalThis }) {
        this.session = session;
        this.store = store;
        this.createLink = createLink;
        this.device = device;
        this.nameStore = nameStore;
        this.timers = timers;
        /** @type {Map<string, object>} player id -> link */
        this.links = new Map();
        this.relink = { timer: null, attempts: 0 };
        /** The match server, while this device is hosting a match. */
        this.server = null;
        this.lobby = createLobby({
            onRoomUpdated: (room) => this.onRoomUpdated(room),
            onRoomClosed: () => this.onRoomClosed(),
            onRoomListChanged: (rooms) => this.store.set({ rooms: Array.isArray(rooms) ? rooms : [] }),
            onMatchStarted: (start) => this.onMatchStarted(start),
            onSignal: (signal) => this.onSignal(signal),
            onDisconnected: () => this.onDisconnected(),
        });
        store.set({ pilotName: cleanName(nameStore.load()) });
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

    /** Connects to the lobby server (as the signed-in account, or as a guest) and lists the rooms on this network. */
    async open() {
        if (this.state.status !== LAN_STATUS.OFFLINE) return;
        this.store.set({ status: LAN_STATUS.CONNECTING, error: null });
        try {
            const me = await this.lobby.connect();
            const rooms = await this.lobby.listRooms();
            this.store.set({ status: LAN_STATUS.ONLINE, me, rooms });
        } catch (error) {
            this.store.set({ status: LAN_STATUS.OFFLINE, error: codeOf(error) });
        }
    }

    /** Leaves the room and the lobby server. */
    async close() {
        this.dropLinks();
        await this.lobby.disconnect();
        this.store.set({ ...initialLanState(), pilotName: this.state.pilotName });
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
        };
    }

    // ---- Rooms -------------------------------------------------------------------------------

    async createRoom(options = { mode: DEFAULT_GAME_MODE }) {
        const room = await this.attempt(() => this.lobby.createRoom(this.profile(), options));
        if (room) this.onRoomUpdated(room);
    }

    async joinRoom(code) {
        const room = await this.attempt(() => this.lobby.joinRoom(code, this.profile()));
        if (room) this.onRoomUpdated(room);
    }

    async leaveRoom() {
        this.dropLinks();
        this.store.set({ room: null, links: {} });
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

    /** Changes the name the player goes by, here and in the room if they are in one. */
    setPilotName(name) {
        const pilotName = cleanName(name);
        this.nameStore.save(pilotName);
        this.store.set({ pilotName });
        return this.pushProfile();
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

    /** Host: true when the match can start: everybody is ready and every device is linked. */
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
        this.store.set({ room });
        this.syncLinks(room);
        // The host has ended the match: back to the lobby with everybody else.
        if (room.state === ROOM_STATE.LOBBY && this.inMatch) this.endMatch();
    }

    onRoomClosed() {
        this.dropLinks();
        this.store.set({ room: null, links: {}, error: LAN_ERROR.ROOM_CLOSED });
        if (this.inMatch) this.endMatch();
        this.refreshRooms();
    }

    /**
     * The lobby server is gone. A match in progress does not need it - the devices talk to
     * each other - so it plays on; the lobby is over.
     */
    onDisconnected() {
        if (!this.inMatch) this.dropLinks();
        this.store.set({ status: LAN_STATUS.OFFLINE, me: this.inMatch ? this.state.me : null, room: this.inMatch ? this.state.room : null, rooms: [], error: LOBBY_ERROR.OFFLINE });
    }

    onMatchStarted(start) {
        const info = normalizeMatchInfo(start);
        const mode = gameModeOf(info);
        const localPlayerId = this.state.me.playerId;
        const createClient = (link) => new ClientMatch({ info, localPlayerId, link, presenter: mode.createPresenter() });

        if (info.hostPlayerId === localPlayerId) {
            this.server = new MatchServer({ info, mode: mode.createRules(info) });
            for (const [playerId, link] of this.links) {
                if (link.isOpen) this.server.attachLink(playerId, link);
            }
            this.session.beginMatch(new HostSeat({ server: this.server, createClient, localPlayerId }));
            return;
        }
        const link = this.links.get(info.hostPlayerId);
        if (!link?.isOpen) {
            this.store.set({ error: LAN_ERROR.NO_LINK });
            return;
        }
        this.session.beginMatch(createClient(link));
    }

    endMatch() {
        this.server = null;
        this.session.enterTitle();
    }

    // ---- Links between the devices -----------------------------------------------------------

    /** Keeps the links in step with who is in the room: a joiner reaches for the host, the host lets go of whoever left. */
    syncLinks(room) {
        const { me } = this.state;
        if (!me) return;
        if (room.hostPlayerId === me.playerId) {
            const present = new Set(room.players.map((player) => player.playerId));
            for (const playerId of [...this.links.keys()]) {
                if (!present.has(playerId)) this.dropLink(playerId);
            }
        } else if (!this.links.has(room.hostPlayerId)) {
            this.openLink(room.hostPlayerId, true);
        }
    }

    openLink(playerId, initiator) {
        this.dropLink(playerId);
        const link = this.createLink({
            initiator,
            sendSignal: (type, payload) => { this.lobby.sendSignal(playerId, type, payload).catch(() => {}); },
            onStatus: (status) => this.onLinkStatus(playerId, link, status),
        });
        this.links.set(playerId, link);
        this.publishLinks();
        return link;
    }

    onLinkStatus(playerId, link, status) {
        if (this.links.get(playerId) !== link) return;
        if (status === LINK_STATUS.OPEN) {
            this.relink.attempts = 0;
            // A device that linked up late (or again) joins the match that is running.
            if (this.server && this.inMatch) this.server.attachLink(playerId, link);
        } else if (status === LINK_STATUS.CLOSED) {
            this.links.delete(playerId);
            if (!this.isHost && this.state.room && !this.inMatch) this.scheduleRelink(playerId);
        }
        this.publishLinks();
    }

    /** A joiner whose link to the host failed tries a few more times before giving up with an error. */
    scheduleRelink(hostId) {
        if (this.relink.attempts >= RELINK_ATTEMPTS) {
            this.store.set({ error: LAN_ERROR.LINK_FAILED });
            return;
        }
        this.relink.attempts += 1;
        this.timers.clearTimeout(this.relink.timer);
        this.relink.timer = this.timers.setTimeout(() => {
            if (this.state.room?.hostPlayerId === hostId && !this.links.has(hostId)) this.openLink(hostId, true);
        }, RELINK_DELAY * 1000);
    }

    /** Tries the link to the host again from scratch (the lobby's "retry" button). */
    retryLink() {
        const { room } = this.state;
        if (!room || this.isHost) return;
        this.relink.attempts = 0;
        this.store.set({ error: null });
        this.openLink(room.hostPlayerId, true);
    }

    onSignal(signal) {
        const { room } = this.state;
        const from = signal?.fromPlayerId;
        if (!room || typeof from !== 'string' || typeof signal.type !== 'string' || typeof signal.payload !== 'string') return;
        if (this.isHost) {
            // An offer starts a link (again, if that player's device is retrying).
            if (signal.type === 'offer') this.openLink(from, false);
            this.links.get(from)?.handleSignal(signal.type, signal.payload);
        } else if (from === room.hostPlayerId) {
            this.links.get(from)?.handleSignal(signal.type, signal.payload);
        }
    }

    dropLink(playerId) {
        const link = this.links.get(playerId);
        if (!link) return;
        this.links.delete(playerId);
        link.close();
        this.publishLinks();
    }

    dropLinks() {
        this.timers.clearTimeout(this.relink.timer);
        this.relink.attempts = 0;
        for (const playerId of [...this.links.keys()]) this.dropLink(playerId);
    }

    publishLinks() {
        this.store.set({ links: Object.fromEntries([...this.links].map(([playerId, link]) => [playerId, link.status])) });
    }
}

function codeOf(error) {
    return typeof error?.code === 'string' ? error.code : LOBBY_ERROR.UNKNOWN;
}

/** The name as it will be shown (the lobby server cleans it again; this is so the input shows the same). */
export function cleanName(name) {
    return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}
