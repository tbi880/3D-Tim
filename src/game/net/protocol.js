import { PILOT_ACTIONS } from '../core/systems/pilotActions.js';
import { PacketError } from './codec/binary.js';
import { NET } from './netConfig.js';

/**
 * Messages on the reliable channel, as JSON objects `{ t: type, ... }`.
 *
 * Client to host - the only four things a client may say; anything else is refused:
 *   hello   { v, m }        protocol version and match id: "send me the world"
 *   action  { a, f? }       a one-shot pilot action (core/systems/pilotActions.js);
 *                           f = [x, y, z] line of sight for 'targetCrosshair' (VR gaze)
 *   req     { k, d? }       a request to the game mode (jump to a planet, spend refit points...):
 *                           k names it, d is its data. The mode checks both (modes/index.js).
 *   ping    { n }           echoed back as pong, for the latency read-out
 *   links   { c, r }        how fit this device is to host: c = milliseconds per benchmark step,
 *                           r = { playerId: round trip in ms } to the devices it is linked to
 *   lp / lq { n }           a ping or its answer between two devices' controllers (LanMultiplayer);
 *                           the match has no use for them and lets them pass
 *   to      { n, h }        "the match is player h's device's now, in term n": said by a device that
 *                           has taken the match over, to every device it is linked to - a host
 *                           that hears of a later term than its own stands down, and a client
 *                           waiting for that device's welcome asks it for the world again
 *
 * Host to client:
 *   welcome { ... }         the whole place the player is in, as it is now (match/replication.js);
 *                           sent again whenever the player moves to another place
 *   batch   { e: [...] }    what happened in one host frame, in order (WORLD_EVENT entries)
 *   pong    { n }
 *   refused { reason }      the host will not let this client into the match
 *   succ    { o, n }        the order of succession - player ids, the next host first - and the
 *                           host's term (0 for the first host, one more for every takeover)
 *   cp      { id, i, n, d } piece i of n of checkpoint `id`: the whole match as JSON text, sent
 *                           to those next in line (server/checkpoint.js)
 */
