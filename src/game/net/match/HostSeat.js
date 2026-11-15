import { createMemoryLinkPair } from '../transport/MemoryLink.js';

/**
 * The host's place in a match: the server, and beside it a client for the host's own player,
 * joined by a link that never leaves the device.
 *
 * The host plays through a ClientMatch like everybody else, so there is one way of showing a
 * match, not two, and the host's player has no view of the simulation the others lack.
 *
 * It plugs into GameSession.beginMatch (see there for the interface).
 */
export class HostSeat {
    /**
     * @param {object} params
     * @param {import('../server/MatchServer.js').MatchServer} params.server
     * @param {(link: object) => import('./ClientMatch.js').ClientMatch} params.createClient builds the host player's client on its end of the link
     * @param {string} params.localPlayerId the host's own player id
     */
    constructor({ server, createClient, localPlayerId }) {
        this.server = server;
        const [serverEnd, clientEnd] = createMemoryLinkPair();
        this.serverEnd = serverEnd;
        this.clientEnd = clientEnd;
        this.client = createClient(clientEnd);
        server.attachLink(localPlayerId, serverEnd);
    }

    begin(session) {
        this.server.start();
        this.client.begin(session);
    }

    update(dt, controls) {
        // What the client sent last frame reaches the server, the server runs, and what it
        // sends reaches the client before the client draws: the host is never a frame behind itself.
        this.serverEnd.deliver();
        this.server.update(dt);
        this.clientEnd.deliver();
        this.client.update(dt, controls);
    }

    handleAction(action, params) {
        this.client.handleAction(action, params);
    }

    /** Asks the game mode's rules for something, as any client would. */
    request(name, data) {
        this.client.request(name, data);
    }

    missionHud() {
        return this.client.missionHud();
    }

    dispose() {
        this.client.dispose();
        this.server.dispose();
    }
}
