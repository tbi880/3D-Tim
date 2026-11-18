import { FACTION } from '../../config/gameConfig.js';
import { SHIP_CLASSES } from '../../config/shipClasses.js';

/**
 * The message feed: short lines that every device in a match shows at the side of the screen
 * for a few seconds, then lets go of - who shot whom down, today. The host says them
 * (`MatchServer.announce(type, data)`), every device hears them as a `WORLD_EVENT.FEED` entry
 * `[kind, type, data]`, checks them here (`sanitizeFeedMessage`) and hands them to its feed
 * (state/MessageFeed.js), which the page and the headset draw (ui/MessageFeed.jsx,
 * xr/vrMessageFeed.js; the words of a line are ui/feedText.js).
 *
 * `type` is what kind of line it is, and decides what `data` holds. There is one kind today.
 * To add another - what players say to each other, say - give it a name in FEED_TYPE, a check
 * in `SANITIZERS`, a weight in `readFor` and its words in ui/feedText.js: nothing between the
 * host and the screen needs to know it. A device ignores a type it does not know, so a line
 * of a new kind does no harm to a build that has not heard of it.
 *
 * A kill, as it travels:
 *   { killer: party | null, victim: party, weapon: KILL_WEAPONS | null, cause: KILL_CAUSE | null }
 *   party = { id: player id | null, name: the pilot's name | null, ship: class id, faction }
 * `id` and `name` are null for a computer-flown ship of a garrison or a squad (it is named by
 * its class and its side); `killer` is null when nobody shot the victim down, and `cause` then
 * says what did.
 */
export const FEED_TYPE = Object.freeze({
    KILL: 'kill',
});

/** What ended a pilot nobody shot down. */
export const KILL_CAUSE = Object.freeze({
    /** The black hole: the planet they were at was falling in, or gone. */
    COLLAPSE: 'collapse',
    /** They flew into something. */
    CRASH: 'crash',
});

/** The kinds of weapon a kill is credited to (the `type` of config/weapons.js). */
export const KILL_WEAPONS = Object.freeze(['beam', 'bolt', 'torpedo', 'lance']);

/**
 * How much a line matters to the player reading it. A device short of room shows the
 * weightier lines (state/MessageFeed.js `shownLines`), and keeps one about its own player up longer.
 */
export const FEED_WEIGHT = Object.freeze({
    /** Computer-flown ships among themselves. */
    BACKGROUND: 0,
    /** A pilot is in it. */
    PILOT: 1,
    /** The player themself is. */
    OWN: 2,
});

const MAX_NAME_LENGTH = 40;
const MAX_ID_LENGTH = 64;
/** The sides a line can name: a ship of no side (a station, a wreck) is in no line. */
const FACTIONS = new Set(Object.values(FACTION).filter((faction) => faction !== FACTION.NEUTRAL));
const CAUSES = new Set(Object.values(KILL_CAUSE));

// ---- On the host ---------------------------------------------------------------------------

/** The hull a gun is bolted on to: a kill by a mothership's battery is the mothership's. */
function hullOf(ship) {
    let hull = ship;
    while (hull.parent) hull = hull.parent;
    return hull;
}

const partyOf = (ship) => ({
    id: ship.isPlayer ? ship.pilotId : null,
    name: ship.isPlayer ? ship.callsign ?? null : null,
    ship: ship.classId,
    faction: ship.faction,
});

/**
 * A ship's end as a line of the feed, or null when it is not worth one:
 *  - scenery (a station, the stargate) is nobody's kill;
 *  - what was bolted on to a hull that has just gone goes with it, unsaid;
 *  - a computer-flown ship nobody shot down (the black hole takes them by the dozen).
 * @param {object} ship the ship that was destroyed
 * @param {object | null} killer the ship that did it
 * @param {object} [how]
 * @param {object | null} [how.weapon] the definition of the weapon that did it (config/weapons.js)
 * @param {string | null} [how.cause] with no killer: what did (KILL_CAUSE)
 */
export function describeKill(ship, killer, { weapon = null, cause = null } = {}) {
    if (ship.invulnerable || ship.faction === FACTION.NEUTRAL) return null;
    if (ship.parent && !ship.parent.alive) return null;
    const hull = killer ? hullOf(killer) : null;
    // (A ship that ends itself was shot down by nobody.)
    const by = hull && hull !== ship ? hull : null;
    if (!by && !ship.isPlayer) return null;
    return {
        killer: by ? partyOf(by) : null,
        victim: partyOf(ship),
        weapon: by && KILL_WEAPONS.includes(weapon?.type) ? weapon.type : null,
        cause: by ? null : cause ?? KILL_CAUSE.CRASH,
    };
}

// ---- On every device -----------------------------------------------------------------------

function sanitizeParty(raw) {
    if (raw === null || typeof raw !== 'object') return null;
    if (!FACTIONS.has(raw.faction) || typeof raw.ship !== 'string' || !Object.hasOwn(SHIP_CLASSES, raw.ship)) return null;
    const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= MAX_ID_LENGTH ? raw.id : null;
    // (Only a pilot has a name of their own.)
    const name = id !== null && typeof raw.name === 'string' && raw.name.length > 0 ? raw.name.slice(0, MAX_NAME_LENGTH) : null;
    return { id, name, ship: raw.ship, faction: raw.faction };
}

function sanitizeKill(raw) {
    const victim = sanitizeParty(raw.victim);
    if (!victim) return null;
    const killer = raw.killer == null ? null : sanitizeParty(raw.killer);
    if (raw.killer != null && !killer) return null;
    return {
        killer,
        victim,
        weapon: killer && KILL_WEAPONS.includes(raw.weapon) ? raw.weapon : null,
        cause: killer ? null : CAUSES.has(raw.cause) ? raw.cause : KILL_CAUSE.CRASH,
    };
}

const SANITIZERS = Object.freeze({
    [FEED_TYPE.KILL]: sanitizeKill,
});

/**
 * Checks a line of the feed from the host. Returns it in a clean, known shape
 * (`{ type, ...its data }`), or null: a type this build does not know, or data that is not
 * what its type holds.
 */
export function sanitizeFeedMessage(type, data) {
    if (typeof type !== 'string' || !Object.hasOwn(SANITIZERS, type)) return null;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    const clean = SANITIZERS[type](data);
    return clean ? { type, ...clean } : null;
}

/**
 * A line of the feed as the player `playerId` reads it: what they have to do with it
 * (`you`: 'killer', 'victim' or null) and how much it matters to them (`weight`, FEED_WEIGHT).
 */
export function readFor(message, playerId) {
    if (message.type !== FEED_TYPE.KILL) return { ...message, you: null, weight: FEED_WEIGHT.PILOT };
    const { killer, victim } = message;
    const you = killer?.id != null && killer.id === playerId ? 'killer' : victim.id != null && victim.id === playerId ? 'victim' : null;
    const weight = you ? FEED_WEIGHT.OWN : killer?.id != null || victim.id != null ? FEED_WEIGHT.PILOT : FEED_WEIGHT.BACKGROUND;
    return { ...message, you, weight };
}