export const MSG = Object.freeze({
    HELLO: 'hello',
    ACTION: 'action',
    REQUEST: 'req',
    PING: 'ping',
    WELCOME: 'welcome',
    BATCH: 'batch',
    PONG: 'pong',
    REFUSED: 'refused',
    LINKS: 'links',
    LINK_PING: 'lp',
    LINK_PONG: 'lq',
    TAKEOVER: 'to',
    SUCCESSION: 'succ',
    CHECKPOINT: 'cp',
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Most links a device may report on, and the largest numbers a report may hold. */
const MAX_REPORTED_LINKS = 16;
const MAX_STEP_COST = 1000;
const MAX_RTT = 10000;

/**
 * A device's report on its fitness to host, in a known shape: `{ stepCost, rtt: { playerId: ms } }`.
 * @throws {PacketError} if it is not one
 */
function parseLinks(message) {
    if (!isFiniteNumber(message.c) || message.c < 0) throw new PacketError('links without a step cost');
    const reported = message.r;
    if (reported === null || typeof reported !== 'object' || Array.isArray(reported)) throw new PacketError('links without round trips');
    const entries = Object.entries(reported);
    if (entries.length > MAX_REPORTED_LINKS) throw new PacketError('too many links');
    const rtt = {};
    for (const [playerId, ms] of entries) {
        if (playerId.length > 64 || !isFiniteNumber(ms) || ms < 0) throw new PacketError('a link is not a round trip');
        rtt[playerId] = Math.min(ms, MAX_RTT);
    }
    return { t: MSG.LINKS, stepCost: Math.min(message.c, MAX_STEP_COST), rtt };
}

/** Entries of a batch: `[kind, ...fields]`. Field lists are in match/replication.js. */
export const WORLD_EVENT = Object.freeze({
    SPAWN: 'spawn',
    REMOVE: 'remove',
    DESTROY: 'destroy',
    HIT: 'hit',
    FIRE: 'fire',
    PROJECTILE_GONE: 'gone',
    ROCK: 'rock',
    LANCE: 'lance',
    /** The local player's ship ran into something: `[kind, speed]`, sent only to that player. */
    BUMP: 'bump',
    /** A ship changed sides: `[kind, shipId, faction]`. */
    FACTION: 'faction',
    /** A player ship was refitted: `[kind, shipId, upgrades]`. */
    REFIT: 'refit',
    /** A call on the client's stage (hint, music, cue...): `[kind, method, arg]`. */
    STAGE: 'stage',
    /** The match state for the receiving player: `[kind, matchState]`. */
    MATCH: 'match',
    /** Points for the receiving player: `[kind, points, classId, total]`. */
    SCORE: 'score',
    /** Something only the game mode understands: `[kind, name, data]` (see the mode's client). */
    MODE: 'mode',
    /**
     * A ship's ability, active or passive (GAME_EVENTS.ABILITY): `[kind, shipId, abilityId, phase]`,
     * and for a blast (a warhead's, a dying Bulwark's) `x, y, z, radius` after them.
     */
    ABILITY: 'ability',
});

const REQUEST_NAME = /^[a-z][A-Za-z]{0,23}$/;

/**
 * Checks a reliable message from a client. Returns it in a clean, known shape - only the
 * fields the host uses, each of the type it expects - so nothing a client invents can reach
 * the simulation. (A request's data is the one thing passed on as received: the game mode
 * it is for checks it, field by field.)
 * @param {unknown} raw the text received
 * @throws {PacketError} if it is not one of the client messages, well formed
 */
export function parseClientMessage(raw) {
    if (typeof raw !== 'string') throw new PacketError('message is not text');
    if (raw.length > NET.maxEventLength) throw new PacketError('message is too long');
    let message;
    try {
        message = JSON.parse(raw);
    } catch {
        throw new PacketError('message is not JSON');
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) throw new PacketError('message is not an object');

    switch (message.t) {
        case MSG.HELLO:
            if (!Number.isInteger(message.v)) throw new PacketError('hello without a version');
            if (typeof message.m !== 'string' || message.m.length === 0 || message.m.length > 64) throw new PacketError('hello without a match id');
            return { t: MSG.HELLO, v: message.v, m: message.m };

        case MSG.ACTION: {
            if (!PILOT_ACTIONS.includes(message.a)) throw new PacketError('unknown action');
            if (message.f === undefined) return { t: MSG.ACTION, a: message.a, f: null };
            if (message.a !== 'targetCrosshair') throw new PacketError('this action takes no direction');
            const f = message.f;
            if (!Array.isArray(f) || f.length !== 3 || !f.every(isFiniteNumber)) throw new PacketError('direction is not a vector');
            const length = Math.hypot(f[0], f[1], f[2]);
            if (length < 0.5 || length > 2) throw new PacketError('direction is not a unit vector');
            return { t: MSG.ACTION, a: message.a, f: [f[0] / length, f[1] / length, f[2] / length] };
        }

        case MSG.REQUEST: {
            if (typeof message.k !== 'string' || !REQUEST_NAME.test(message.k)) throw new PacketError('request without a name');
            const data = message.d ?? null;
            if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new PacketError('request data is not an object');
            return { t: MSG.REQUEST, k: message.k, d: data };
        }

        case MSG.PING:
            if (!isFiniteNumber(message.n)) throw new PacketError('ping without a number');
            return { t: MSG.PING, n: message.n };

        case MSG.LINKS:
            return parseLinks(message);

        // Pings between two devices' controllers, on a link the match has just been given: harmless.
        case MSG.LINK_PING:
        case MSG.LINK_PONG:
            return { t: message.t };

        case MSG.TAKEOVER:
            if (!Number.isInteger(message.n) || message.n < 1) throw new PacketError('takeover without a term');
            if (typeof message.h !== 'string' || message.h.length === 0 || message.h.length > 64) throw new PacketError('takeover without a host');
            return { t: MSG.TAKEOVER, n: message.n, h: message.h };

        default:
            throw new PacketError('unknown message type');
    }
}
