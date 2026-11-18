import { Vector3 } from 'three';
import { BATTLE_ROYALE, NPC_FACTIONS, PEOPLE_AS_PIRATES, PLAYER_FACTIONS, SIDE_SEATS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { RATING_ORDER } from '../../config/playerShips.js';
import { SECTORS } from '../../config/sectors.js';
import { createRng, randomUnitVector } from '../../core/math.js';
import { mergeUpgrades } from '../../core/refit.js';
import { destroyShip, drainShip } from '../../core/systems/damage.js';
import { FEED_TYPE, KILL_CAUSE, describeKill } from '../../net/match/feed.js';
import { cleanUpgrades } from '../../net/match/matchInfo.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { WORLD_EVENT } from '../../net/protocol.js';
import { LOYALTY, LoyaltyRecord, dealSides, isPirate } from './allegiance.js';
import { BR_EVENT, BR_REQUEST, DOCK_END, DOCK_REFUSAL, JUMP_REFUSAL, RESPAWN_REFUSAL } from './battleRoyaleProtocol.js';
import { BotPilot, seatBots } from './bots.js';
import { Hangar, berthCarrier, restoreHangars } from './carriers.js';
import { CollapseClock, PLANET_STATUS } from './collapse.js';
import { EQUIPMENT, Inventory } from './equipment.js';
import { dragOf, holeDirection } from './planetFall.js';
import { callReinforcements, planGarrisons, stationGarrison } from './garrisons.js';
import { StarMap } from './starMap.js';
import { Squad, restoreSquads, squadIdOf, squadTag } from './squads.js';
import { GATE_TAG, buildGate, buildStation, findStation, ghostStation, stationPose } from './station.js';
import { WarCouncil, shipStrength } from './strategy.js';

const scratchOffset = new Vector3();
const sumLevels = (upgrades) => Object.values(upgrades).reduce((sum, levels) => sum + levels, 0);
/** `[those that pass, the rest]`. */
const partition = (list, test) => [list.filter(test), list.filter((item) => !test(item))];

/** What the rules know about one player. */
class Contestant {
    constructor(pilot, faction) {
        this.pilot = pilot;
        this.faction = faction;
        this.alive = true;
        this.score = 0;
        this.kills = 0;
        this.deaths = 0;
        /** Refit points not yet spent. */
        this.points = 0;
        /** Calls for reinforcements not yet used. */
        this.summons = 0;
        /** Match time at which the jump drive is charged. */
        this.jumpReadyAt = 0;
        /** The jump being spooled up: { to, left, overdrive (it burns the chip) }, or null. */
        this.jump = null;
        /** The planet they enter the system at, once the introduction is over. */
        this.start = null;
        this.loyalty = new LoyaltyRecord(BATTLE_ROYALE.betrayal);
        /** The station they are clamped on to: { place, left, seconds }, or null. */
        this.dock = null;
        /** The equipment they carry and may still choose. */
        this.inventory = new Inventory({ picks: BATTLE_ROYALE.equipment.startingPicks, stack: BATTLE_ROYALE.equipment.stack });
        /** Match times until which their gravity shield and their emergency shield are on (0: off). */
        this.gravityShieldUntil = 0;
        this.emergencyShieldUntil = 0;
        /** When their ship was last hurt, as of the last look (see updateEmergencyShield). */
        this.seenDamageAt = -Infinity;
        /** Times they have come back at a station after being shot down: each one makes the next wait longer. */
        this.respawns = 0;
        /** While they are down: the match time from which they may come back (null while they fly). */
        this.respawnAt = null;
        /** Once they may come back and their side has a station: the match time they are sent to the first one offered. */
        this.chooseUntil = null;
        /** While they are down: the pilot whose flight they are watching (player id), or null. */
        this.watching = null;
    }
}

/** True for ships nothing in the match touches - the stations, the stargate: the black hole drains and sweeps everything else. */
const isScenery = (ship) => ship.invulnerable || ship.faction === FACTION.NEUTRAL;

/** What the rules know about one planet. */
class Place {
    constructor(planet, orbit, zone, station) {
        this.planet = planet;
        this.orbit = orbit;
        this.zone = zone;
        /** The planet's station (station.js): who docks at it long enough holds the planet. */
        this.station = station;
        /** The side that holds the station, or null. Holding it is no shelter from the collapse. */
        this.owner = null;
        /** The sides whose beacons watch the planet: what one pilot's beacon sees, their whole side sees. */
        this.scouts = new Set();
        this.status = PLANET_STATUS.SAFE;
        /** The hangars of the motherships holding station here (carriers.js). */
        this.hangars = [];
        /** Where the black hole stands in this planet's sky (unit vector), and where the station stood before it was dragged that way. */
        this.hole = holeDirection(planet.sectorId);
        this.stationHome = stationPose(SECTORS[planet.sectorId].playerStart, BATTLE_ROYALE.station).position;
        /** True once the station has broken up (some seconds after the planet was swallowed: planetFall.js). */
        this.stationFell = !station.ship.alive;
    }
}

/**
 * The rules of the battle royale (the "rules" half of a game mode, see modes/index.js).
 *
 * A star system whose sun is collapsing: planets are swallowed one by one from the inside,
 * and three sides - the Federation, the Umbra and the pirates - fight their way outwards to
 * the stargate on the last one. Players are dealt into the sides at random (people seldom
 * into the pirates: PEOPLE_AS_PIRATES); every planet has
 * a station, guarded by the Federation's or the Umbra's computer-flown garrison or fought
 * over by both. A side takes a planet by docking a ship at its station - and loses it the
 * same way. A pilot who is shot down comes back, after a wait that grows each time, at a
 * station their side holds - and may watch a comrade fly meanwhile; taking a planet brings
 * every one of the side's fallen back. A side whose pilots are all down at once is out.
 * The collapse spares nobody: holding a planet's station does not keep its pull off, and once
 * the planet is swallowed its station falls in with it and every ship there dies.
 * Ten players at most: four Federation, four Umbra, two pirates (SIDE_SEATS).
 *
 * Tuning is in config/battleRoyale.js. The pieces: StarMap (who can jump where), CollapseClock
 * (what falls in when), allegiance (sides and treason), station (the docks, and where the
 * stargate stands), garrisons (the computer-flown ships), carriers (the Umbra's motherships
 * and their hangars), equipment (what pilots carry),
 * bots (the computer-flown players), strategy (where each side's bots and reinforcements go)
 * and squads (reinforcements on the move). The ending is the presenter's (gateCeremony.js, then systemFall.js): the rules only say who won.
 * So is the story before the match (introShow.js, introStage.js): the rules only count its seconds - or end it when every player has asked.
 */
export class BattleRoyaleMode {
    /**
     * @param {object} info the match as normalizeMatchInfo returns it. `settings.pace` picks its
     *        length; `settings.intro = 'skip'` starts without the introduction (tests, mostly).
     *        (Players skip it together, by asking: `skipIntro`.)
     */
    constructor(info) {
        this.info = info;
        this.pace = BATTLE_ROYALE.paces[info.settings.pace] ?? BATTLE_ROYALE.paces[BATTLE_ROYALE.defaultPace];
        /** Seconds of introduction left; nobody is in the system until it reaches zero. */
        this.introLeft = info.settings.intro === 'skip' ? 0 : BATTLE_ROYALE.intro.seconds;
        /** Ids of the players who have asked to skip the introduction: it ends once every player has (`checkIntroSkips`). */
        this.introSkips = new Set();
        /** Server time at which the ships entered the system: the collapse counts from there. */
        this.startedAt = 0;
        this.rng = createRng(info.seed);
        this.map = new StarMap(STAR_SYSTEM);
        /** @type {Map<string, Contestant>} by player id */
        this.contestants = new Map();
        /** @type {Map<string, Place>} by planet id */
        this.places = new Map();
        this.clock = null;
        this.server = null;
        /** `{ winner: faction | null }` once the match is decided. */
        this.result = null;
        this.sidesAtStart = new Set();
        /** Sides that are out of the match: every pilot of theirs was down at once. Nobody of theirs comes back. */
        this.outSides = new Set();
        /** The computer-flown players' hands and heads (bots.js), one per bot. */
        this.bots = [];
        /** Reinforcements called by pilots (squads.js), as long as any of their ships is left. */
        this.squads = [];
        this.squadSerial = 0;
        /** The last number given to a mothership (carriers.js carrierTag). */
        this.carrierSerial = 0;
        /** @type {Map<string, WarCouncil>} by side: where its bots and reinforcements go (strategy.js) */
        this.councils = new Map();
    }

    get jumpCooldown() {
        return BATTLE_ROYALE.jump.cooldown * this.pace.timeScale;
    }

    /** The charge of a ship that has just come back from being shot down: shorter than after a jump. */
    get respawnJumpCooldown() {
        return BATTLE_ROYALE.respawn.jumpCooldown * this.pace.timeScale;
    }

    // ---- Setting up --------------------------------------------------------------------------

    /** Stands the stargate up at the last planet: scenery to fly round, or through, until the end. */
    raiseGate(zone) {
        buildGate(zone.world, zone.sectorId, BATTLE_ROYALE.station, BATTLE_ROYALE.gate, (rock) => zone.clearRock(rock));
    }

    setup(server) {
        this.server = server;
        const { map, rng } = this;
        this.clock = new CollapseClock({ planets: map.count, rng, timing: BATTLE_ROYALE.collapse, timeScale: this.pace.timeScale });

        const garrisons = planGarrisons(map.planets, NPC_FACTIONS, rng);
        map.planets.forEach((planet, orbit) => {
            const zone = server.addZone(planet.id, planet.sectorId, {
                seed: Math.floor(rng() * 0xffffffff), difficulty: BATTLE_ROYALE.difficulty, friendlyFire: BATTLE_ROYALE.friendlyFire,
            });
            const station = buildStation(zone, BATTLE_ROYALE.station);
            if (planet.gate) this.raiseGate(zone);
            const place = new Place(planet, orbit, zone, station);
            this.places.set(planet.id, place);
            const sidesHere = garrisons.get(planet.id);
            for (const faction of sidesHere) {
                const ships = planet.gate ? BATTLE_ROYALE.garrisons.gate[faction] : BATTLE_ROYALE.garrisons[faction];
                // A mothership holds station outside the ring; the rest of the garrison waits inside it.
                const [carriers, escorts] = partition(ships, ([classId]) => classId === BATTLE_ROYALE.carrier.classId);
                stationGarrison(zone, station, faction, escorts, BATTLE_ROYALE.garrisons, sidesHere.length === 1);
                if (carriers.some(([, count]) => count > 0)) this.berthCarrier(place, faction);
            }
        });

        // A match short of players is made up with computer-flown ones. They are dealt in with
        // everybody else - and are the pirates, four matches in five (PEOPLE_AS_PIRATES).
        seatBots(server, this.info.settings, rng);
        const sides = dealSides([...server.pilots.values()], SIDE_SEATS, rng, PEOPLE_AS_PIRATES);
        const startOf = new Map();
        for (const pilot of server.pilots.values()) {
            const faction = sides.get(pilot.id);
            const contestant = new Contestant(pilot, faction);
            this.contestants.set(pilot.id, contestant);
            if (pilot.bot) this.bots.push(new BotPilot(this, contestant, rng));
            this.sidesAtStart.add(faction);
            // A side starts together, the pirates like the rest.
            if (!startOf.has(faction)) startOf.set(faction, this.pickStart(faction, garrisons, new Set(startOf.values())));
            contestant.start = startOf.get(faction);
        }
        if (this.introLeft <= 0) this.enterSystem({ warpIn: false });
    }

    /** Brings a side's mothership to a planet's station, with a full hangar. */
    berthCarrier(place, faction) {
        this.carrierSerial += 1;
        const layout = BATTLE_ROYALE.carrier;
        const ship = berthCarrier(place.zone, place.station, faction, layout, this.carrierSerial);
        place.hangars.push(new Hangar({ id: this.carrierSerial, ship, dock: place.station.mouth, layout }));
    }

    /** The introduction is over: every pilot's ship arrives at its side's planet, and the clocks start. */
    enterSystem({ warpIn = true } = {}) {
        this.introLeft = 0;
        this.startedAt = this.server.time;
        for (const contestant of this.contestants.values()) {
            if (contestant.pilot.gone) continue;
            contestant.jumpReadyAt = this.server.time + this.jumpCooldown;
            this.launch(contestant, contestant.start, { warpIn });
        }
        this.server.publishState();
    }

    /**
     * Where a side starts: an inner planet, held by its own garrison if it has one, and not
     * one another side already starts on if that can be helped.
     */
    pickStart(faction, garrisons, taken) {
        const inner = this.map.planets.slice(0, Math.max(1, this.map.count - 2));
        const friendly = inner.filter((planet) => garrisons.get(planet.id).includes(faction));
        const pool = friendly.length > 0 ? friendly : inner;
        const free = pool.filter((planet) => !taken.has(this.places.get(planet.id)));
        const choices = free.length > 0 ? free : pool;
        return this.places.get(choices[Math.floor(this.rng() * choices.length)].id);
    }

    // ---- Handing the match on (MatchServer.capture / its `checkpoint`) ------------------------
    // (Not to be confused with `capture(place, faction)` below: that is a side taking a planet.)

    /**
     * Everything the rules know, as plain data. Times are written as "seconds from now", so
     * they mean the same on a device whose match clock is a little off.
     */
    saveState() {
        const { time } = this.server;
        return {
            introLeft: Math.max(0, this.introLeft),
            introSkips: [...this.introSkips],
            startedAt: this.startedAt,
            result: this.result,
            sidesAtStart: [...this.sidesAtStart],
            outSides: [...this.outSides],
            clock: this.clock.capture(),
            places: [...this.places.values()].map((place) => ({
                id: place.planet.id,
                owner: place.owner,
                scouts: [...place.scouts],
                hangars: place.hangars.filter((hangar) => hangar.alive).map((hangar) => hangar.save()),
            })),
            contestants: [...this.contestants.values()].map((contestant) => ({
                id: contestant.pilot.id,
                faction: contestant.faction,
                alive: contestant.alive,
                score: contestant.score,
                kills: contestant.kills,
                deaths: contestant.deaths,
                points: contestant.points,
                summons: contestant.summons,
                jumpReadyIn: contestant.jumpReadyAt - time,
                jump: contestant.jump,
                start: contestant.start?.planet.id ?? null,
                loyalty: [contestant.loyalty.damage, contestant.loyalty.status],
                dock: contestant.dock && { place: contestant.dock.place.planet.id, left: contestant.dock.left, seconds: contestant.dock.seconds },
                picks: contestant.inventory.picks,
                equipment: contestant.inventory.describe(),
                gravityShieldLeft: contestant.gravityShieldUntil - time,
                emergencyShieldLeft: contestant.emergencyShieldUntil - time,
                respawns: contestant.respawns,
                respawnIn: contestant.respawnAt === null ? null : contestant.respawnAt - time,
                chooseIn: contestant.chooseUntil === null ? null : contestant.chooseUntil - time,
            })),
            squads: this.squads.filter((squad) => squad.alive).map((squad) => squad.save(time)),
        };
    }

    /**
     * Goes on from another device's checkpoint instead of setting a match up: the places are
     * rebuilt with the ships they had, and everything the rules knew is put back. What the
     * checkpoint says is checked as it is read; what it leaves out gets a safe value.
     * @param {object} checkpoint MatchServer.capture()'s, with this mode's own part under `mode`
     */
    restoreState(server, checkpoint) {
        this.server = server;
        const data = checkpoint.mode ?? {};
        const { map, rng } = this;
        const { time } = server;
        const seconds = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
        const side = (value) => (PLAYER_FACTIONS.includes(value) ? value : null);
        const planetId = (value) => (map.has(value) ? value : null);

        this.introLeft = Math.max(0, seconds(data.introLeft));
        this.introSkips = new Set((Array.isArray(data.introSkips) ? data.introSkips : []).filter((id) => server.pilots.has(id)));
        this.startedAt = seconds(data.startedAt);
        this.result = data.result && typeof data.result === 'object' ? { winner: side(data.result.winner) } : null;
        this.sidesAtStart = new Set((Array.isArray(data.sidesAtStart) ? data.sidesAtStart : []).map(side).filter(Boolean));
        this.outSides = new Set((Array.isArray(data.outSides) ? data.outSides : []).map(side).filter(Boolean));
        this.clock = CollapseClock.resume(data.clock, map.count, BATTLE_ROYALE.collapse)
            ?? new CollapseClock({ planets: map.count, rng, timing: BATTLE_ROYALE.collapse, timeScale: this.pace.timeScale });
        this.clock.advanceTo(Math.max(0, time - this.startedAt));

        const savedPlaces = new Map((Array.isArray(data.places) ? data.places : []).map((place) => [place?.id, place]));
        map.planets.forEach((planet, orbit) => {
            const zone = server.restoreZone(planet.id, planet.sectorId, {
                seed: Math.floor(rng() * 0xffffffff), difficulty: BATTLE_ROYALE.difficulty, friendlyFire: BATTLE_ROYALE.friendlyFire,
            }, checkpoint.zones?.[planet.id]);
            // A checkpoint without the station (it never should be) gets a new one: the planet cannot be taken without it.
            // But a swallowed planet's station broke up, and stays gone.
            const brokeUp = (this.clock.secondsSinceSwallowed(orbit) ?? -1) >= BATTLE_ROYALE.collapse.show.stationBreaks;
            const station = findStation(zone, BATTLE_ROYALE.station)
                ?? (brokeUp ? ghostStation(planet.sectorId, BATTLE_ROYALE.station) : buildStation(zone, BATTLE_ROYALE.station));
            // (Nor should it be without the gate: a checkpoint from before there was one.)
            if (planet.gate && !zone.world.findByTag(GATE_TAG)) this.raiseGate(zone);
            const place = new Place(planet, orbit, zone, station);
            const saved = savedPlaces.get(planet.id) ?? {};
            place.status = this.clock.statusOf(orbit);
            // (A checkpoint from just before the planet was swallowed: its station has fallen in since.)
            place.owner = place.status === PLANET_STATUS.SWALLOWED ? null : side(saved.owner);
            place.scouts = new Set((Array.isArray(saved.scouts) ? saved.scouts : []).map(side).filter(Boolean));
            // The motherships are found again by the tags on their hulls.
            place.hangars = restoreHangars(zone.world, station, saved.hangars, BATTLE_ROYALE.carrier);
            this.carrierSerial = place.hangars.reduce((most, hangar) => Math.max(most, hangar.id), this.carrierSerial);
            this.places.set(planet.id, place);
        });

        const savedContestants = new Map((Array.isArray(data.contestants) ? data.contestants : []).map((entry) => [entry?.id, entry]));
        const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
        for (const pilot of server.pilots.values()) {
            const saved = savedContestants.get(pilot.id) ?? {};
            const contestant = new Contestant(pilot, side(saved.faction) ?? PLAYER_FACTIONS[0]);
            contestant.alive = Boolean(saved.alive) && Boolean(pilot.ship?.alive);
            contestant.score = count(saved.score);
            contestant.kills = count(saved.kills);
            contestant.deaths = count(saved.deaths);
            contestant.points = count(saved.points);
            contestant.summons = count(saved.summons);
            contestant.jumpReadyAt = time + seconds(saved.jumpReadyIn);
            contestant.start = this.places.get(planetId(saved.start)) ?? null;
            if (Array.isArray(saved.loyalty)) {
                contestant.loyalty.damage = Math.max(0, seconds(saved.loyalty[0]));
                if (Object.values(LOYALTY).includes(saved.loyalty[1])) contestant.loyalty.status = saved.loyalty[1];
            }
            contestant.inventory.picks = count(saved.picks);
            for (const item of Object.keys(contestant.inventory.counts)) contestant.inventory.counts[item] = Math.min(contestant.inventory.stack, count(saved.equipment?.[item]));
            contestant.gravityShieldUntil = time + seconds(saved.gravityShieldLeft, -1);
            contestant.emergencyShieldUntil = time + seconds(saved.emergencyShieldLeft, -1);
            contestant.respawns = count(saved.respawns);
            // Down, and not yet back: the wait goes on where it was (a checkpoint without one starts it again).
            if (!contestant.alive && !pilot.gone && this.introLeft <= 0 && !this.outSides.has(contestant.faction)) {
                contestant.respawnAt = time + seconds(saved.respawnIn, this.respawnWait(contestant.respawns));
                contestant.chooseUntil = Number.isFinite(saved.chooseIn) ? time + saved.chooseIn : null;
            }
            if (contestant.alive) {
                contestant.seenDamageAt = pilot.ship.lastDamagedAt;
                if (saved.jump && planetId(saved.jump.to)) contestant.jump = { to: saved.jump.to, left: Math.max(0, seconds(saved.jump.left)), overdrive: Boolean(saved.jump.overdrive) };
                const dockedAt = this.places.get(planetId(saved.dock?.place));
                if (dockedAt && dockedAt.zone === pilot.zone) {
                    contestant.dock = { place: dockedAt, left: Math.max(0, seconds(saved.dock.left)), seconds: Math.max(1, seconds(saved.dock.seconds, 1)) };
                    pilot.helmHeld = true;
                }
                this.armEmergencyShield(contestant);
            }
            this.contestants.set(pilot.id, contestant);
            if (pilot.bot) this.bots.push(new BotPilot(this, contestant, rng));
        }
        // The reinforcements are found again by the tags on their ships; the councils plan afresh.
        this.squads = restoreSquads(this, data.squads);
        this.squadSerial = this.squads.reduce((most, squad) => Math.max(most, squad.id), 0);
        server.publishState();
    }

    /**
     * Puts a contestant in a (new) ship at a planet. Arriving (by jump, or at the start) it drops
     * out of warp scattered around the far end of the station's approach lane, engines idle: a
     * pilot who is still reading the map does not drift into the garrison. Coming back after
     * being shot down (`fromStation`) it comes out of the station's departure hangar under full
     * throttle (stationExit).
     */
    launch(contestant, place, { warpIn = true, hullFraction = 1, fromStation = false } = {}) {
        const { position, facing } = fromStation ? this.stationExit(place) : this.arrivalPoint(place);
        contestant.alive = true;
        contestant.respawnAt = null;
        contestant.chooseUntil = null;
        contestant.watching = null;
        const ship = this.server.spawnPilotShip(contestant.pilot, place.zone, {
            faction: contestant.faction, position, facing, warpIn: warpIn && !fromStation, hullFraction,
        });
        ship.throttle = fromStation ? 1 : 0;
        contestant.seenDamageAt = ship.lastDamagedAt;
        this.armEmergencyShield(contestant);
        return ship;
    }

    /** Where a ship arriving at a planet drops out of warp: somewhere round the sector's start point. */
    arrivalPoint(place) {
        const start = SECTORS[place.zone.sectorId].playerStart;
        randomUnitVector(this.rng, scratchOffset);
        scratchOffset.y *= 0.3;
        const position = new Vector3().fromArray(start.position).addScaledVector(scratchOffset, BATTLE_ROYALE.jump.scatter * (0.3 + this.rng() * 0.7));
        return { position, facing: start.facing };
    }

    /**
     * Where a ship leaving a planet's station starts: in front of the door of its departure
     * hangar, nose out along the departure lane - where the Kestrel is let go of when it leaves
     * Lantern in the story (BATTLE_ROYALE.respawn `exit`).
     */
    stationExit(place) {
        const { exit, spread } = BATTLE_ROYALE.respawn;
        const across = (reach) => (this.rng() * 2 - 1) * reach;
        const local = [exit[0] + across(spread[0]), exit[1] + across(spread[1]), exit[2]];
        const { station } = place;
        return {
            position: station.toWorld(local, new Vector3()),
            facing: new Vector3(0, 0, -1).applyQuaternion(station.ship.quaternion),
        };
    }

    placeOf(contestant) {
        return contestant.pilot.zone ? this.places.get(contestant.pilot.zone.id) : null;
    }

    tellMode(pilot, name, data = null) {
        pilot.tell(WORLD_EVENT.MODE, name, data);
    }

    // ---- Every frame -------------------------------------------------------------------------

    update(dt) {
        if (this.result) return;
        if (this.introLeft > 0) {
            this.introLeft -= dt;
            if (this.introLeft <= 0) this.enterSystem();
            return;
        }
        const { time } = this.server;
        this.clock.advanceTo(time - this.startedAt);

        for (const place of this.places.values()) {
            this.updateCollapse(place, dt);
            this.updateHangars(place, dt);
        }
        for (const contestant of this.contestants.values()) {
            contestant.loyalty.update(dt);
            this.updateJump(contestant, dt);
            this.updateDock(contestant, dt);
            this.updateEmergencyShield(contestant);
            this.updateRespawn(contestant);
            this.updateWatching(contestant);
        }
        for (const faction of PLAYER_FACTIONS) this.councilOf(faction).update(dt);
        for (const squad of this.squads) squad.update(this, dt);
        this.squads = this.squads.filter((squad) => squad.alive);
        for (const bot of this.bots) bot.update(dt);
        this.checkEliminations();
        this.checkVictory();
    }

    /** Motherships launch their fighters, where anybody is there to see it (an empty planet is frozen). */
    updateHangars(place, dt) {
        if (place.hangars.length === 0) return;
        place.hangars = place.hangars.filter((hangar) => hangar.alive);
        if (!place.zone.active) return;
        for (const hangar of place.hangars) hangar.update(place.zone.world, dt);
    }

    // ---- The collapse ------------------------------------------------------------------------

    updateCollapse(place, dt) {
        const status = this.clock.statusOf(place.orbit);
        if (status !== place.status) {
            place.status = status;
            for (const pilot of this.server.pilots.values()) this.tellMode(pilot, BR_EVENT.COLLAPSE, { planet: place.planet.id, status });
            if (status === PLANET_STATUS.SWALLOWED) this.fallIn(place);
            this.server.publishState();
        }
        if (status === PLANET_STATUS.SAFE) return;
        if (status === PLANET_STATUS.SWALLOWED) this.dragStation(place);
        if (!place.zone.active) return;

        // The black hole's pull is the same for everybody, whoever holds the station: a share of the whole ship every second.
        const share = status === PLANET_STATUS.COLLAPSING ? BATTLE_ROYALE.collapse.collapsingDrain : 1 / BATTLE_ROYALE.collapse.swallowedSeconds;
        const { world } = place.zone;
        if (status === PLANET_STATUS.SWALLOWED) this.dragFleets(place, dt);
        for (const ship of world.ships) {
            if (!ship.alive || ship.arriving || isScenery(ship) || this.gravityShieldHolds(ship)) continue;
            drainShip(world, ship, share * (ship.maxHull + ship.maxShield) * dt);
        }
    }

    /**
     * A swallowed planet's station is dragged towards the black hole, faster and faster, and
     * after a while breaks up (BATTLE_ROYALE.collapse.show). Where it is depends on the clock
     * alone, so it is the same whether or not anybody was there to see it go.
     */
    dragStation(place) {
        if (place.stationFell) return;
        const { drag, stationBreaks } = BATTLE_ROYALE.collapse.show;
        const hull = place.station.ship;
        const gone = this.clock.secondsSinceSwallowed(place.orbit);
        if (gone < stationBreaks) {
            hull.position.copy(place.stationHome).addScaledVector(place.hole, 0.5 * drag.station * gone * gone);
            return;
        }
        place.stationFell = true;
        const { world } = place.zone;
        // Its wreck keeps falling the way it was going.
        hull.velocity.copy(place.hole).multiplyScalar(drag.station * stationBreaks);
        if (place.zone.active) destroyShip(world, hull, null, { shown: true });
        else world.removeShip(hull);
    }

    /**
     * Every computer-flown ship at a swallowed planet is dragged towards the black hole,
     * whatever its engines do, until the pull has drained it (it never takes long). Pilots'
     * ships are not moved: they fly as they did - what the hole does to them is the drain, and the picture.
     */
    dragFleets(place, dt) {
        const { drag, fills } = BATTLE_ROYALE.collapse.show;
        const gone = Math.min(fills, this.clock.secondsSinceSwallowed(place.orbit));
        for (const ship of place.zone.world.ships) {
            if (!ship.alive || ship.arriving || ship.isPlayer || ship.parent || isScenery(ship)) continue;
            ship.position.addScaledVector(place.hole, dragOf(ship, drag) * gone * dt);
        }
    }

    /** The pilots at a planet whose gravity shields are on, as player ids: on their ships none of the black hole's pull shows. */
    shieldedAt(place) {
        if (!place || place.status === PLANET_STATUS.SAFE) return [];
        const { time } = this.server;
        return [...this.contestants.values()]
            .filter((contestant) => contestant.alive && time < contestant.gravityShieldUntil && this.placeOf(contestant) === place)
            .map((contestant) => contestant.pilot.id);
    }

    /**
     * A planet has been swallowed: its station goes with it. Nobody holds it any more, whoever is
     * docked there is let go, and nobody comes back or is brought back there again.
     */
    fallIn(place) {
        for (const contestant of this.contestants.values()) {
            if (contestant.dock?.place === place) this.undock(contestant, DOCK_END.SWALLOWED);
        }
        place.owner = null;
        // Nobody is there to watch a deserted planet's ships die: they are simply gone.
        if (!place.zone.active) this.sweep(place);
    }

    /**
     * True while a pilot's gravity shield keeps the pull off their ship. One they carry comes on
     * here, the moment the pull would first have hurt.
     */
    gravityShieldHolds(ship) {
        const contestant = ship.isPlayer ? this.contestants.get(ship.pilotId) : null;
        if (!contestant || contestant.pilot.ship !== ship) return false;
        const { time } = this.server;
        if (time < contestant.gravityShieldUntil) return true;
        if (!contestant.inventory.use(EQUIPMENT.GRAVITY_SHIELD)) return false;
        contestant.gravityShieldUntil = time + BATTLE_ROYALE.equipment.gravityShieldSeconds;
        this.tellMode(contestant.pilot, BR_EVENT.EQUIPMENT_USED, { item: EQUIPMENT.GRAVITY_SHIELD });
        this.server.publishState();
        return true;
    }

    sweep(place) {
        const { world } = place.zone;
        for (const ship of [...world.ships]) {
            if (ship.alive && !isScenery(ship)) world.removeShip(ship);
        }
    }

    /**
     * True when a ship that came out at `place` now could not get away before the planet is
     * swallowed: a new ship's drive must charge (the short charge of a ship that has come back),
     * then spool, before it can jump. Nobody comes back at such a station, nor is brought back
     * there by taking it.
     */
    strands(place) {
        const left = this.clock.secondsToSwallowed(place.orbit);
        return left !== null && left <= this.respawnJumpCooldown + BATTLE_ROYALE.jump.spool;
    }

    // ---- Jumping between planets -------------------------------------------------------------

    /** Why a contestant cannot jump to `to` right now (JUMP_REFUSAL), or null if they can. */
    jumpRefusal(contestant, to) {
        const here = this.placeOf(contestant);
        if (!contestant.alive || !contestant.pilot.ship?.alive || !here) return JUMP_REFUSAL.NO_SHIP;
        if (contestant.jump) return JUMP_REFUSAL.SPOOLING;
        const orbits = this.map.distance(here.planet.id, to);
        if (orbits < 1 || orbits > this.jumpReach(contestant)) return JUMP_REFUSAL.NOT_ADJACENT;
        // The charge holds the drive, not an overdrive chip: with one aboard the pilot may go at once.
        if (this.server.time < contestant.jumpReadyAt && !contestant.inventory.has(EQUIPMENT.OVERDRIVE)) return JUMP_REFUSAL.CHARGING;
        if (this.isTrapped(contestant, here)) return JUMP_REFUSAL.TRAPPED;
        return null;
    }

    /**
     * True when a jump to `to` would be an overdrive jump, burning the chip: one across more than
     * the next orbit, or any jump while the drive is still charging.
     */
    isOverdriveJump(contestant, to) {
        return this.map.distance(this.placeOf(contestant).planet.id, to) > 1 || this.server.time < contestant.jumpReadyAt;
    }

    /**
     * True when the black hole holds a contestant's drive at `here`: a swallowed planet lets
     * nothing go, whoever held its station - unless the pilot's gravity shield is on, holding
     * the pull off while it lasts.
     */
    isTrapped(contestant, here) {
        return Boolean(here) && here.status === PLANET_STATUS.SWALLOWED && this.server.time >= contestant.gravityShieldUntil;
    }

    /**
     * Orbits a contestant's next jump can cross: one, or more with an overdrive chip aboard (which
     * also lets them jump while the drive is still charging).
     */
    jumpReach(contestant) {
        return contestant.inventory.has(EQUIPMENT.OVERDRIVE) ? BATTLE_ROYALE.equipment.overdriveReach : 1;
    }

    requestJump(contestant, to) {
        const refusal = typeof to === 'string' ? this.jumpRefusal(contestant, to) : JUMP_REFUSAL.NOT_ADJACENT;
        if (refusal) {
            this.tellMode(contestant.pilot, BR_EVENT.JUMP_REFUSED, { reason: refusal });
            return;
        }
        // Leaving is letting go of the station.
        this.undock(contestant, DOCK_END.RELEASED);
        // Only a jump further than the next orbit, or one before the drive has charged, burns the overdrive chip.
        const overdrive = this.isOverdriveJump(contestant, to);
        contestant.jump = { to, left: BATTLE_ROYALE.jump.spool, overdrive };
        this.tellMode(contestant.pilot, BR_EVENT.JUMP_SPOOL, { to, seconds: BATTLE_ROYALE.jump.spool });
        this.server.publishState();
    }

    updateJump(contestant, dt) {
        const { jump, pilot } = contestant;
        if (!jump) return;
        // Shot down while spooling up: the jump dies with the ship.
        if (!pilot.ship?.alive) {
            contestant.jump = null;
            return;
        }
        jump.left -= dt;
        if (jump.left > 0) return;

        const ship = pilot.ship;
        const carried = {
            hullFraction: ship.hullFraction,
            shieldFraction: ship.shieldFraction,
            energy: ship.energy,
            boost: ship.boost,
            powerMode: ship.powerMode,
            throttle: ship.throttle,
            weapons: ship.weapons.map((weapon) => ({ ammo: weapon.ammo, reloadTimer: weapon.reloadTimer })),
            // A jump does not recharge the ship's ability, and ends one that was running.
            abilityCooldown: ship.ability ? (ship.ability.active > 0 ? ship.ability.def.cooldown : ship.ability.cooldown) : 0,
            shieldDown: ship.shieldDown,
        };
        pilot.zone.world.removeShip(ship, { flash: true });
        contestant.jump = null;
        // An overdrive jump is the chip's, not the drive's: the drive's charge is left as it was,
        // ready or still charging. An ordinary jump spends it, and the minute starts again.
        if (jump.overdrive && contestant.inventory.use(EQUIPMENT.OVERDRIVE)) {
            this.tellMode(pilot, BR_EVENT.EQUIPMENT_USED, { item: EQUIPMENT.OVERDRIVE });
        } else {
            contestant.jumpReadyAt = this.server.time + this.jumpCooldown;
        }

        const arrived = this.launch(contestant, this.places.get(jump.to), { hullFraction: carried.hullFraction });
        arrived.shield = arrived.maxShield * carried.shieldFraction;
        arrived.energy = carried.energy;
        arrived.boost = carried.boost;
        arrived.powerMode = carried.powerMode;
        arrived.throttle = carried.throttle;
        arrived.weapons.forEach((weapon, index) => Object.assign(weapon, carried.weapons[index]));
        if (arrived.ability) arrived.ability.cooldown = carried.abilityCooldown;
        arrived.shieldDown = carried.shieldDown;
        this.tellMode(pilot, BR_EVENT.JUMPED, { to: jump.to });
        this.server.publishState();
    }

    // ---- Taking planets ----------------------------------------------------------------------

    /** Living contestants of a side that are at a planet. */
    membersAt(place, faction) {
        return [...this.contestants.values()].filter((contestant) => contestant.alive && !contestant.pilot.gone
            && contestant.faction === faction && contestant.pilot.zone === place.zone && contestant.pilot.ship?.alive);
    }

    /** Why a contestant cannot clamp on to the station where they are (DOCK_REFUSAL), or null if they can. */
    dockRefusal(contestant) {
        const here = this.placeOf(contestant);
        const ship = contestant.pilot.ship;
        if (!contestant.alive || !ship?.alive || ship.arriving || !here) return DOCK_REFUSAL.NO_SHIP;
        if (contestant.jump) return DOCK_REFUSAL.JUMPING;
        // The station has gone down with its planet.
        if (here.status === PLANET_STATUS.SWALLOWED) return DOCK_REFUSAL.SWALLOWED;
        if (here.owner === contestant.faction) return DOCK_REFUSAL.HELD;
        if (!here.station.inRange(ship.position)) return DOCK_REFUSAL.TOO_FAR;
        return null;
    }

    /** Seconds a ship must stay docked to take a planet's station: longer if another side holds it. */
    dockSeconds(place) {
        return place.owner ? BATTLE_ROYALE.station.heldSeconds : BATTLE_ROYALE.station.seconds;
    }

    /**
     * Clamps a contestant's ship on to the station. From here until the locks give - or the
     * pilot lets go - the ship neither flies nor fires; it can still be shot.
     */
    requestDock(contestant) {
        if (contestant.dock) return;
        const refusal = this.dockRefusal(contestant);
        if (refusal) {
            this.tellMode(contestant.pilot, BR_EVENT.DOCK_REFUSED, { reason: refusal });
            return;
        }
        const place = this.placeOf(contestant);
        const seconds = this.dockSeconds(place);
        contestant.dock = { place, left: seconds, seconds };
        contestant.pilot.helmHeld = true;
        this.tellMode(contestant.pilot, BR_EVENT.DOCKED, { seconds });
        // The side that holds the station hears its alarm wherever its pilots are.
        if (place.owner) this.tellSide(place.owner, BR_EVENT.STATION_ALARM, { planet: place.planet.id, faction: contestant.faction });
        this.server.publishState();
    }

    /** Lets a contestant's ship go from the station. `reason` (DOCK_END) is told to the pilot; null says nothing. */
    undock(contestant, reason = null) {
        if (!contestant.dock) return;
        contestant.dock = null;
        contestant.pilot.helmHeld = false;
        if (reason) this.tellMode(contestant.pilot, BR_EVENT.UNDOCKED, { reason });
        this.server.publishState();
    }

    updateDock(contestant, dt) {
        const { dock, pilot } = contestant;
        if (!dock) return;
        // Shot down at the dock: the locks have nothing left to hold.
        if (!pilot.ship?.alive) {
            this.undock(contestant);
            return;
        }
        dock.place.station.hold(pilot.ship, BATTLE_ROYALE.station.pull, dt);
        dock.left -= dt;
        if (dock.left <= 0) this.capture(dock.place, contestant.faction);
    }

    /** Tells every pilot of a side, wherever they are. */
    tellSide(faction, name, data) {
        for (const contestant of this.contestants.values()) {
            if (contestant.faction === faction && !contestant.pilot.gone) this.tellMode(contestant.pilot, name, data);
        }
    }

    /**
     * A side's ship has stayed docked long enough: the station, and the planet with it, is that
     * side's. Its pilots there are paid, and every pilot of the side who is down comes back here.
     */
    capture(place, faction) {
        const former = place.owner;
        place.owner = faction;
        // The station has changed hands: every clamp lets go, the winners' and the too-late alike.
        for (const contestant of this.contestants.values()) {
            if (contestant.dock?.place === place) this.undock(contestant, contestant.faction === faction ? null : DOCK_END.TAKEN);
        }
        place.zone.share(WORLD_EVENT.MODE, BR_EVENT.CAPTURED, { planet: place.planet.id, faction });
        if (former) this.tellSide(former, BR_EVENT.STATION_LOST, { planet: place.planet.id, faction });

        const members = this.membersAt(place, faction);
        for (const member of members) {
            member.score += BATTLE_ROYALE.capture.score;
            member.inventory.grant(BATTLE_ROYALE.capture.picks);
            this.tellMode(member.pilot, BR_EVENT.PICKS, { picks: member.inventory.picks });
        }
        this.reward(members);
        // Only those who were there are paid; the fallen are brought back after it (unless the side is out:
        // a pilot who turned pirate after the pirates were wiped out flies for nobody who can come back) -
        // but not to a planet that will be gone before a new ship could jump away: they wait for a better one.
        const revives = !this.outSides.has(faction) && !this.strands(place);
        for (const contestant of this.contestants.values()) {
            if (!revives || contestant.alive || contestant.pilot.gone || contestant.faction !== faction) continue;
            this.bringBack(contestant, place);
            this.tellMode(contestant.pilot, BR_EVENT.REVIVED, { planet: place.planet.id });
        }
        this.server.publishState();
    }

    /** Refit points and calls for reinforcements for the pilots who took a planet (pirates: more points, no calls). */
    reward(members) {
        for (const member of members) {
            const pirate = isPirate(member.faction);
            const points = pirate ? BATTLE_ROYALE.capture.piratePoints : BATTLE_ROYALE.capture.points;
            const summons = pirate ? 0 : BATTLE_ROYALE.capture.summons;
            member.points += points;
            member.summons += summons;
            this.tellMode(member.pilot, BR_EVENT.REWARD, { points, summons });
        }
    }

    // ---- Coming back -------------------------------------------------------------------------

    /** Seconds a pilot who has come back at a station `respawns` times so far must wait after being shot down. */
    respawnWait(respawns) {
        const { wait, waitStep } = BATTLE_ROYALE.respawn;
        return wait + waitStep * respawns;
    }

    /**
     * The planets whose stations a pilot's side holds and nobody is taking from it, and that will
     * stand long enough for a new ship to jump away again - where they may come back - the one
     * they would be sent to first: a planet that is not falling in, then the one with the most of
     * their side flying there, then the outermost (nearest the gate).
     */
    respawnStations(contestant) {
        const stations = [...this.places.values()].filter((place) => place.owner === contestant.faction && !this.beingTaken(place) && !this.strands(place));
        const settled = (place) => (place.status === PLANET_STATUS.SAFE ? 1 : 0);
        const company = new Map(stations.map((place) => [place, this.membersAt(place, contestant.faction).length]));
        return stations.sort((a, b) => settled(b) - settled(a) || company.get(b) - company.get(a) || b.orbit - a.orbit);
    }

    /**
     * True while another side's ship is docked at a held station, taking it. (A side never docks
     * at its own station, so any ship docked at a held one is taking it.)
     */
    beingTaken(place) {
        if (!place.owner) return false;
        for (const contestant of this.contestants.values()) {
            if (contestant.dock?.place === place) return true;
        }
        return false;
    }

    /**
     * The planets whose stations a side holds but another side is docked at, taking them: nobody
     * comes back there meanwhile. (Not those about to be swallowed: see `fallingStations`.)
     */
    contestedStations(faction) {
        return [...this.places.values()].filter((place) => place.owner === faction && !this.strands(place) && this.beingTaken(place));
    }

    /** The planets whose stations a side holds but that will be swallowed before a new ship could jump away: nobody comes back there. */
    fallingStations(faction) {
        return [...this.places.values()].filter((place) => place.owner === faction && this.strands(place));
    }

    /**
     * True while a side holds at least one station its pilots could come back to - now, or once
     * nobody is taking it from them. One about to be swallowed is no such station.
     */
    holdsStation(faction) {
        for (const place of this.places.values()) {
            if (place.owner === faction && !this.strands(place)) return true;
        }
        return false;
    }

    /** Why a pilot cannot come back at `place` right now (RESPAWN_REFUSAL), or null if they can. */
    respawnRefusal(contestant, place) {
        if (this.outSides.has(contestant.faction) && !contestant.alive) return RESPAWN_REFUSAL.OUT;
        if (contestant.alive || contestant.pilot.gone || contestant.respawnAt === null) return RESPAWN_REFUSAL.FLYING;
        if (this.server.time < contestant.respawnAt) return RESPAWN_REFUSAL.WAITING;
        if (!place || place.owner !== contestant.faction) return RESPAWN_REFUSAL.NOT_HELD;
        if (this.strands(place)) return RESPAWN_REFUSAL.FALLING;
        if (this.beingTaken(place)) return RESPAWN_REFUSAL.CONTESTED;
        return null;
    }

    /** A player asks to come back at the station of `to` (a planet id from their device: checked). */
    requestRespawn(contestant, to) {
        const place = typeof to === 'string' ? this.places.get(to) : null;
        const refusal = this.respawnRefusal(contestant, place ?? null);
        if (refusal) {
            this.tellMode(contestant.pilot, BR_EVENT.RESPAWN_REFUSED, { reason: refusal });
            return;
        }
        this.respawn(contestant, place);
    }

    /** Launches a pilot whose wait is over from their side's station at `place`; the next wait will be longer. */
    respawn(contestant, place) {
        contestant.respawns += 1;
        this.bringBack(contestant, place);
        this.tellMode(contestant.pilot, BR_EVENT.RESPAWNED, { planet: place.planet.id });
        this.server.publishState();
    }

    /**
     * A new ship for a pilot who is down, out of the departure hangar of the station at `place`,
     * throttle open, the helm theirs. The jump drive starts uncharged, but needs only the short
     * charge of a ship that has come back (BATTLE_ROYALE.respawn.jumpCooldown), not a full minute.
     */
    bringBack(contestant, place) {
        this.launch(contestant, place, { fromStation: true });
        contestant.jumpReadyAt = this.server.time + this.respawnJumpCooldown;
    }

    /**
     * A pilot who is down: once their wait is over and there is a station to come back to, the
     * clock to choose one starts; when it runs out they are sent to the first one offered at that
     * moment. Without one - their side holds none, every one is being taken or about to be swallowed - there is nowhere
     * to go and nothing to count down; the clock starts again when there is.
     */
    updateRespawn(contestant) {
        if (contestant.alive || contestant.pilot.gone || contestant.respawnAt === null) return;
        const { time } = this.server;
        if (time < contestant.respawnAt) return;
        const [first] = this.holdsStation(contestant.faction) ? this.respawnStations(contestant) : [];
        if (!first) {
            if (contestant.chooseUntil !== null) {
                contestant.chooseUntil = null;
                this.server.publishState();
            }
            return;
        }
        if (contestant.chooseUntil === null) {
            contestant.chooseUntil = time + BATTLE_ROYALE.respawn.choose;
            this.server.publishState();
        } else if (time >= contestant.chooseUntil) {
            this.respawn(contestant, first);
        }
    }

    // ---- Watching a comrade fly -------------------------------------------------------------

    /**
     * True when `viewer` (down) may watch `target` fly: a comrade with a ship in the air - or,
     * once the viewer's side is out and there is nobody of theirs left to tell, anybody's.
     */
    mayWatch(viewer, target) {
        return Boolean(target) && target !== viewer && target.alive && !target.pilot.gone && Boolean(target.pilot.ship?.alive) && Boolean(target.pilot.zone)
            && (target.faction === viewer.faction || this.outSides.has(viewer.faction));
    }

    /** The pilots a viewer may watch, in a steady order: their own side's first (as the team is listed), then by name. */
    watchable(viewer) {
        return [...this.contestants.values()].filter((target) => this.mayWatch(viewer, target))
            .sort((a, b) => (a.faction === viewer.faction ? 0 : 1) - (b.faction === viewer.faction ? 0 : 1) || a.pilot.name.localeCompare(b.pilot.name));
    }

    /**
     * A player who is down asks to watch a pilot fly (`id`, from their device: checked), or to
     * stop (null). Watching moves the place they are told about to the watched pilot's - their
     * device is sent that place whole, and then its snapshots like anybody's there - so it is
     * the same live picture, a moment behind, as everybody there has.
     */
    requestWatch(contestant, id) {
        if (contestant.alive || contestant.pilot.gone || contestant.pilot.bot) return;
        if (id === null) {
            if (contestant.watching === null) return;
            contestant.watching = null;
            this.server.publishState();
            return;
        }
        const target = typeof id === 'string' ? this.contestants.get(id) : null;
        if (!this.mayWatch(contestant, target)) return;
        contestant.watching = target.pilot.id;
        this.server.moveToZone(contestant.pilot, target.pilot.zone);
        this.server.publishState();
    }

    /**
     * Keeps a watcher with the pilot they watch: on to the next planet when that pilot jumps,
     * and on to another one they may watch when that pilot is shot down (or to nobody, staying
     * where they are, if there is none).
     */
    updateWatching(contestant) {
        if (contestant.watching === null) return;
        const target = this.contestants.get(contestant.watching);
        if (contestant.alive || contestant.pilot.gone) {
            contestant.watching = null;
            return;
        }
        if (!this.mayWatch(contestant, target)) {
            const [next] = this.watchable(contestant);
            contestant.watching = next ? next.pilot.id : null;
            if (next) this.server.moveToZone(contestant.pilot, next.pilot.zone);
            this.server.publishState();
            return;
        }
        if (target.pilot.zone !== contestant.pilot.zone) this.server.moveToZone(contestant.pilot, target.pilot.zone);
    }

    /** The pilot a player who is down is watching fly (MatchServer sends their device that ship's instruments), or null. */
    watchedPilot(pilot) {
        const viewer = this.contestants.get(pilot.id);
        const target = viewer && !viewer.alive && viewer.watching !== null ? this.contestants.get(viewer.watching) : null;
        return target && this.mayWatch(viewer, target) ? target.pilot : null;
    }

    // ---- What players ask for ----------------------------------------------------------------

    /** `data` comes straight from a player's device: every field is checked before it is used. */
    onRequest(pilot, name, data) {
        const contestant = this.contestants.get(pilot.id);
        if (!contestant || this.result) return;
        // Equipment can be chosen at any time - before the ships are even in the system.
        if (name === BR_REQUEST.PICK) {
            this.pickEquipment(contestant, data.item);
            return;
        }
        if (this.introLeft > 0) {
            // Nothing else can be asked for while the story is told - but not to be told it.
            if (name === BR_REQUEST.SKIP_INTRO) this.skipIntro(pilot);
            return;
        }
        switch (name) {
            case BR_REQUEST.JUMP: this.requestJump(contestant, data.to); break;
            case BR_REQUEST.REFIT: this.spendPoints(contestant, data.added); break;
            case BR_REQUEST.SUMMON: this.summon(contestant); break;
            case BR_REQUEST.RESPAWN: this.requestRespawn(contestant, data.at); break;
            case BR_REQUEST.WATCH: this.requestWatch(contestant, data.id); break;
            case BR_REQUEST.DOCK: this.requestDock(contestant); break;
            case BR_REQUEST.UNDOCK: this.undock(contestant, DOCK_END.RELEASED); break;
            case BR_REQUEST.BEACON: this.launchBeacon(contestant, data.to); break;
            default:
        }
    }

    // ---- Equipment ---------------------------------------------------------------------------

    /** Spends one of a contestant's choices on a piece of equipment. */
    pickEquipment(contestant, item) {
        if (!contestant.inventory.pick(item)) return;
        this.armEmergencyShield(contestant);
        this.server.publishState();
    }

    /**
     * Sends a beacon to a planet next to the one the contestant is at. From then on their side
     * - the pirates are one too - is shown what stands there and who holds it.
     */
    launchBeacon(contestant, to) {
        const here = this.placeOf(contestant);
        if (!contestant.alive || !contestant.pilot.ship?.alive || !here) return;
        if (typeof to !== 'string' || !this.map.areNeighbours(here.planet.id, to)) return;
        const target = this.places.get(to);
        // Nothing is spent on a planet that is watched already.
        if (target.scouts.has(contestant.faction) || !contestant.inventory.use(EQUIPMENT.BEACON)) return;
        target.scouts.add(contestant.faction);
        this.tellMode(contestant.pilot, BR_EVENT.BEACON_SET, { planet: to });
        this.server.publishState();
    }

    /**
     * The emergency shield is a floor under the hull: while a pilot carries one, or one is
     * on, no hit takes their ship below a sliver.
     */
    armEmergencyShield(contestant) {
        const ship = contestant.pilot.ship;
        if (!ship?.alive) return;
        const armed = this.server.time < contestant.emergencyShieldUntil || contestant.inventory.has(EQUIPMENT.EMERGENCY_SHIELD);
        ship.minHull = armed ? ship.maxHull * BATTLE_ROYALE.equipment.emergencyHull : 0;
    }

    /**
     * A hit that has just put the hull on that floor would have killed: the shield a pilot
     * carries comes on. While it is on the hull holds, and nothing mends.
     */
    updateEmergencyShield(contestant) {
        const { pilot } = contestant;
        const ship = pilot.ship;
        if (!ship?.alive) return;
        const { time } = this.server;
        const hurt = ship.lastDamagedAt !== contestant.seenDamageAt;
        contestant.seenDamageAt = ship.lastDamagedAt;
        if (time >= contestant.emergencyShieldUntil && ship.minHull > 0 && ship.hull <= ship.minHull && hurt
            && contestant.inventory.use(EQUIPMENT.EMERGENCY_SHIELD)) {
            contestant.emergencyShieldUntil = time + BATTLE_ROYALE.equipment.emergencyShieldSeconds;
            this.tellMode(pilot, BR_EVENT.EQUIPMENT_USED, { item: EQUIPMENT.EMERGENCY_SHIELD });
            this.server.publishState();
        }
        if (time < contestant.emergencyShieldUntil) ship.shieldCooldown = Math.max(ship.shieldCooldown, 1);
        this.armEmergencyShield(contestant);
    }

    /** Spends refit points on the ship's ratings: never more than the pilot has, never past a rating's cap. */
    spendPoints(contestant, added) {
        const { pilot } = contestant;
        if (!contestant.alive || contestant.points <= 0) return;
        const wanted = cleanUpgrades(added);
        const allowed = {};
        let budget = contestant.points;
        for (const rating of RATING_ORDER) {
            const take = Math.min(wanted[rating] ?? 0, budget);
            if (take > 0) allowed[rating] = take;
            budget -= take;
        }
        const merged = mergeUpgrades(pilot.classId, pilot.upgrades, allowed);
        const spent = sumLevels(merged) - sumLevels(pilot.upgrades);
        if (spent <= 0) return;
        contestant.points -= spent;
        this.server.refitPilot(pilot, merged);
        this.server.publishState();
    }

    summon(contestant) {
        const { pilot } = contestant;
        const classId = BATTLE_ROYALE.summon.ships[contestant.faction];
        if (contestant.summons <= 0 || !pilot.ship?.alive || !classId) return;
        contestant.summons -= 1;
        this.squadSerial += 1;
        const id = this.squadSerial;
        // They drop out of warp in front of the caller, where its pilot sees them come.
        const ships = callReinforcements(pilot.zone, pilot.ship, classId, BATTLE_ROYALE.summon, [squadTag(id)]);
        // They stay with the fight they were called into for a while; after that they go where the side needs them.
        const { time } = this.server;
        this.squads.push(new Squad({
            id, faction: contestant.faction, ships, place: this.placeOf(contestant),
            readyAt: time + this.jumpCooldown, committedUntil: time + BATTLE_ROYALE.strategy.summonCommit,
        }));
        this.server.publishState();
    }

    // ---- Where the computer-flown units go (strategy.js) -------------------------------------

    /** A side's war council (made the first time it is asked for: each side plans on its own beat). */
    councilOf(faction) {
        let council = this.councils.get(faction);
        if (!council) {
            const beat = BATTLE_ROYALE.strategy.planInterval;
            council = new WarCouncil(this, faction, ((this.councils.size + 1) * beat) / (PLAYER_FACTIONS.length + 1));
            this.councils.set(faction, council);
        }
        return council;
    }

    /** A side's units that take orders: its bots in the air, and its reinforcements. */
    unitsOf(faction) {
        const units = this.bots.filter((bot) => bot.contestant.faction === faction && bot.flying);
        for (const squad of this.squads) {
            if (squad.faction === faction && squad.alive) units.push(squad);
        }
        return units;
    }

    /**
     * True when a side has eyes on a planet: a pilot of theirs there, the station theirs, or
     * a beacon of theirs. (What a side's players are shown of a planet follows the same rule: describePlace.)
     */
    sideSees(place, faction) {
        return place.owner === faction || place.scouts.has(faction) || this.membersAt(place, faction).length > 0;
    }

    // ---- What happens to ships ---------------------------------------------------------------

    onDamage(zone, target, source, amount) {
        // Only a player turning their guns on their own side's computer-flown ships is counted.
        if (!source.isPlayer || target.isPlayer || target.faction !== source.faction || isPirate(source.faction)) return;
        const contestant = this.contestants.get(source.pilotId);
        if (!contestant || contestant.pilot.ship !== source) return;
        const crossed = contestant.loyalty.addDamage(amount);
        if (crossed === LOYALTY.WARNED) {
            this.tellMode(contestant.pilot, BR_EVENT.WARNING, { faction: source.faction });
            this.server.publishState();
        } else if (crossed === LOYALTY.TRAITOR) {
            this.brandPirate(contestant, zone);
        }
    }

    /** A traitor flies with the pirates from here on: both fleets' guns, their old side's included, are free to fire. */
    brandPirate(contestant, zone) {
        const former = contestant.faction;
        contestant.faction = FACTION.PIRATE;
        contestant.summons = 0;
        if (contestant.pilot.ship?.alive) this.server.setShipFaction(zone, contestant.pilot.ship, FACTION.PIRATE);
        this.tellMode(contestant.pilot, BR_EVENT.BRANDED, { former });
        this.server.publishState();
    }

    onShipDestroyed(zone, ship, killer, weapon = null) {
        const scorer = killer?.isPlayer ? this.contestants.get(killer.pilotId) : null;
        const victim = ship.isPlayer ? this.contestants.get(ship.pilotId) : null;
        const place = this.places.get(zone.id);
        this.reportKill(place, ship, killer, weapon);
        // A pilot or a reinforcement lost is a sign of trouble there, for the side's war council.
        if (place && (victim || squadIdOf(ship) !== null)) this.councilOf(victim?.faction ?? ship.faction).noteLoss(place, shipStrength(ship));
        if (victim) {
            victim.alive = false;
            victim.deaths += 1;
            // (A pilot of a side that is already out - one who turned pirate after the pirates were - does not come back.)
            victim.respawnAt = this.outSides.has(victim.faction) ? null : this.server.time + this.respawnWait(victim.respawns);
            victim.chooseUntil = null;
            victim.jump = null;
            victim.gravityShieldUntil = 0;
            victim.emergencyShieldUntil = 0;
            this.undock(victim);
            // A person stays to watch their wreck; a bot has nothing to watch with, and the
            // place need not be kept running for it.
            if (victim.pilot.bot) this.server.leaveZone(victim.pilot);
        }
        if (scorer && scorer !== victim) {
            const points = victim ? BATTLE_ROYALE.score.playerKill : BATTLE_ROYALE.score.ships[ship.classId] ?? 0;
            scorer.kills += 1;
            scorer.score += points;
            if (points > 0) scorer.pilot.tell(WORLD_EVENT.SCORE, points, ship.classId, scorer.score);
        }
        this.server.publishState();
    }

    /**
     * Every device's message feed hears of a ship shot down, whoever shot it and wherever in
     * the system (net/match/feed.js) - but not where: that is still for a side's own eyes to
     * find out. A pilot nobody shot down was taken by the black hole if the planet was falling
     * in, and flew into something otherwise.
     */
    reportKill(place, ship, killer, weapon) {
        const cause = place && place.status !== PLANET_STATUS.SAFE ? KILL_CAUSE.COLLAPSE : KILL_CAUSE.CRASH;
        const kill = describeKill(ship, killer, { weapon, cause });
        if (kill) this.server.announce(FEED_TYPE.KILL, kill);
    }

    onPlayerLeft(pilot) {
        const contestant = this.contestants.get(pilot.id);
        if (!contestant) return;
        contestant.alive = false;
        contestant.respawnAt = null;
        contestant.chooseUntil = null;
        contestant.watching = null;
        contestant.jump = null;
        this.undock(contestant);
        // Whoever was still watching the story is no longer waited for.
        this.checkIntroSkips();
    }

    // ---- The introduction --------------------------------------------------------------------

    /** The players the introduction is told to: every one with a device behind them who is still in the match. */
    introAudience() {
        return [...this.server.pilots.values()].filter((pilot) => !pilot.bot && !pilot.gone);
    }

    /** A player would rather not watch the introduction. It goes on for the others - until nobody is left watching. */
    skipIntro(pilot) {
        if (this.introLeft <= 0 || pilot.bot || pilot.gone || this.introSkips.has(pilot.id)) return;
        this.introSkips.add(pilot.id);
        this.checkIntroSkips();
        // (Entering the system has told everybody already.)
        if (this.introLeft > 0) this.server.publishState();
    }

    /**
     * Ends the introduction at once when every player has asked to skip it: everybody enters
     * the system at this same moment, as they would have when its seconds ran out.
     */
    checkIntroSkips() {
        if (this.introLeft <= 0 || this.introSkips.size === 0) return;
        if (this.introAudience().every((pilot) => this.introSkips.has(pilot.id))) this.enterSystem();
    }

    /** How the skipping of the introduction stands, for one player: how many have asked of how many, and whether they have. Null once it is over. */
    describeSkips(pilot) {
        if (this.introLeft <= 0) return null;
        const audience = this.introAudience();
        return { voted: audience.filter((other) => this.introSkips.has(other.id)).length, voters: audience.length, you: this.introSkips.has(pilot.id) };
    }

    // ---- Winning -----------------------------------------------------------------------------

    /** Sides that still have a pilot flying. */
    standingSides() {
        const sides = new Set();
        for (const contestant of this.contestants.values()) {
            if (contestant.alive && !contestant.pilot.gone) sides.add(contestant.faction);
        }
        return sides;
    }

    /**
     * A side whose pilots - those still in the match, bots included - are all down at the same
     * moment is out: none of them comes back, by choice or by a capture, and every station it
     * holds is nobody's again at once. Waiting, choosing or with nowhere to
     * go makes no difference; nor does a station of its being taken or not.
     */
    checkEliminations() {
        if (this.introLeft > 0) return;
        for (const faction of this.sidesAtStart) {
            if (this.outSides.has(faction)) continue;
            const flying = [...this.contestants.values()].some((contestant) => contestant.faction === faction && contestant.alive && !contestant.pilot.gone);
            if (!flying) this.eliminate(faction);
        }
    }

    eliminate(faction) {
        this.outSides.add(faction);
        for (const contestant of this.contestants.values()) {
            if (contestant.faction !== faction || contestant.alive) continue;
            contestant.respawnAt = null;
            contestant.chooseUntil = null;
        }
        for (const place of this.places.values()) {
            if (place.owner === faction) place.owner = null;
        }
        for (const contestant of this.contestants.values()) {
            if (!contestant.pilot.gone) this.tellMode(contestant.pilot, BR_EVENT.SIDE_OUT, { faction });
        }
        this.server.publishState();
    }

    checkVictory() {
        if (this.result) return;
        const standing = this.standingSides();
        if (standing.size === 0) this.finish(null);
        else if (standing.size === 1 && this.sidesAtStart.size > 1) this.finish([...standing][0]);
        else if (this.clock.finalStandLeft === 0) this.finish(this.holderOfGate() ?? this.strongestAtGate());
    }

    /** The side that holds the stargate's station, if it still has a pilot flying (one waiting to come back holds nothing). */
    holderOfGate() {
        const { owner } = this.places.get(this.map.gate.id);
        return owner && this.standingSides().has(owner) ? owner : null;
    }

    /** When the last stand runs out and nobody holds the stargate: the side with the most ships at it, then the best score. */
    strongestAtGate() {
        const gate = this.places.get(this.map.gate.id);
        let best = null;
        for (const faction of PLAYER_FACTIONS) {
            const members = this.membersAt(gate, faction);
            if (members.length === 0) continue;
            const entry = { faction, ships: members.length, score: members.reduce((sum, member) => sum + member.score, 0) };
            if (!best || entry.ships > best.ships || (entry.ships === best.ships && entry.score > best.score)) best = entry;
        }
        return best?.faction ?? null;
    }

    finish(winner) {
        if (this.result) return;
        this.result = { winner };
        this.server.publishState();
    }

    // ---- What each player is told ------------------------------------------------------------

    describeState(pilot) {
        const you = this.contestants.get(pilot.id);
        const { time } = this.server;
        const here = you ? this.placeOf(you) : null;
        return {
            mode: 'battleRoyale',
            matchId: this.info.matchId,
            phase: this.result ? MATCH_PHASE.OVER : MATCH_PHASE.PLAYING,
            winner: this.result?.winner ?? null,
            time: Math.round(time),
            // The collapse clock, to a hundredth: what every device times the planets' falls by (planetFall.js).
            clock: this.introLeft > 0 ? null : Math.round(this.clock.time * 100) / 100,
            intro: this.introLeft > 0 ? Math.ceil(this.introLeft) : null,
            skip: this.describeSkips(pilot),
            finalStand: this.clock.finalStandLeft === null ? null : Math.ceil(this.clock.finalStandLeft),
            out: [...this.outSides],
            you: you && {
                faction: you.faction,
                planet: here?.planet.id ?? null,
                alive: you.alive,
                points: you.points,
                summons: you.summons,
                upgrades: pilot.upgrades,
                loyalty: you.loyalty.status,
                jump: this.describeJump(you, here),
                dock: this.describeDock(you, here),
                picks: you.inventory.picks,
                equipment: you.inventory.describe(),
                effects: this.describeEffects(you),
                shielded: this.shieldedAt(here),
                respawn: this.describeRespawn(you),
                out: this.outSides.has(you.faction),
                watching: you.watching,
                watched: this.describeWatched(you),
                team: this.describeTeam(you),
            },
            planets: [...this.places.values()].map((place) => this.describePlace(place, you)),
            players: [...this.contestants.values()].filter((contestant) => !contestant.pilot.gone).map((contestant) => ({
                id: contestant.pilot.id,
                name: contestant.pilot.name,
                classId: contestant.pilot.classId,
                bot: contestant.pilot.bot,
                faction: contestant.faction,
                alive: contestant.alive,
                score: contestant.score,
                kills: contestant.kills,
                deaths: contestant.deaths,
            })),
        };
    }

    /**
     * Coming back, as a pilot who is down sees it: how long they still wait, the stations they
     * may choose from (the first is where they are sent if they do not choose), those of their
     * side's that are being taken (not to be chosen meanwhile) or about to be swallowed (not to
     * be chosen at all), and how long they have to choose. Null while they fly.
     */
    describeRespawn(you) {
        if (you.alive || you.respawnAt === null) return null;
        const { time } = this.server;
        return {
            wait: Math.max(0, Math.ceil(you.respawnAt - time)),
            stations: this.respawnStations(you).map((place) => place.planet.id),
            contested: this.contestedStations(you.faction).map((place) => place.planet.id),
            falling: this.fallingStations(you.faction).map((place) => place.planet.id),
            choose: you.chooseUntil === null ? null : Math.max(0, Math.ceil(you.chooseUntil - time)),
            next: this.respawnWait(you.respawns + 1),
        };
    }

    /**
     * The pilot a player who is down is watching, as the HUD shows them in place of the player's
     * own ship (the ship's own instruments come with the snapshots: MatchServer.watchedShipOf):
     * where they fly, their jump drive, a docking in progress, the refits on their ship and the
     * equipment they carry. Null while the player flies or watches nobody.
     */
    describeWatched(you) {
        const target = !you.alive && you.watching !== null ? this.contestants.get(you.watching) : null;
        if (!target || !this.mayWatch(you, target)) return null;
        const here = this.placeOf(target);
        return {
            id: target.pilot.id,
            planet: here?.planet.id ?? null,
            upgrades: target.pilot.upgrades,
            jump: this.describeJump(target, here),
            dock: target.dock ? { left: Math.max(0, target.dock.left), seconds: target.dock.seconds } : null,
            equipment: target.inventory.describe(),
            effects: this.describeEffects(target),
        };
    }

    /** A contestant's jump drive, as their HUD shows it: seconds until it is charged, the jump in progress, whether they are stuck, how far it reaches. */
    describeJump(contestant, here) {
        return {
            cooldown: Math.max(0, Math.ceil(contestant.jumpReadyAt - this.server.time)),
            to: contestant.jump?.to ?? null,
            spool: contestant.jump ? Math.max(0, contestant.jump.left) : null,
            trapped: this.isTrapped(contestant, here),
            reach: this.jumpReach(contestant),
        };
    }

    /** Seconds each piece of a contestant's equipment that switches itself on is still on (0: off). */
    describeEffects(contestant) {
        const { time } = this.server;
        return {
            gravityShield: Math.max(0, Math.ceil(contestant.gravityShieldUntil - time)),
            emergencyShield: Math.max(0, Math.ceil(contestant.emergencyShieldUntil - time)),
        };
    }

    /**
     * The player's comrades as their HUD lists them, wherever they are: their ship, where they
     * are, how it stands with their hull and shield (percent) or a docking - or, while they are
     * down, the seconds until they may come back (0: they may; null: they cannot).
     */
    describeTeam(you) {
        const { time } = this.server;
        return [...this.contestants.values()].filter((other) => other !== you && other.faction === you.faction && !other.pilot.gone).map((other) => {
            const ship = other.alive ? other.pilot.ship : null;
            return {
                id: other.pilot.id,
                name: other.pilot.name,
                classId: other.pilot.classId,
                bot: other.pilot.bot,
                planet: other.alive ? this.placeOf(other)?.planet.id ?? null : null,
                alive: other.alive,
                hull: ship ? Math.round(ship.hullFraction * 100) : 0,
                shield: ship ? Math.round(ship.shieldFraction * 100) : 0,
                docking: Boolean(other.dock),
                wait: other.alive || other.respawnAt === null ? null : Math.max(0, Math.ceil(other.respawnAt - time)),
            };
        });
    }

    /** The station where a contestant is, as their HUD shows it: can they clamp on, and how far along they are. */
    describeDock(you, here) {
        if (!here || !you.alive) return null;
        return {
            ready: !you.dock && this.dockRefusal(you) === null,
            left: you.dock ? Math.max(0, you.dock.left) : null,
            seconds: you.dock ? you.dock.seconds : this.dockSeconds(here),
        };
    }

    /**
     * A planet as the map shows it. How the collapse stands is known to all. What is there - ships,
     * the station's holder, a docking in progress - is known only to a side that has eyes on
     * it: a pilot there, the station if the side holds it, or a beacon.
     */
    describePlace(place, you) {
        const wait = this.clock.secondsToChange(place.orbit);
        const timetable = this.clock.timetableOf(place.orbit);
        // The pirates are a side like the others in this: they only differ in being free to shoot each other.
        const comrades = you ? this.membersAt(place, you.faction).filter((member) => member !== you).map((member) => member.pilot.name) : [];
        const beacon = Boolean(you) && place.scouts.has(you.faction);
        const known = Boolean(you) && (this.placeOf(you) === place || comrades.length > 0 || place.owner === you.faction || beacon);
        const description = {
            id: place.planet.id,
            status: place.status,
            changesIn: wait === null ? null : Math.ceil(wait),
            fallsAt: timetable?.fallsAt ?? null,
            goneAt: timetable?.goneAt ?? null,
            known,
            beacon,
            owner: null,
            forces: null,
            docking: null,
            comrades,
        };
        if (!known) return description;

        const forces = Object.fromEntries(PLAYER_FACTIONS.map((faction) => [faction, 0]));
        for (const ship of place.zone.world.ships) {
            if (ship.alive && ship.faction in forces) forces[ship.faction] += 1;
        }
        const docked = [...this.contestants.values()].find((contestant) => contestant.dock?.place === place);
        return { ...description, owner: place.owner, forces, docking: docked?.faction ?? null };
    }
}
