/**
 * The part of a match its players see besides the ships: scores, the map, whose turn it is
 * to do what. The server builds one for each player (the mode decides what is in it, see
 * modes/index.js), sends it a few times a second, and each device puts it in the game
 * store as `match` for the HUD and the result screen.
 *
 * Every mode's state has at least:
 *   mode      the mode's id
 *   phase     MATCH_PHASE
 *   players   [{ id, name, ... }]
 * and each device adds:
 *   localId   which of `players` is this device
 *   rtt       round trip to the host in milliseconds, or null
 */

export const MATCH_PHASE = Object.freeze({
    PLAYING: 'playing',
    /** The match has a result; the state says what it is. */
    OVER: 'over',
    /** Client only: the link to the host was lost. */
    DISCONNECTED: 'disconnected',
});

export const isMatchOver = (phase) => phase !== MATCH_PHASE.PLAYING;

/** The least a match state must be, for a device that has no mode to check it in detail. */
export function sanitizeBasicState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) return null;
    if (!Object.values(MATCH_PHASE).includes(raw.phase)) return null;
    return { mode: String(raw.mode ?? ''), phase: raw.phase, players: [] };
}
