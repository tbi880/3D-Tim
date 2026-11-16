import { FACTION } from './gameConfig.js';

/**
 * Tuning for the battle royale (multiplayer): three sides fight their way outwards through
 * a star system whose sun is collapsing into a black hole, towards the stargate at its edge.
 * The rules that play these tables are in modes/battleRoyale/.
 *
 * Times are seconds, distances metres.
 */

/**
 * The star system, innermost orbit first. A jump only reaches the next orbit in or out.
 * Each planet is fought over in one of the story's sectors (config/sectors.js supplies its
 * sky and start point); the last one holds the stargate.
 */
export const STAR_SYSTEM = Object.freeze({
    id: 'helion',
    planets: Object.freeze([
        { id: 'ember', sectorId: 'cinder' },
        { id: 'rust', sectorId: 'forge' },
        { id: 'haven', sectorId: 'home' },
        { id: 'veil', sectorId: 'veil' },
        { id: 'colossus', sectorId: 'graveyard' },
        { id: 'threshold', sectorId: 'lantern', gate: true },
    ]),
});

/** The sides players are dealt into. Pirates have no computer-flown ships and no friends. */
export const PLAYER_FACTIONS = Object.freeze([FACTION.DAWN, FACTION.UMBRA, FACTION.PIRATE]);
/** The sides that garrison planets. */
export const NPC_FACTIONS = Object.freeze([FACTION.DAWN, FACTION.UMBRA]);

export const BATTLE_ROYALE = Object.freeze({
    /** Players can hurt their own side's computer-flown ships (and be branded pirates for it). */
    friendlyFire: true,

    /**
     * Before anybody flies: the story so far and who is on which side. For these seconds the
     * players are not in the system at all - nothing can touch them - and watch the dying
     * sun (`sectorId`'s sky) from outside. When it ends every ship drops out of warp at once.
     */
    intro: Object.freeze({ seconds: 10, sectorId: 'collapse' }),
    /** After the match is decided: seconds of ending shown before the result screen. */
    outro: Object.freeze({ seconds: 5 }),

    jump: Object.freeze({
        /** Seconds the drive needs after arriving anywhere before it can jump again. */
        cooldown: 60,
        /** Seconds from choosing a destination to leaving; the ship can still be shot down. */
        spool: 3,
        /** Arriving ships are scattered this far around the sector's start point. */
        scatter: 450,
    }),

    collapse: Object.freeze({
        /** Seconds from the start of the match to the first planet starting to fall in: [least, most]. */
        firstAfter: Object.freeze([180, 300]),
        /** Seconds from one planet being swallowed to the next one starting to fall in. */
        interval: Object.freeze([180, 300]),
        /** Seconds a planet takes to fall in: ships there bleed, but can still jump away. */
        collapsing: 30,
        /** Share of a ship's shield + hull lost per second while its planet is falling in... */
        collapsingDrain: 0.022,
        /** ...and once it has been swallowed: nothing lives long, and nothing jumps out. */
        swallowedDrain: 0.3,
        /**
         * Seconds the last planet stands once every other one is gone. If no side has taken the
         * stargate by then, the side with the most ships at it goes through.
         */
        finalStand: 300,
    }),

    capture: Object.freeze({
        /** Refit points for every player of the side that takes a planet, if it takes the reward. */
        points: 3,
        piratePoints: 9,
        /** Calls for reinforcements earned with it (never by pirates). */
        summons: 1,
        /** Seconds the side has to choose between the reward and bringing its fallen back. */
        voteSeconds: 12,
        score: 400,
    }),

    /** Ships that answer a call for reinforcements, and how far behind the caller they arrive. */
    summon: Object.freeze({
        count: 3,
        distance: 600,
        ships: Object.freeze({ [FACTION.DAWN]: 'dart', [FACTION.UMBRA]: 'raider' }),
    }),

    betrayal: Object.freeze({
        /** Damage to one's own side that brings a warning, and that makes a pilot a pirate. */
        warnDamage: 45,
        treasonDamage: 130,
        /** Damage forgiven per second without further offence. */
        forgivePerSecond: 3,
    }),

    score: Object.freeze({
        playerKill: 500,
        /** Points for destroying a computer-flown ship, by class; classes not listed score nothing. */
        ships: Object.freeze({ drone: 100, raider: 150, lancer: 250, corvette: 600, warden: 1000, dart: 120, harrier: 900 }),
    }),

    /**
     * What stands at a planet when the match starts: one side's garrison, or both (a battle).
     * `[classId, count]` lists; the stargate's planet always has both sides, in strength.
     */
    garrisons: Object.freeze({
        [FACTION.DAWN]: Object.freeze([['harrier', 1], ['dart', 3]]),
        [FACTION.UMBRA]: Object.freeze([['corvette', 2], ['raider', 3], ['drone', 2]]),
        gate: Object.freeze({
            [FACTION.DAWN]: Object.freeze([['harrier', 2], ['dart', 5]]),
            [FACTION.UMBRA]: Object.freeze([['warden', 1], ['corvette', 2], ['raider', 4]]),
        }),
        /** Where each side holds station, relative to the sector's start point, and how spread out. */
        offsets: Object.freeze({ [FACTION.DAWN]: [-2600, 300, -3200], [FACTION.UMBRA]: [2600, -200, -3600] }),
        spacing: 220,
        /**
         * A garrison with nobody to fight stays on guard: it only goes for ships that come
         * this close (or that shoot at it). Arriving ships drop out of warp further away than
         * that, so a pilot can look before they leap. Two garrisons at war hunt freely.
         */
        guardRange: 3000,
    }),

    /**
     * Match lengths a host can choose. `timeScale` multiplies every waiting time above (the
     * collapse schedule and the jump cooldown); "quick" is for a short game or a test.
     */
    paces: Object.freeze({
        standard: Object.freeze({ timeScale: 1 }),
        quick: Object.freeze({ timeScale: 0.3 }),
    }),
    defaultPace: 'standard',

    /**
     * Damage scaling for every zone: nothing is tilted towards anyone, and both fleets'
     * computer-flown ships hit each other at full strength (see DIFFICULTY in config/gameConfig.js).
     */
    difficulty: Object.freeze({
        id: 'versus', damageTaken: 1, allyDamageTaken: 1, enemyToughness: 1, enemyFireRate: 1,
        enemyBeamDamage: 1, allyDamage: 1, shieldRegen: 1, allyDamageVsShips: 1,
    }),
});
