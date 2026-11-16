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
 * finding rooms on this network, sitting in one, and passing WebRTC signalling to the other
 * players. It only carries messages; what to do with them is LanMultiplayer's business.
 *
 * Every method returns a promise that rejects with a LobbyError.
 */
export class LobbyClient {
    /**
     * @param {object} params
     * @param {string} params.url the hub's address
     * @param {() => string | null} params.getToken the signed-in player's token, or null to play as a guest
     * @param {{ HubConnectionBuilder: Function, LogLevel: object }} params.signalR the @microsoft/signalr module (passed in so tests can replace it)
     * @param {object} params.handlers { onRoomUpdated(room), onRoomClosed(code), onRoomListChanged(rooms), onMatchStarted(start), onSignal(signal), onDisconnected() }
     */
    constructor({ url, getToken, signalR, handlers }) {
        this.url = url;
        this.getToken = getToken;
        this.signalR = signalR;
        this.handlers = handlers;
        this.connection = null;
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
        return this.invoke('GetSession');
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
    createRoom(profile, options = null) { return this.invoke('CreateRoom', profile, options); }
    joinRoom(code, profile) { return this.invoke('JoinRoom', code, profile); }
    updateProfile(profile) { return this.invoke('UpdateProfile', profile); }
    setReady(ready) { return this.invoke('SetReady', ready); }
    updateOptions(options) { return this.invoke('UpdateOptions', options); }
    startMatch() { return this.invoke('StartMatch'); }
    endMatch() { return this.invoke('EndMatch'); }
    leaveRoom() { return this.invoke('LeaveRoom'); }
    sendSignal(toPlayerId, type, payload) { return this.invoke('SendSignal', toPlayerId, type, payload); }
}
