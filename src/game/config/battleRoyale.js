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

/**
 * The sides players are dealt into. The pirates are a side like the other two - they start
 * together, share what they know and win together - with no computer-flown ships, and with
 * nothing to stop one pirate shooting another (core/systems/damage.js `mayAttack`).
 */
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
        /** Share of a ship's shield + hull lost per second while its planet is falling in. */
        collapsingDrain: 0.022,
        /**
         * Seconds an undamaged ship lasts at a planet that has been swallowed: the black hole takes
         * shield and hull at a steady rate that nothing softens, and nothing jumps out. It is
         * shorter than taking a held station needs (`station.heldSeconds` plus the flight to
         * its dock), so jumping into a swallowed planet to steal its bubble cannot work.
         */
        swallowedSeconds: 20,
        /**
         * Seconds the last planet stands once every other one is gone. Taking the stargate's
         * station does not end the match: the side that holds it when this runs out goes
         * through (if nobody does, the side with the most ships at it). Only the death of
         * every other side ends it sooner.
         */
        finalStand: 300,
    }),

    /**
     * Every planet has a station, and whoever holds the station holds the planet. It is taken
     * by docking: fly into the mouth of its dock, clamp on, and stay clamped until the locks
     * give. A docked ship cannot fly or fire - but can let go at any moment.
     * Positions are in the station's own axes (the model of config/shipClasses.js
     * `lanternStation`: its dock opens towards -z, and ships fly into it along +z).
     */
    station: Object.freeze({
        classId: 'lanternStation',
        /** Metres from the middle of the station back down its approach lane to where ships drop out of warp. */
        arrival: 3400,
        /** The mouth of the dock: a ship within `range` metres of it can clamp on. */
        mouth: Object.freeze([0, -120, 1643]),
        range: 320,
        /** Where a docked ship is held, nose to the door, and how fast it is drawn there (1/s). */
        berth: Object.freeze([0, -120, 1560]),
        pull: 2.5,
        /** Seconds docked to take a station nobody holds, and one another side holds. */
        seconds: 10,
        heldSeconds: 15,
        /** Rocks closer than this to the hull or the approach lane are cleared away (metres). */
        clearance: 160,
    }),

    capture: Object.freeze({
        /** Refit points for every player of the side that takes a planet, if it takes the reward. */
        points: 3,
        piratePoints: 9,
        /** Calls for reinforcements earned with it (never by pirates). */
        summons: 1,
        /** Pieces of equipment each of them may choose (config `equipment`), whatever the side decides. */
        picks: 1,
        /** Seconds the side has to choose between the reward and bringing its fallen back. */
        voteSeconds: 12,
        score: 400,
    }),

    /**
     * Equipment (the quartermaster's stores): single-use pieces a pilot carries. Everybody may
     * choose `startingPicks` before the match, and one more for every station their side takes
     * while they are there. The pieces themselves are in modes/battleRoyale/equipment.js.
     */
    equipment: Object.freeze({
        startingPicks: 1,
        /** Most of one piece a pilot can carry. */
        stack: 9,
        /** Seconds the gravity shield keeps the black hole off once it has come on. */
        gravityShieldSeconds: 30,
        /** Seconds the emergency shield holds the hull, and the share of the hull it holds it at. */
        emergencyShieldSeconds: 10,
        emergencyHull: 0.01,
        /** Orbits an overdrive chip lets one jump cross (an ordinary jump crosses 1). */
        overdriveReach: 2,
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
        /**
         * Where each side holds station - inside the station's ring, either side of the lane to
         * its dock (the station's own axes) - and how spread out.
         */
        offsets: Object.freeze({ [FACTION.DAWN]: [-1100, 300, 400], [FACTION.UMBRA]: [1100, -200, 250] }),
        spacing: 200,
        /**
         * A garrison with nobody to fight stays on guard: it only goes for ships that come
         * this close (or that shoot at it). Arriving ships drop out of warp further away than
         * that, so a pilot can look before they leap. Two garrisons at war hunt freely.
         */
        guardRange: 2800,
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
