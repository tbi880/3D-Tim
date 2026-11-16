import * as signalR from '@microsoft/signalr';
import { create } from 'zustand';
import { signalRConnectionURL, stageOfENV } from '../../../Settings';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { STORAGE_KEYS } from '../../config/gameConfig.js';
import { isTouchDevice } from '../../input/device.js';
import { PeerLink } from '../transport/PeerLink.js';
import { describeDevice } from './deviceInfo.js';
import { LanMultiplayer, initialLanState } from './LanMultiplayer.js';
import { LobbyClient } from './LobbyClient.js';

/**
 * Where LAN multiplayer meets the browser: the store the lobby screens read, and the one
 * place that knows the lobby server's address, SignalR, WebRTC and the site's sign-in.
 * Everything else in net/ is given these and runs just as well in Node.
 */

/** State of LAN multiplayer for the menus (see initialLanState in LanMultiplayer.js). */
export const useLanStore = create(() => initialLanState());

/**
 * The lobby hub's address. In production it lives beside the site's other hubs. In
 * development the page is often opened from another device on the Wi-Fi (a phone, a
 * headset), for which "localhost" is itself - so the game asks its own origin, and the dev
 * server passes the request on to the backend (see `server.proxy` in vite.config.js).
 */
const LOBBY_PATH = '/connect/echoes-lan';
const lobbyUrl = stageOfENV === 'prod' ? `${signalRConnectionURL}/echoes-lan` : LOBBY_PATH;

/** The site account's token if the player is signed in and it has not expired; otherwise they play as a guest. */
function accountToken() {
    const { token, tokenExp } = useAuthStore.getState();
    return token && (!tokenExp || tokenExp > Date.now() / 1000) ? token : null;
}

const nameStore = {
    load() {
        try {
            return localStorage.getItem(STORAGE_KEYS.pilotName) ?? '';
        } catch {
            return '';
        }
    },
    save(name) {
        try {
            localStorage.setItem(STORAGE_KEYS.pilotName, name);
        } catch {
            // Private mode: the name lasts as long as the page.
        }
    },
};

/** Builds LAN multiplayer for one visit to the game. */
export function createLanMultiplayer(session) {
    useLanStore.setState(initialLanState());
    return new LanMultiplayer({
        session,
        store: { set: (partial) => useLanStore.setState(partial), get: () => useLanStore.getState() },
        createLobby: (handlers) => new LobbyClient({ url: lobbyUrl, getToken: accountToken, signalR, handlers }),
        createLink: (options) => new PeerLink(options),
        device: describeDevice(navigator.userAgent, isTouchDevice()),
        nameStore,
    });
}
