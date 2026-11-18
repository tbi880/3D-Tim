/**
 * Equipment: the single-use pieces a pilot can carry in the battle royale. What each one
 * does is played by the rules (BattleRoyaleMode); this is the list, and the pilot's bag.
 */
export const EQUIPMENT = Object.freeze({
    /** Launched at a neighbouring planet: from then on the map shows what is there and who holds it. */
    BEACON: 'beacon',
    /** Comes on by itself the next time the black hole's gravity would hurt: for a while it cannot. */
    GRAVITY_SHIELD: 'gravityShield',
    /** Comes on by itself at a hit that would have killed: for a while the hull holds at a sliver, and nothing mends. */
    EMERGENCY_SHIELD: 'emergencyShield',
    /**
     * Burns out in one overdrive jump: across two orbits, or at once while the drive is still
     * charging (the charge does not hold it, and runs on as it was); an ordinary jump leaves it alone.
     */
    OVERDRIVE: 'overdrive',
});

/** The order equipment is always listed in. */
export const EQUIPMENT_ORDER = Object.freeze([EQUIPMENT.BEACON, EQUIPMENT.GRAVITY_SHIELD, EQUIPMENT.EMERGENCY_SHIELD, EQUIPMENT.OVERDRIVE]);

export const isEquipment = (value) => EQUIPMENT_ORDER.includes(value);

/** What one pilot carries, and how many pieces they may still choose. */
export class Inventory {
    /**
     * @param {object} params
     * @param {number} params.picks pieces the pilot may choose from the start
     * @param {number} params.stack most of one piece they can carry
     */
    constructor({ picks, stack }) {
        this.picks = picks;
        this.stack = stack;
        this.counts = Object.fromEntries(EQUIPMENT_ORDER.map((item) => [item, 0]));
    }

    has(item) {
        return this.counts[item] > 0;
    }

    /** Lets the pilot choose `count` more pieces. */
    grant(count) {
        this.picks += count;
    }

    /** Spends a choice on `item`. False - and nothing changes - if there is no choice to spend or no room for it. */
    pick(item) {
        if (!isEquipment(item) || this.picks <= 0 || this.counts[item] >= this.stack) return false;
        this.picks -= 1;
        this.counts[item] += 1;
        return true;
    }

    /** Uses one `item` up. False if the pilot has none. */
    use(item) {
        if (!this.has(item)) return false;
        this.counts[item] -= 1;
        return true;
    }

    describe() {
        return { ...this.counts };
    }
}
