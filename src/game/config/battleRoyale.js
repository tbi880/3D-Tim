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
    /**
     * After the match is decided: the ending, played at the stargate before the result screen
     * (modes/battleRoyale/gateCeremony.js). Whoever won flies through the gate; everybody
     * else watches it open for them, and close. Distances are metres from the gate, back
     * down its approach; `open`, `close` and `fade` are shares of `seconds`.
     */
    outro: Object.freeze({
        seconds: 8,
        /** Where the winners' run at the gate starts, and how hard it accelerates (1 = steady speed). */
        approach: 4400,
        acceleration: 2.1,
        /** Winners fly in a loose wedge: metres between ships sideways, and each one's head start in seconds. */
        spacing: 70,
        stagger: 0.45,
        /** Where everybody else sits and watches: back, to the side and below the gate's axis. */
        gallery: Object.freeze([1500, -420, 4600]),
        /** Metres per second the watchers drift towards the gate that is no longer theirs. */
        drift: 35,
        /** When the gate's field has opened; when, for the watchers, the winners are through and it starts to close, and has. */
        open: 0.22,
        close: Object.freeze([0.6, 0.86]),
        /** From when the watchers' view darkens, and how dark it gets. */
        fade: Object.freeze([0.68, 0.85]),
        /** Seconds the picture takes to come up on the gate. */
        cut: 0.5,

        /**
         * And then what the winners left behind (modes/battleRoyale/systemFall.js): the black
         * hole takes the system. Seen from beside the dead gate, looking back down the approach:
         * the fleets of every side that did not get through - computer-flown and players'
         * alike - are dragged in, drawn out and torn apart, the station breaks up, and the dark
         * fills the sky. The winners watch it from outside; everybody else from their own
         * cockpit, until their ship goes too. Only then does the result come up.
         */
        fall: Object.freeze({
            seconds: 8,
            /** Where it is seen from, in the gate's axes: [sideways, above, back down the approach] in metres. */
            seat: Object.freeze([1300, -250, 700]),
            /** Where the black hole comes from, in the gate's axes: back down the approach, a little to one side and high. */
            from: Object.freeze([-0.18, 0.1, -1]),
            /** Most computer-flown ships of each losing side shown, and most players' ships. */
            fleet: 7,
            pilots: 8,
            /** How deep in front of the view the ships are spread: nearest and farthest (metres). */
            depth: Object.freeze([300, 2400]),
            /** None of them waits closer than this to the gate's axis: that is the winners' road (metres). */
            road: 350,
            /** Shares of `seconds` between which they are torn apart: the farthest first, the nearest last. */
            tearing: Object.freeze([0.2, 0.84]),
            /** Seconds a ship is drawn out before it bursts, and how hard everything is dragged in (m/s2). */
            stretch: 1.4,
            pull: 240,
            /** Shares of `seconds` at which the station starts to break up, and a watcher's own ship is torn apart. */
            station: 0.1,
            own: 0.9,
            /** Seconds the picture takes to come up, and to go black at the end. */
            cut: 0.5,
            dark: 0.8,
        }),
    }),

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

    /**
     * The stargate itself: a ring ships can fly through (config/shipClasses.js `stargate`),
     * standing off the last planet's station - `offset` is in that station's axes: beyond it
     * and above, facing back down the approach lane, so it hangs over the station as ships
     * arrive. It is scenery while the match is fought (the station is what is taken), and the
     * way out once it is decided. `charge` is how strongly its field shows: asleep, when the
     * last stand begins, and when the last stand runs out.
     */
    gate: Object.freeze({
        classId: 'stargate',
        offset: Object.freeze([0, 2600, 6400]),
        /** Rocks closer than this to the ring are cleared away (metres). */
        clearance: 200,
        charge: Object.freeze({ asleep: 0.1, lastStand: 0.35, ready: 0.85 }),
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
     * Computer-flown players ("bots"). When a match starts with fewer than `fillTo` players the
     * empty seats are taken by bots, unless the room's `bots` setting says "none". A bot is a
     * player in everything the rules know: it is dealt a side, flies one of the players' ships
     * with the players' own flight model and weapons, scores, docks, votes and wins or loses
     * with its side. Only its decisions are a program's (modes/battleRoyale/bots.js), and they
     * run on the host's device.
     */
    bots: Object.freeze({
        fillTo: 6,
        defaultSetting: 'fill',
        /** Shown as "AI·Vega": everybody can tell who is not a person. */
        namePrefix: 'AI·',
        names: Object.freeze(['Vega', 'Orion', 'Lyra', 'Altair', 'Rigel', 'Deneb', 'Sirius', 'Castor']),
        /** Seconds between a bot's decisions (what to do); it steers every frame. */
        thinkInterval: 0.4,
        /** A bot goes for hostiles within this many metres - or for whoever shot it last. */
        engageRange: 3200,
        /** Closer than this to its target it breaks away, for [least, most] seconds, and comes round again. */
        breakDistance: 240,
        breakSeconds: Object.freeze([1.4, 2.8]),
        /** Beams are fired in bursts: [seconds firing, seconds holding fire]. */
        burst: Object.freeze([2.4, 1.2]),
        /** Seconds between torpedoes: [least, most]. */
        torpedoPause: Object.freeze([2, 4]),
        /** A bot docks at a station only with no hostile ship this near it (metres)... */
        dockClearRange: 2400,
        /** ...and lets go if it is shot down to this share of its shield while docked. */
        undockShield: 0.35,
        /** It jumps outwards this many seconds before its planet starts to fall in, if the drive is charged... */
        fleeAhead: 45,
        /**
         * ...and, from a planet its side holds, after this many quiet seconds - but never
         * further than `maxAhead` orbits ahead of the innermost planet still standing: bots
         * fight over the planets the collapse is coming for, and reach the gate when it does.
         */
        restSeconds: 20,
        maxAhead: 2,
        /** With its shield down to this share a bot runs - afterburner, away from whoever is nearest - until it is back to `recoverShield`. */
        retreatShield: 0.2,
        recoverShield: 0.6,
        /** Big ships are only attacked when no small one is within this many metres. */
        fighterFirstRange: 2000,
        /**
         * When a bot presses its ship's ability button (config/abilities.js), if it is charged:
         *   dashShield      the Swift's dash and the Peregrine's cloak, when breaking away or running
         *                   with its shield down to this share
         *   torpedoShield   the Kestrel's breach torpedo, at a locked target with at least this
         *                   share of its shield still up, within `torpedoRange` of the warhead's
         *                   reach and `torpedoOffAxis` radians off the nose
         *   detonateWithin  that warhead is set off by hand once it is this near its target (metres)
         *                   and no longer closing on it
         *   lanceRange      the Shrike's lance, at a target within this many metres and
         *                   `lanceOffAxis` radians off the nose
         */
        ability: Object.freeze({
            dashShield: 0.6,
            torpedoShield: 0.3,
            torpedoRange: 0.8,
            torpedoOffAxis: 0.35,
            detonateWithin: 320,
            lanceRange: 5000,
            lanceOffAxis: 0.4,
        }),
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
