/**
 * Events the lobby server pushes (EchoesLanEvents in the backend's EchoesLanHub.cs), by the
 * handler each one calls.
 */
const SERVER_EVENTS = Object.freeze({
    RoomUpdated: 'onRoomUpdated',
    RoomClosed: 'onRoomClosed',
    RoomListChanged: 'onRoomListChanged',
    MatchStarted: 'onMatchStarted',
    Signal: 'onSignal',
    Kicked: 'onKicked',
    MatchHostChanged: 'onMatchHostChanged',
});

/** The server's refusals reach us inside SignalR's error text; this finds the code ("lan.roomFull"). */
const ERROR_CODE = /\blan\.[A-Za-z]+\b/;
export const LOBBY_ERROR = Object.freeze({ OFFLINE: 'lan.offline', UNKNOWN: 'lan.unknown' });

/** An error from the lobby with a code the UI can translate (`lan.*` in the i18n files). */
export class LobbyError extends Error {
    constructor(code, cause = null) {
        super(code);
        this.name = 'LobbyError';
        this.code = code;
        this.cause = cause;
    }
}

/**
 * The game's connection to the lobby server (the backend's EchoesLanHub, over SignalR):
 * finding rooms - on this network, or anywhere by quick match or by code - sitting in one,
 * and passing WebRTC signalling to the other players. It only carries messages; what to do with them is LanMultiplayer's business.
 *
 * Every method returns a promise that rejects with a LobbyError.
 */
export class LobbyClient {
    /**
     * @param {object} params
     * @param {string} params.url the hub's address
     * @param {() => string | null} params.getToken the signed-in player's token, or null to play as a guest
     * @param {{ HubConnectionBuilder: Function, LogLevel: object }} params.signalR the @microsoft/signalr module (passed in so tests can replace it)
     * @param {object} params.handlers { onRoomUpdated(room), onRoomClosed(code), onRoomListChanged(rooms), onMatchStarted(start),
     *        onSignal(signal), onKicked(code), onMatchHostChanged(ruling), onDisconnected() }
     */
    constructor({ url, getToken, signalR, handlers }) {
        this.url = url;
        this.getToken = getToken;
        this.signalR = signalR;
        this.handlers = handlers;
        this.connection = null;
        /** The secret the server gave this connection for taking its place back after a drop (see `resume`). Never shown. */
        this.resumeToken = null;
    }

    get connected() {
        return this.connection !== null;
    }

    /** Opens the connection and returns who the server takes this device to be: { playerId, isGuest, accountName }. */
    async connect() {
        await this.disconnect();
        const { HubConnectionBuilder, LogLevel } = this.signalR;
        const token = this.getToken();
        const connection = new HubConnectionBuilder()
            .withUrl(this.url, token ? { accessTokenFactory: () => token } : {})
            .configureLogging(LogLevel.Warning)
            .build();
        for (const [event, handler] of Object.entries(SERVER_EVENTS)) {
            connection.on(event, (payload) => this.handlers[handler]?.(payload));
        }
        // No automatic reconnect: a new connection is a new player to the server, so the lobby starts over.
        connection.onclose(() => {
            if (this.connection !== connection) return;
            this.connection = null;
            this.handlers.onDisconnected?.();
        });
        try {
            await connection.start();
        } catch (error) {
            throw new LobbyError(LOBBY_ERROR.OFFLINE, error);
        }
        this.connection = connection;
        return this.keepToken(await this.invoke('GetSession'));
    }

    /** The session as the rest of the game sees it: the resume token stays here. */
    keepToken(session) {
        if (!session || typeof session !== 'object') return session;
        const { resumeToken, ...me } = session;
        this.resumeToken = typeof resumeToken === 'string' ? resumeToken : null;
        return me;
    }

    /**
     * Connects again after the connection dropped, and takes back the place this device had
     * (its player id, its seat, its match) with the token the last connection was given.
     * Returns { me, room, match } - `room` and `match` null if the place is gone (the server
     * keeps it for a minute, and only during a match): then this is a new player to the server.
     */
    async resume() {
        const token = this.resumeToken;
        const fresh = await this.connect();
        if (!token) return { me: fresh, room: null, match: null };
        try {
            const back = await this.invoke('ResumeSession', token);
            return { me: this.keepToken(back.session), room: back.room ?? null, match: back.match ?? null };
        } catch {
            return { me: fresh, room: null, match: null };
        }
    }

    async disconnect() {
        const { connection } = this;
        if (!connection) return;
        this.connection = null;
        await connection.stop().catch(() => {});
    }

    async invoke(method, ...args) {
        if (!this.connection) throw new LobbyError(LOBBY_ERROR.OFFLINE);
        try {
            return await this.connection.invoke(method, ...args);
        } catch (error) {
            throw new LobbyError(ERROR_CODE.exec(String(error?.message))?.[0] ?? LOBBY_ERROR.UNKNOWN, error);
        }
    }

    listRooms() { return this.invoke('ListRooms'); }
    /** `options`: { mode, settings, maxPlayers, visibility } (ROOM_VISIBILITY; the default lists the room to this network). */
    createRoom(profile, options = null) { return this.invoke('CreateRoom', profile, options); }
    joinRoom(code, profile) { return this.invoke('JoinRoom', code, profile); }
    /** Into the best public room that is gathering players, or a new one. `criteria`: { mode, avoid: [room codes] }. */
    quickMatch(profile, criteria = null) { return this.invoke('QuickMatch', profile, criteria); }
    /** STUN / TURN servers for this device's links: `[{ urls, username, credential }]`. */
    getIceServers() { return this.invoke('GetIceServers'); }
    updateProfile(profile) { return this.invoke('UpdateProfile', profile); }
    setReady(ready) { return this.invoke('SetReady', ready); }
    /** How fit this device is to run the match: `{ stepCostMs, rttMs: { playerId: ms } }`. The server chooses the host from these. */
    reportFitness(fitness) { return this.invoke('ReportFitness', fitness); }
    /** Host: puts a player out of the room. */
    kickPlayer(playerId) { return this.invoke('KickPlayer', playerId); }
    updateOptions(options) { return this.invoke('UpdateOptions', options); }
    startMatch() { return this.invoke('StartMatch'); }
    endMatch() { return this.invoke('EndMatch'); }
    leaveRoom() { return this.invoke('LeaveRoom'); }
    sendSignal(toPlayerId, type, payload) { return this.invoke('SendSignal', toPlayerId, type, payload); }
    /**
     * The match's host, about once a second: a snapshot of the match (packed: lobby/matchSnapshot.js, or null) and its
     * line of succession. Answers who runs the match: `{ matchId, term, hostPlayerId }`.
     */
    putMatchSnapshot(matchId, term, snapshot, succession) { return this.invoke('PutMatchSnapshot', matchId, term, snapshot, succession); }
    /** This device has lost the match's host. Answers who runs the match now: `{ matchId, term, hostPlayerId, snapshot }`. */
    reportHostLost(matchId, term) { return this.invoke('ReportHostLost', matchId, term); }
}
