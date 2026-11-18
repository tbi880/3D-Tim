/**
 * Tuning values for multiplayer. Nothing here knows about the browser, so the host and
 * client logic (and their tests) can read it in Node.
 */
export const NET = Object.freeze({
    /**
     * Bumped whenever packets change shape; a host refuses a client that speaks another version,
     * and the lobby server only puts players whose games speak the same one in a room together.
     * 5: the battle royale's vote after a capture gave way to coming back at a station.
     */
    protocolVersion: 5,

    /** World snapshots the host sends each client per second. */
    snapshotHz: 30,
    /**
     * How far behind the newest snapshot other ships are drawn (seconds), so there are always
     * two snapshots to blend between. A little over one snapshot interval: on a LAN packets
     * arrive evenly, and every millisecond here is a millisecond the picture is late.
     */
    interpolationDelay: 0.045,
    /**
     * The same across the internet, where packets arrive less evenly and some come through a
     * relay: a longer wait keeps other ships gliding instead of stopping and jumping.
     */
    internetInterpolationDelay: 0.1,
    /** Snapshots a client keeps for blending. */
    snapshotBufferSize: 12,
    /** A client's clock is pulled this fraction of the way to the host's with every snapshot. */
    clockCorrection: 0.1,
    /** Past this error (seconds) the clock is set outright instead of eased. */
    clockSnapSeconds: 0.25,

    /** Own-ship prediction: errors under these are left alone (they are float noise)... */
    predictionDeadbandMetres: 0.02,
    predictionDeadbandRadians: 0.0005,
    /** ...errors over these are fixed at once (a collision, a respawn)... */
    predictionSnapMetres: 60,
    predictionSnapRadians: 0.6,
    /** ...and anything in between is eased out at this rate (1/s). */
    predictionCorrectionRate: 12,
    /** Inputs a client remembers for replaying on top of a snapshot (about 2 s). */
    maxPendingInputs: 240,

    /** Host: input packets accepted from one client per second; the rest are dropped. */
    maxInputsPerSecond: 240,
    /** Host: reliable messages (actions, pings) accepted from one client per second. */
    maxEventsPerSecond: 40,
    /** Host: longest reliable message a client may send (characters of JSON). */
    maxEventLength: 512,
    /** Host: malformed or out-of-budget packets tolerated before the client is dropped. */
    maxStrikes: 50,
    /** Host: a client that has sent nothing for this long is flown with its controls released (seconds). */
    inputTimeout: 0.5,

    /** Either side: silence on the link for this long means the other end is gone (seconds). */
    linkTimeout: 6,
    /** Seconds a new link may take to open before it is given up. */
    connectTimeout: 15,
    /** Seconds between pings on the reliable channel (latency read-out, and keeps the link warm). */
    pingInterval: 2,

    // ---- Who runs the match, and what happens when that device is lost (net/README.md "The host") ----
    /**
     * Seconds of silence from the host after which a device that has somebody to turn to
     * stops waiting and follows the order of succession. Shorter than `linkTimeout`: a match
     * that can go on should not stand still for long.
     */
    hostLostTimeout: 4,
    /**
     * The same across the internet. There a host's few seconds of silence are much more often
     * its page catching its breath than its end - a new scene to draw, a phone busy for a
     * moment - and the price of guessing wrong is high: the match is taken over from a
     * checkpoint a few seconds back, or ends for a player who had no checkpoint to go on from.
     */
    internetHostLostTimeout: 8,
    /**
     * Seconds a client waits for the first word from its host. More than the rest of the match
     * allows: the host has the match to set up and its first frames of it to draw, and a hello
     * that reached it before it knew of the match is only answered when it is asked again.
     */
    firstContactTimeout: 15,
    /** Seconds between the checkpoints of the whole match that the host sends to those next in line. */
    checkpointInterval: 3,
    /** How many of those next in line are kept supplied with checkpoints. */
    checkpointCopies: 2,
    /** A checkpoint is sent in pieces of at most this many characters (data channels dislike long messages). */
    checkpointChunk: 12000,
    /** Most pieces a checkpoint may come in; a longer one is not accepted. */
    checkpointMaxChunks: 64,
    /** Seconds a device waits for the next in line to take the match over before trying the one after. */
    takeoverTimeout: 6,
    /**
     * Ranking hosts (the lobby server's LanRoomManager.RankHosts does the same before a match):
     * a millisecond of simulation step counts like this many milliseconds of round trip...
     */
    stepCostWeight: 40,
    /** ...and a device with no measured link to another counts as this round trip to it. */
    unlinkedRtt: 2000,

    // ---- Across the internet the lobby server is the referee (net/README.md "The server as referee") ----
    /**
     * Seconds between the snapshots of the whole match the host sends the lobby server. They
     * are its sign of life (the server gives the host up after 4 seconds without one) and what
     * another device goes on from. About 3 kB each, compressed.
     */
    serverSnapshotInterval: 1,
    /** Longest snapshot sent (base64 characters): the server's LanRoomManager.SnapshotMaxChars, inside SignalR's 32 KB. */
    serverSnapshotMaxChars: 24000,
    /** Longest a snapshot from the server may be once unpacked (characters); a match's is about 40 000. */
    serverSnapshotMaxUnpacked: 2_000_000,
    /**
     * Seconds a player whose link to the host broke keeps their ship and their place in the
     * match, to come back to (on the host's device; the ship flies on with nobody at the
     * helm). And how long a device that lost its host looks for it, or for its successor.
     */
    rejoinGrace: 45,
    /**
     * Seconds between a device's attempts to get back to the lobby server after its connection
     * dropped during a match (it takes its place back with its resume token; the server keeps
     * it for 60 seconds, about as long as these last). Tried at once, too, when the browser
     * says the network is back.
     */
    lobbyRetryDelays: Object.freeze([1, 2, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
});

/**
 * STUN servers for WebRTC, used when the lobby server names none. On one Wi-Fi the devices
 * reach each other with their local addresses and never need them. Across the internet they
 * are how a device learns its public address - and for networks where that is not enough
 * the lobby server hands out a TURN relay with them (the backend's IceServerProvider).
 */
export const ICE_SERVERS = Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]);

