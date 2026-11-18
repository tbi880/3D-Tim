import { FEED_TYPE } from '../net/match/feed.js';

/**
 * What a line of the message feed says (state/MessageFeed.js), as pieces of text in reading
 * order - the same pieces for the page (ui/MessageFeed.jsx) and the headset
 * (xr/vrMessageFeed.js), which only differ in how they paint them.
 *
 * A piece is `{ text, tone, role }`:
 *   tone  'dawn' | 'umbra' | 'pirate' (a side's colour), 'muted', or 'warn'
 *   role  'tag' (a side's short name, before one of its ships), 'name' (a pilot, or a
 *         computer-flown ship's class), 'link' (what joins two names: the weapon, an arrow)
 *         or 'text' (the rest of a sentence)
 *
 * A kind of line has its words here: add its type to `WRITERS`.
 */
export const FEED_ROLE = Object.freeze({ TAG: 'tag', NAME: 'name', LINK: 'link', TEXT: 'text' });
export const FEED_TONE = Object.freeze({ MUTED: 'muted', WARN: 'warn' });

/** What stands between killer and victim where there is no room for the weapon's name. */
const ARROW = '▸';
/** The longest name a line shows whole (a pilot may have called themself anything). */
const MAX_NAME = 14;

const shorten = (name) => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name);

/**
 * One end of a kill: the side's short name and who it was - a pilot by their name, a
 * computer-flown ship by its class. Without `tags` the side is left to the colour alone.
 */
function party(t, { name, ship, faction }, tags) {
    const who = { text: name !== null ? shorten(name) : t(`ship.${ship}`), tone: faction, role: FEED_ROLE.NAME };
    return tags ? [{ text: t(`mp.feed.side.${faction}`), tone: faction, role: FEED_ROLE.TAG }, who] : [who];
}

function killLine(t, { killer, victim, weapon, cause }, { tags, weapons }) {
    // Nobody shot them down: "<victim> was swallowed by the black hole".
    if (!killer) return [...party(t, victim, tags), { text: t(`mp.feed.cause.${cause}`), tone: FEED_TONE.WARN, role: FEED_ROLE.TEXT }];
    const how = weapons ? t(weapon ? `mp.feed.weapon.${weapon}` : 'mp.feed.kill') : ARROW;
    return [...party(t, killer, tags), { text: how, tone: FEED_TONE.MUTED, role: FEED_ROLE.LINK }, ...party(t, victim, tags)];
}

const WRITERS = Object.freeze({
    [FEED_TYPE.KILL]: killLine,
});

/**
 * The pieces of one line. An unknown kind of line has none.
 * @param {(key: string, params?: object) => string} t
 * @param {object} line a line of the feed
 * @param {object} [options] how much room there is for it
 * @param {boolean} [options.compact] a phone's width: no side tags, an arrow for the weapon
 * @param {boolean} [options.tags] the sides' short names before the names (default: unless `compact`)
 * @param {boolean} [options.weapons] the weapon's name between them, not an arrow (default: unless `compact`)
 */
export function feedSegments(t, line, { compact = false, tags = !compact, weapons = !compact } = {}) {
    return WRITERS[line.type]?.(t, line, { tags, weapons }) ?? [];
}

/** A line as one plain string (for a screen reader, and for tests). */
export function feedText(t, line, options) {
    return feedSegments(t, line, options).map((piece) => piece.text).join(' ');
}
