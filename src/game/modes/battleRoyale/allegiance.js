import { FACTION } from '../../config/gameConfig.js';

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
    const shuffle = (list) => {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };
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