const ICE_URL = /^(stun|turn|turns):[A-Za-z0-9.\-_~:?=\[\]%]{1,200}$/;
const MAX_ICE_SERVERS = 8;
const MAX_ICE_URLS = 8;

/**
 * The ICE servers the lobby server sent, checked before they are given to the browser:
 * only stun: / turn: addresses, with credentials that are plain strings. Returns the
 * default STUN servers if nothing usable is left.
 * @param {unknown} servers `[{ urls: string[], username?, credential? }]`
 */
export function cleanIceServers(servers) {
    const cleaned = [];
    for (const server of Array.isArray(servers) ? servers.slice(0, MAX_ICE_SERVERS) : []) {
        const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls])
            .filter((url) => typeof url === 'string' && ICE_URL.test(url)).slice(0, MAX_ICE_URLS);
        if (urls.length === 0) continue;
        const relay = typeof server.username === 'string' && typeof server.credential === 'string';
        // A relay without credentials cannot be used; a STUN server needs none.
        if (!relay && urls.some((url) => !url.startsWith('stun:'))) continue;
        cleaned.push(relay ? { urls, username: server.username.slice(0, 256), credential: server.credential.slice(0, 256) } : { urls });
    }
    return cleaned.length > 0 ? cleaned : [...ICE_SERVERS];
}

/** Names of the two data channels on every link. */
export const CHANNELS = Object.freeze({
    /** Unordered, never retransmitted: snapshots one way, inputs the other. A late packet is worthless. */
    STATE: 'state',
    /** Ordered and reliable: things that must arrive (spawns, kills, the lobby of the match). */
    EVENTS: 'events',
});
