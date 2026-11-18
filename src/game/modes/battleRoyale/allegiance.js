import { FACTION } from '../../config/gameConfig.js';

/** A copy of a list in an order the seed alone decides. */
function shuffled(list, rng) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Deals players into sides, in proportion to each side's seats: every player goes to the side
 * whose seats are least filled so far (ties in a shuffled order). So every side gets a player
 * before any gets two, a full match is exactly `seats`, and a smaller one is shaped like it -
 * and who lands where depends only on the match's seed.
 * @param {string[]} playerIds
 * @param {Record<string, number>} seats side -> seats in a full match (SIDE_SEATS)
 * @param {() => number} rng 0..1
 * @returns {Map<string, string>} player id -> faction
 */
export function dealFactions(playerIds, seats, rng) {
    const shuffle = (list) => shuffled(list, rng);
    const order = shuffle(Object.keys(seats));
    const counts = new Map(order.map((faction) => [faction, 0]));
    const dealt = new Map();
    for (const id of shuffle(playerIds)) {
        // The least filled side; the first in the shuffled order when several are as empty.
        const faction = order.reduce((best, side) => (counts.get(side) / seats[side] < counts.get(best) / seats[best] ? side : best));
        counts.set(faction, counts.get(faction) + 1);
        dealt.set(id, faction);
    }
    return dealt;
}

/**
 * Deals a match's pilots into sides when one side is seldom for people (the pirates:
 * PEOPLE_AS_PIRATES). That side has its share of the pilots, as in dealFactions - one seat at
 * least, all of them in a full match - and the match is rolled once for who sits there:
 *  - `chance` of the time it is that side's match for people: people take its seats before any
 *    computer-flown player does (which people, the seed decides);
 *  - otherwise the computer-flown players take them, and no person is on that side - unless
 *    the other sides have no seat left for them. Seats nobody may take stay empty: a match of
 *    people alone is then between the other sides.
 * Everybody else is dealt into the other sides by dealFactions, people and computer-flown alike.
 * @param {{ id: string, bot?: boolean }[]} pilots
 * @param {Record<string, number>} seats side -> seats in a full match (SIDE_SEATS)
 * @param {() => number} rng 0..1
 * @param {{ faction: string, chance: number }} seldom the side people are seldom dealt into, and how often a match is theirs there
 * @returns {Map<string, string>} pilot id -> faction
 */
export function dealSides(pilots, seats, rng, seldom) {
    const { faction, chance } = seldom;
    const ids = pilots.map((pilot) => pilot.id);
    if (!(seats[faction] > 0)) return dealFactions(ids, seats, rng);
    const others = Object.fromEntries(Object.entries(seats).filter(([side]) => side !== faction));
    const room = Object.values(others).reduce((sum, count) => sum + count, 0);
    const people = shuffled(pilots.filter((pilot) => !pilot.bot).map((pilot) => pilot.id), rng);
    const bots = shuffled(pilots.filter((pilot) => pilot.bot).map((pilot) => pilot.id), rng);
    const forPeople = rng() < chance;
    const share = Math.min(seats[faction], Math.max(1, Math.round(ids.length * seats[faction] / (room + seats[faction]))));
    // Who is asked first, and how many of them may sit down; then whoever the other sides cannot seat.
    const queue = forPeople ? [...people, ...bots] : [...bots, ...people];
    const willing = forPeople ? ids.length : bots.length;
    const crew = new Set(queue.slice(0, Math.max(Math.min(share, willing), ids.length - room)));
    const dealt = dealFactions(ids.filter((id) => !crew.has(id)), others, rng);
    for (const id of crew) dealt.set(id, faction);
    return dealt;
}

export const LOYALTY = Object.freeze({
    /** Nothing to answer for. */
    TRUSTED: 'trusted',
    /** Has hurt their own side: told to cease fire. */
    WARNED: 'warned',
    /** Kept at it: no longer one of them. */
    TRAITOR: 'traitor',
});

/**
 * Keeps count of the damage a pilot does to the computer-flown ships of their own side.
 * Stray shots are forgiven with time; enough of them bring a warning, and going on after
 * the warning makes the pilot a traitor (the rules then turn them into a pirate).
 */
export class LoyaltyRecord {
    /** @param {{ warnDamage: number, treasonDamage: number, forgivePerSecond: number }} limits BATTLE_ROYALE.betrayal */
    constructor(limits) {
        this.limits = limits;
        this.damage = 0;
        this.status = LOYALTY.TRUSTED;
    }

    /**
     * Records damage done to an ally.
     * @returns {string | null} the new status if this crossed a line (WARNED or TRAITOR), else null
     */
    addDamage(amount) {
        if (this.status === LOYALTY.TRAITOR || !(amount > 0)) return null;
        this.damage += amount;
        if (this.damage >= this.limits.treasonDamage) {
            this.status = LOYALTY.TRAITOR;
            return this.status;
        }
        if (this.damage >= this.limits.warnDamage && this.status === LOYALTY.TRUSTED) {
            this.status = LOYALTY.WARNED;
            return this.status;
        }
        return null;
    }

    /** Forgives a little; a warned pilot who has kept their fire long enough is trusted again. */
    update(dt) {
        if (this.status === LOYALTY.TRAITOR || this.damage <= 0) return;
        this.damage = Math.max(0, this.damage - this.limits.forgivePerSecond * dt);
        if (this.status === LOYALTY.WARNED && this.damage < this.limits.warnDamage / 2) this.status = LOYALTY.TRUSTED;
    }
}

/** Pirates fly for nobody: no computer-flown ships, no reinforcements, and no truce among themselves. */
export const isPirate = (faction) => faction === FACTION.PIRATE;
