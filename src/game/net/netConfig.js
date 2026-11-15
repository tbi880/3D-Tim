/**
 * Tuning values for multiplayer. Nothing here knows about the browser, so the host and
 * client logic (and their tests) can read it in Node.
 */
export const NET = Object.freeze({
    /** Bumped whenever packets change shape; a host refuses a client that speaks another version. */
    protocolVersion: 1,

    /** World snapshots the host sends each client per second. */
    snapshotHz: 30,
    /**
     * How far behind the newest snapshot other ships are drawn (seconds), so there are always
     * two snapshots to blend between. A little over one snapshot interval: on a LAN packets
     * arrive evenly, and every millisecond here is a millisecond the picture is late.
     */
    interpolationDelay: 0.045,
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
});

/**
 * STUN servers for WebRTC. On one Wi-Fi the devices reach each other with their local
 * addresses and never need them; they only help on odd networks, at no cost otherwise.
 */
export const ICE_SERVERS = Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]);

/** Names of the two data channels on every link. */
export const CHANNELS = Object.freeze({
    /** Unordered, never retransmitted: snapshots one way, inputs the other. A late packet is worthless. */
    STATE: 'state',
    /** Ordered and reliable: things that must arrive (spawns, kills, the lobby of the match). */
    EVENTS: 'events',
});
