import { DIFFICULTY, FACTION } from './gameConfig.js';

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
/**
 * Seats in a full match, by side: ten players, four Federation, four Umbra, two pirates. A
 * match with fewer players is dealt in the same proportions (allegiance.js dealFactions), and
 * the computer-flown players fill it up to this (`bots.fillTo`).
 */
export const SIDE_SEATS = Object.freeze({ [FACTION.DAWN]: 4, [FACTION.UMBRA]: 4, [FACTION.PIRATE]: 2 });
/** Most players in a match (and in a room: the lobby server's LanRoomOptions.MaxPlayersLimit is the same). */
export const MAX_PLAYERS = Object.values(SIDE_SEATS).reduce((sum, seats) => sum + seats, 0);
/**
 * The single-player level every computer-flown ship of a match fights at (`difficulty`, below):
 * as tough, as quick on the trigger and as painful to a player as the story's Umbra are there.
 */
const NPC_LEVEL = DIFFICULTY.admiral;

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
        /**
         * Seconds the drive needs after an ordinary jump (or a new ship's arrival) before it can
         * jump again. An overdrive chip is not held by it, and its jump leaves it as it was.
         */
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
         * shield and hull at a steady rate that nothing softens - holding the planet's station
         * included (it goes down with the planet: nobody holds or docks at it any more) - and
         * nothing jumps out, but a pilot whose gravity shield is on (equipment.js) while it lasts.
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

    /**
     * Taking a planet pays every pilot of the side who is there, and brings every pilot of the
     * side who is down back to that planet at once: no choosing between the two.
     */
    capture: Object.freeze({
        /** Refit points for every player of the side who is at the planet when it is taken. */
        points: 3,
        piratePoints: 9,
        /** Calls for reinforcements earned with it (never by pirates). */
        summons: 1,
        /** Pieces of equipment each of them may choose (config `equipment`). */
        picks: 1,
        score: 400,
    }),

    /**
     * Coming back after being shot down: once the wait is over, a pilot chooses a station their
     * side holds, and a new ship (with their refits, score and equipment) comes out of its
     * departure hangar - as the Kestrel leaves Lantern in the story, but with no traffic control:
     * the throttle is open all the way and the helm is the pilot's from the first moment.
     * The wait is `wait` seconds the first time and `waitStep` more after every such comeback:
     * 10, 20, 30 ... Being brought back by a capture (above) does not lengthen it. A side whose
     * pilots are all down is still in the match while it holds a station to come back to.
     */
    respawn: Object.freeze({
        wait: 10,
        waitStep: 10,
        /** Seconds a pilot has to choose, once they can, before they are sent to the first station offered. */
        choose: 20,
        /**
         * Where the new ship starts, in the station's own axes: in front of the departure
         * hangar's door (the upper of its two, at z 1653), nose out along the departure lane
         * (-z). Ships coming back together are spread up to `spread` metres across the door
         * ([sideways, up and down]); the door is 280 x 124 m.
         */
        exit: Object.freeze([0, 300, 1535]),
        spread: Object.freeze([100, 40]),
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

    /**
     * Ships that answer a call for reinforcements, and where they drop out of warp: in front of
     * the caller, where its pilot sees them streak in (garrisons.js reinforcementSpots: `ahead`
     * metres along its nose, on an arc of `arc` radians above its line of sight `ring` metres out,
     * give or take `scatter`; a spot less than `clearance` metres from a hull or a rock is used
     * behind the caller instead). They stay with the fight they were called into for a while
     * (`strategy.summonCommit`), then go where their side needs them, jumping as a squad by a
     * pilot's rules (squads.js).
     */
    summon: Object.freeze({
        count: 3,
        ahead: 700,
        ring: 260,
        // Wide and low at the ends: a desktop's corner panels never cover the outer ones.
        arc: (5 * Math.PI) / 6,
        scatter: 50,
        clearance: 120,
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
        ships: Object.freeze({
            drone: 100, raider: 150, lancer: 250, corvette: 600, warden: 1000, penumbra: 2500, eclipseCannon: 300, dart: 120, harrier: 900,
        }),
    }),

    /**
     * What stands at a planet when the match starts: one side's garrison, or both (a battle).
     * `[classId, count]` lists; the stargate's planet always has both sides, in strength.
     */
    garrisons: Object.freeze({
        [FACTION.DAWN]: Object.freeze([['harrier', 1], ['dart', 3]]),
        [FACTION.UMBRA]: Object.freeze([['penumbra', 1], ['corvette', 2], ['raider', 4], ['drone', 2]]),
        gate: Object.freeze({
            [FACTION.DAWN]: Object.freeze([['harrier', 1], ['dart', 5]]),
            [FACTION.UMBRA]: Object.freeze([['penumbra', 1], ['warden', 1], ['corvette', 2], ['raider', 5], ['drone', 2]]),
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
     * The Umbra's motherships: a 'penumbra' in a garrison list above (one at most per side and
     * planet) does not go in the ring with the rest - it is far too big - but holds station
     * outside it at `berth` (the station's own axes: off to the Umbra's side of the approach
     * lane, beyond the ring), facing the station, and never moves from there. Its two gun
     * batteries (`cannonClassId`) are bolted on; neither they nor its beam reach the dock or
     * where ships arrive. Its hangar (modes/battleRoyale/carriers.js) puts out a flight while an
     * enemy is within `alertRange` metres of its hull or `dockRange` of the station's dock: the
     * first `scramble` seconds after one comes, then one every `launchSeconds`, as long as fewer than
     * `wingMax` of its fighters fly - `flights` in all. A flight is `drones` drones, or (by a
     * chance of `lancerChance`, when an enemy ship of the line is there) `lancers` torpedo bombers.
     */
    carrier: Object.freeze({
        classId: 'penumbra',
        cannonClassId: 'eclipseCannon',
        berth: Object.freeze([5600, 500, -900]),
        /** Rocks closer than this to its hull are cleared away (metres). */
        clearance: 200,
        alertRange: 3000,
        dockRange: 2800,
        scramble: 6,
        launchSeconds: 30,
        flights: 5,
        wingMax: 4,
        drones: 3,
        lancers: 2,
        lancerChance: 0.35,
    }),

    /**
     * Computer-flown players ("bots"). When a match starts with fewer than `fillTo` players (every seat: MAX_PLAYERS) the
     * empty seats are taken by bots, unless the room's `bots` setting says "none". A bot is a
     * player in everything the rules know: it is dealt a side, flies one of the players' ships
     * with the players' own flight model and weapons, scores, docks, comes back and wins or loses
     * with its side. Only its decisions are a program's (modes/battleRoyale/bots.js), and they
     * run on the host's device.
     */
    bots: Object.freeze({
        fillTo: MAX_PLAYERS,
        defaultSetting: 'fill',
        /** Shown as "AI·Vega": everybody can tell who is not a person. */
        namePrefix: 'AI·',
        names: Object.freeze(['Vega', 'Orion', 'Lyra', 'Altair', 'Rigel', 'Deneb', 'Sirius', 'Castor', 'Polaris', 'Capella', 'Antares', 'Mira']),
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
        /**
         * Whatever its orders (strategy, below), it jumps outwards this many seconds before its
         * planet starts to fall in, if the drive is charged - whoever holds the station there.
         * (Reinforcements do the same.)
         */
        fleeAhead: 45,
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
        /** Seconds with nothing hostile in reach before a bot leaves a planet for work that is not urgent (strategy, below). */
        leaveQuiet: 5,
    }),

    /**
     * Where each side's computer-flown units go: its bots, and the reinforcements its pilots
     * have called (modes/battleRoyale/strategy.js, on the host's device). Every `planInterval`
     * seconds a side looks at the system as its pilots can see it and lists what needs doing,
     * most pressing first - a station of its being taken, enemies at a station it holds, a
     * comrade outnumbered, a station to take, one ship on watch at each station it holds - and
     * hands each unit the job worth most to it, less `hopCost` for every jump on the way. A job
     * asks for `need` strength (a player's ship is 1); once that is met the next unit goes to
     * the next job, so a side does not pile everything into one place and leave the rest bare.
     */
    strategy: Object.freeze({
        planInterval: 2,
        /** Worth of each job before the way there is paid for. */
        priority: Object.freeze({
            /** Another side is docked at a station the side holds. */
            dockAlarm: 100,
            /** Hostile ships at a station the side holds. */
            defend: 75,
            /** A pilot of the side was shot down at a station it holds a moment ago. */
            avenge: 70,
            /** A pilot of the side is outnumbered somewhere the side holds nothing. */
            rescue: 65,
            /** A station to take while the side holds none and has pilots down (taking it brings them back). */
            revive: 80,
            /** A station the side does not hold: `take`, plus `takePerOrbit` for every orbit out, plus `reviveEach` for every pilot of the side who is down. */
            take: 40,
            takePerOrbit: 4,
            reviveEach: 3,
            /**
             * One ship on watch at a station the side holds, plus `guardPerOrbit` for every orbit
             * out: at the most valuable one (the outermost) `guardFirst`, at the next `guardSecond`
             * - so a side with more than one unit never leaves its best stations bare - at the rest `guard`.
             */
            guardFirst: 50,
            guardSecond: 32,
            guard: 12,
            guardPerOrbit: 3,
            /** Added for the stargate's station, once it is within reach (`maxAhead`). */
            gate: 15,
        }),
        /**
         * Stations further out than this many orbits past the innermost planet still standing
         * are not taken yet: a side fights over the planets the collapse is coming for, and
         * reaches the gate when it does. (Guarding and defending what it holds know no such limit.)
         */
        maxAhead: 2,
        /** Worth lost per jump on the way (a jump costs a minute of the drive's charge). */
        hopCost: 10,
        /** Worth added to staying with the job a unit already has: it does not dither between two. */
        stickiness: 12,
        /** Worth lost by a job whose `need` is already met (a unit with nothing better still goes somewhere useful). */
        overflow: 25,
        /** Reinforcements cannot dock: a station to take is worth less to them, and keeping watch more - a pilot's ship is freed to take stations. */
        squadTake: 20,
        squadGuard: 10,
        /** Strength wanted against the enemy at a place (times theirs, plus a margin), and the most any one job asks for. */
        overmatch: 1.2,
        margin: 0.5,
        maxNeed: 4,
        /** Strength wanted at a station being taken, at least. */
        dockAlarmNeed: 1.5,
        /**
         * A side only takes on a fight where the enemy is at most this many times what it can
         * bring there (all its units, and its people and garrison there) - for a station of its
         * own being taken, `dockAlarmBoldness` times bolder still.
         */
        boldness: 1.3,
        dockAlarmBoldness: 1.5,
        /** Ships at the stargate's station kept on watch once the last stand is near. */
        gateGuards: 2,
        /** Enemy strength assumed where the side has no eyes. */
        unknownEnemy: 1,
        /** Strength of a ship: a player's (bots included), a computer-flown capital ship, any other. */
        strength: Object.freeze({ player: 1, capital: 1.5, other: 0.4 }),
        /** Seconds a pilot's loss at a place counts as a sign of trouble there, and since a hit that a pilot is under fire. */
        lossMemory: 30,
        underFireSeconds: 4,
        /**
         * A planet due to start falling in sooner than this is not worth guarding or taking (nor
         * taking to bring the fallen back: they would come out where the collapse is coming)...
         */
        doomSeconds: 90,
        /** ...and a route must leave each planet on the way this long before its collapse begins. */
        routeMargin: 15,
        /** Reinforcements stay with the fight they were called into this long before they take other orders. */
        summonCommit: 45,
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
     * Damage scaling for every zone (see DIFFICULTY and its `versus` in config/gameConfig.js).
     * Nothing is tilted towards any side: the computer-flown ships of both fleets fight at
     * `NPC_LEVEL` - against players of every side, and against each other, where the same
     * numbers on both sides cancel out evenly. A player's ship takes from them what it would
     * from the story's Umbra at that level (`damageTaken`), whichever fleet is shooting.
     * The two fleets are not built alike, so a few classes carry a share of their own
     * (`classes`), tuned in headless battles and whole matches of bots (the battles are kept
     * in tests/game/fleetBalance.test.js): the Federation's frigate was the story's ally, whose
     * beams never miss a fighter, so they do four tenths of their damage to a player's ship;
     * the Umbra's cruiser soaks up more. With those (and the garrisons and the mothership's
     * hangar below) a planet's garrisons fight each other about evenly, a pilot at either
     * side's dock is under about the same fire, and bots win as often for either side. Both
     * fleets go for players first (`pilotsFirst`): they are there to keep the station.
     * Between players the guns are turned down (`playerDamage`): beams and torpedoes - a breach
     * torpedo's own impact included - do a quarter of what they do to anything else, so a duel
     * is not over in the flight time of two torpedoes and the abilities, which are not turned
     * down, decide it. Shields recharge at their ordinary rate.
     */
    difficulty: Object.freeze({
        id: 'versus', versus: true,
        damageTaken: NPC_LEVEL.damageTaken,
        enemyToughness: NPC_LEVEL.enemyToughness,
        enemyFireRate: NPC_LEVEL.enemyFireRate,
        enemyBeamDamage: NPC_LEVEL.enemyBeamDamage,
        playerDamage: 0.25,
        shieldRegen: 1,
        pilotsFirst: true,
        classes: Object.freeze({
            harrier: Object.freeze({ toughness: 1, pilotDamage: 0.4 }),
            warden: Object.freeze({ toughness: 1.8 }),
        }),
    }),
});
