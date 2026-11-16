import { Vector3 } from 'three';
import { BATTLE_ROYALE, NPC_FACTIONS, PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { RATING_ORDER } from '../../config/playerShips.js';
import { SECTORS } from '../../config/sectors.js';
import { createRng, randomUnitVector } from '../../core/math.js';
import { mergeUpgrades } from '../../core/refit.js';
import { drainShip } from '../../core/systems/damage.js';
import { cleanUpgrades } from '../../net/match/matchInfo.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { WORLD_EVENT } from '../../net/protocol.js';
import { LOYALTY, LoyaltyRecord, dealFactions, isPirate } from './allegiance.js';
import { BR_EVENT, BR_REQUEST, DOCK_END, DOCK_REFUSAL, JUMP_REFUSAL, VOTE } from './battleRoyaleProtocol.js';
import { CollapseClock, PLANET_STATUS } from './collapse.js';
import { EQUIPMENT, Inventory } from './equipment.js';
import { callReinforcements, planGarrisons, stationGarrison } from './garrisons.js';
import { StarMap } from './starMap.js';
import { buildStation } from './station.js';

const scratchOffset = new Vector3();
const sumLevels = (upgrades) => Object.values(upgrades).reduce((sum, levels) => sum + levels, 0);

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
        /** The jump being spooled up: { to, left }, or null. */
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
    }
}

/** What the rules know about one planet. */
class Place {
    constructor(planet, orbit, zone, station) {
        this.planet = planet;
        this.orbit = orbit;
        this.zone = zone;
        /** The planet's station (station.js): who docks at it long enough holds the planet. */
        this.station = station;
        /** The side that holds the station - its anti-gravity bubble covers the planet - or null. */
        this.owner = null;
        /** The sides whose beacons watch the planet: what one pilot's beacon sees, their whole side sees. */
        this.scouts = new Set();
        /** The choice a side is making after taking the planet: { faction, endsAt, ballots: Map<pilotId, choice | null> }. */
        this.vote = null;
        this.status = PLANET_STATUS.SAFE;
    }
}

/**
 * The rules of the battle royale (the "rules" half of a game mode, see modes/index.js).
 *
 * A star system whose sun is collapsing: planets are swallowed one by one from the inside,
 * and three sides - the Federation, the Umbra and the pirates - fight their way outwards to
 * the stargate on the last one. Players are dealt into the sides at random; every planet has
 * a station, guarded by the Federation's or the Umbra's computer-flown garrison or fought
 * over by both. A side takes a planet by docking a ship at its station - and loses it the
 * same way.
 *
 * Tuning is in config/battleRoyale.js. The pieces: StarMap (who can jump where), CollapseClock
 * (what falls in when), allegiance (sides and treason), station (the docks), garrisons (the
 * computer-flown ships), equipment (what pilots carry).
 */
export class BattleRoyaleMode {
    /**
     * @param {object} info the match as normalizeMatchInfo returns it. `settings.pace` picks its
     *        length; `settings.intro = 'skip'` starts without the introduction (tests, mostly).
     */
    constructor(info) {
        this.info = info;
        this.pace = BATTLE_ROYALE.paces[info.settings.pace] ?? BATTLE_ROYALE.paces[BATTLE_ROYALE.defaultPace];
        /** Seconds of introduction left; nobody is in the system until it reaches zero. */
        this.introLeft = info.settings.intro === 'skip' ? 0 : BATTLE_ROYALE.intro.seconds;
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
    }

    get jumpCooldown() {
        return BATTLE_ROYALE.jump.cooldown * this.pace.timeScale;
    }

    // ---- Setting up --------------------------------------------------------------------------

    setup(server) {
        this.server = server;
        const { map, rng } = this;
        this.clock = new CollapseClock({ planets: map.count, rng, timing: BATTLE_ROYALE.collapse, timeScale: this.pace.timeScale });

        const garrisons = planGarrisons(map.planets, NPC_FACTIONS, rng);
        map.planets.forEach((planet, orbit) => {
            const zone = server.addZone(planet.id, planet.sectorId, {
                seed: Math.floor(rng() * 0xffffffff), difficulty: BATTLE_ROYALE.difficulty, friendlyFire: BATTLE_ROYALE.friendlyFire,
            });
            const station = buildStation(zone, BATTLE_ROYALE.station, Boolean(planet.gate));
            this.places.set(planet.id, new Place(planet, orbit, zone, station));
            const sidesHere = garrisons.get(planet.id);
            for (const faction of sidesHere) {
                const ships = planet.gate ? BATTLE_ROYALE.garrisons.gate[faction] : BATTLE_ROYALE.garrisons[faction];
                stationGarrison(zone, station, faction, ships, BATTLE_ROYALE.garrisons, sidesHere.length === 1);
            }
        });

        const sides = dealFactions([...server.pilots.keys()], PLAYER_FACTIONS, rng);
        const startOf = new Map();
        for (const pilot of server.pilots.values()) {
            const faction = sides.get(pilot.id);
            const contestant = new Contestant(pilot, faction);
            this.contestants.set(pilot.id, contestant);
            this.sidesAtStart.add(faction);
            // A side starts together, the pirates like the rest.
            if (!startOf.has(faction)) startOf.set(faction, this.pickStart(faction, garrisons, new Set(startOf.values())));
            contestant.start = startOf.get(faction);
        }
        if (this.introLeft <= 0) this.enterSystem({ warpIn: false });
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

    /** Puts a contestant in a (new) ship at a planet, scattered around the far end of its station's approach lane. */
    launch(contestant, place, { warpIn = true, hullFraction = 1 } = {}) {
        const start = SECTORS[place.zone.sectorId].playerStart;
        randomUnitVector(this.rng, scratchOffset);
        scratchOffset.y *= 0.3;
        const position = new Vector3().fromArray(start.position).addScaledVector(scratchOffset, BATTLE_ROYALE.jump.scatter * (0.3 + this.rng() * 0.7));
        contestant.alive = true;
        const ship = this.server.spawnPilotShip(contestant.pilot, place.zone, {
            faction: contestant.faction, position, facing: start.facing, warpIn, hullFraction,
        });
        // Engines idle: a pilot who is still reading the map does not drift into the garrison.
        ship.throttle = 0;
        contestant.seenDamageAt = ship.lastDamagedAt;
        this.armEmergencyShield(contestant);
        return ship;
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

        for (const place of this.places.values()) this.updateCollapse(place, dt);
        for (const contestant of this.contestants.values()) {
            contestant.loyalty.update(dt);
            this.updateJump(contestant, dt);
            this.updateDock(contestant, dt);
            this.updateEmergencyShield(contestant);
        }
        for (const place of this.places.values()) {
            if (place.vote && time >= place.vote.endsAt) this.resolveVote(place);
        }
        this.checkVictory();
    }

    // ---- The collapse ------------------------------------------------------------------------

    updateCollapse(place, dt) {
        const status = this.clock.statusOf(place.orbit);
        if (status !== place.status) {
            place.status = status;
            for (const pilot of this.server.pilots.values()) this.tellMode(pilot, BR_EVENT.COLLAPSE, { planet: place.planet.id, status });
            // Nobody is there to watch a deserted planet's garrison die: it is simply gone.
            if (status === PLANET_STATUS.SWALLOWED && !place.zone.active) this.sweep(place);
            this.server.publishState();
        }
        if (status === PLANET_STATUS.SAFE || !place.zone.active) return;

        // The black hole's pull is the same for everybody: a share of the whole ship every second.
        const share = status === PLANET_STATUS.COLLAPSING ? BATTLE_ROYALE.collapse.collapsingDrain : 1 / BATTLE_ROYALE.collapse.swallowedSeconds;
        const { world } = place.zone;
        for (const ship of world.ships) {
            if (!ship.alive || ship.arriving || this.isShielded(place, ship) || this.gravityShieldHolds(ship)) continue;
            drainShip(world, ship, share * (ship.maxHull + ship.maxShield) * dt);
        }
    }

    /** True for ships the black hole cannot touch here: scenery, and the side whose bubble covers the planet. */
    isShielded(place, ship) {
        return ship.invulnerable || ship.faction === FACTION.NEUTRAL || ship.faction === place.owner;
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
            if (ship.alive && !this.isShielded(place, ship)) world.removeShip(ship);
        }
    }

    // ---- Jumping between planets -------------------------------------------------------------

    /** Why a contestant cannot jump to `to` right now (JUMP_REFUSAL), or null if they can. */
    jumpRefusal(contestant, to) {
        const here = this.placeOf(contestant);
        if (!contestant.alive || !contestant.pilot.ship?.alive || !here) return JUMP_REFUSAL.NO_SHIP;
        if (contestant.jump) return JUMP_REFUSAL.SPOOLING;
        const orbits = this.map.distance(here.planet.id, to);
        if (orbits < 1 || orbits > this.jumpReach(contestant)) return JUMP_REFUSAL.NOT_ADJACENT;
        if (this.server.time < contestant.jumpReadyAt) return JUMP_REFUSAL.CHARGING;
        // A swallowed planet lets nothing go - except the side whose bubble holds the gravity off.
        if (here.status === PLANET_STATUS.SWALLOWED && here.owner !== contestant.faction) return JUMP_REFUSAL.TRAPPED;
        return null;
    }

    /** Orbits a contestant's next jump can cross: one, or more with an overdrive chip aboard. */
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
        // Only a jump further than the next orbit burns the overdrive chip.
        const overdrive = this.map.distance(this.placeOf(contestant).planet.id, to) > 1;
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
        };
        pilot.zone.world.removeShip(ship, { flash: true });
        contestant.jump = null;
        contestant.jumpReadyAt = this.server.time + this.jumpCooldown;
        if (jump.overdrive && contestant.inventory.use(EQUIPMENT.OVERDRIVE)) {
            this.tellMode(pilot, BR_EVENT.EQUIPMENT_USED, { item: EQUIPMENT.OVERDRIVE });
        }

        const arrived = this.launch(contestant, this.places.get(jump.to), { hullFraction: carried.hullFraction });
        arrived.shield = arrived.maxShield * carried.shieldFraction;
        arrived.energy = carried.energy;
        arrived.boost = carried.boost;
        arrived.powerMode = carried.powerMode;
        arrived.throttle = carried.throttle;
        arrived.weapons.forEach((weapon, index) => Object.assign(weapon, carried.weapons[index]));
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

    /** A side's ship has stayed docked long enough: the station, and the planet with it, is that side's. */
    capture(place, faction) {
        const former = place.owner;
        // A choice the last holder had not finished making is made for them now.
        if (place.vote) this.resolveVote(place);
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
            // Equipment is theirs whatever the side decides about the reward.
            member.inventory.grant(BATTLE_ROYALE.capture.picks);
            this.tellMode(member.pilot, BR_EVENT.PICKS, { picks: member.inventory.picks });
        }

        const fallen = [...this.contestants.values()].some((contestant) => !contestant.alive && !contestant.pilot.gone && contestant.faction === faction);
        if (fallen) {
            place.vote = {
                faction,
                endsAt: this.server.time + BATTLE_ROYALE.capture.voteSeconds,
                ballots: new Map(members.map((member) => [member.pilot.id, null])),
            };
        } else {
            this.reward(members);
        }
        this.server.publishState();
    }

    castVote(contestant, choice) {
        const vote = this.placeOf(contestant)?.vote;
        if (!vote || !vote.ballots.has(contestant.pilot.id) || (choice !== VOTE.REVIVE && choice !== VOTE.REWARD)) return;
        vote.ballots.set(contestant.pilot.id, choice);
        // Everyone has spoken: no need to wait for the clock.
        if ([...vote.ballots.values()].every(Boolean)) vote.endsAt = this.server.time;
        this.server.publishState();
    }

    /** Most votes wins; a tie brings the fallen back; if nobody chose, the reward is taken. */
    resolveVote(place) {
        const { faction, ballots } = place.vote;
        place.vote = null;
        const votes = [...ballots.values()];
        const revive = votes.filter((choice) => choice === VOTE.REVIVE).length;
        const reward = votes.filter((choice) => choice === VOTE.REWARD).length;
        if (revive > 0 && revive >= reward) {
            for (const contestant of this.contestants.values()) {
                if (contestant.alive || contestant.pilot.gone || contestant.faction !== faction) continue;
                this.launch(contestant, place);
                contestant.jumpReadyAt = this.server.time + this.jumpCooldown;
                this.tellMode(contestant.pilot, BR_EVENT.REVIVED, { planet: place.planet.id });
            }
        } else {
            this.reward(this.membersAt(place, faction));
        }
        this.server.publishState();
    }

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
        if (this.introLeft > 0) return;
        switch (name) {
            case BR_REQUEST.JUMP: this.requestJump(contestant, data.to); break;
            case BR_REQUEST.REFIT: this.spendPoints(contestant, data.added); break;
            case BR_REQUEST.SUMMON: this.summon(contestant); break;
            case BR_REQUEST.VOTE: this.castVote(contestant, data.choice); break;
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
        callReinforcements(pilot.zone, pilot.ship, classId, BATTLE_ROYALE.summon.count, BATTLE_ROYALE.summon.distance);
        this.server.publishState();
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

    onShipDestroyed(zone, ship, killer) {
        const scorer = killer?.isPlayer ? this.contestants.get(killer.pilotId) : null;
        const victim = ship.isPlayer ? this.contestants.get(ship.pilotId) : null;
        if (victim) {
            victim.alive = false;
            victim.deaths += 1;
            victim.jump = null;
            victim.gravityShieldUntil = 0;
            victim.emergencyShieldUntil = 0;
            this.undock(victim);
        }
        if (scorer && scorer !== victim) {
            const points = victim ? BATTLE_ROYALE.score.playerKill : BATTLE_ROYALE.score.ships[ship.classId] ?? 0;
            scorer.kills += 1;
            scorer.score += points;
            if (points > 0) scorer.pilot.tell(WORLD_EVENT.SCORE, points, ship.classId, scorer.score);
        }
        this.server.publishState();
    }

    onPlayerLeft(pilot) {
        const contestant = this.contestants.get(pilot.id);
        if (!contestant) return;
        contestant.alive = false;
        contestant.jump = null;
        this.undock(contestant);
        for (const place of this.places.values()) place.vote?.ballots.delete(pilot.id);
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

    checkVictory() {
        if (this.result) return;
        const standing = this.standingSides();
        // A dead side cannot be brought back by anyone but itself.
        if (standing.size === 0) this.finish(null);
        else if (standing.size === 1 && this.sidesAtStart.size > 1) this.finish([...standing][0]);
        else if (this.clock.finalStandLeft === 0) this.finish(this.holderOfGate() ?? this.strongestAtGate());
    }

    /** The side that holds the stargate's station, if it still has a pilot flying. */
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
        const vote = here?.vote?.ballots.has(pilot.id) ? here.vote : null;
        return {
            mode: 'battleRoyale',
            matchId: this.info.matchId,
            phase: this.result ? MATCH_PHASE.OVER : MATCH_PHASE.PLAYING,
            winner: this.result?.winner ?? null,
            time: Math.round(time),
            intro: this.introLeft > 0 ? Math.ceil(this.introLeft) : null,
            finalStand: this.clock.finalStandLeft === null ? null : Math.ceil(this.clock.finalStandLeft),
            you: you && {
                faction: you.faction,
                planet: here?.planet.id ?? null,
                alive: you.alive,
                points: you.points,
                summons: you.summons,
                upgrades: pilot.upgrades,
                loyalty: you.loyalty.status,
                jump: {
                    cooldown: Math.max(0, Math.ceil(you.jumpReadyAt - time)),
                    to: you.jump?.to ?? null,
                    spool: you.jump ? Math.max(0, you.jump.left) : null,
                    trapped: Boolean(here) && here.status === PLANET_STATUS.SWALLOWED && here.owner !== you.faction,
                    reach: this.jumpReach(you),
                },
                dock: this.describeDock(you, here),
                picks: you.inventory.picks,
                equipment: you.inventory.describe(),
                effects: {
                    gravityShield: Math.max(0, Math.ceil(you.gravityShieldUntil - time)),
                    emergencyShield: Math.max(0, Math.ceil(you.emergencyShieldUntil - time)),
                },
                vote: vote && { planet: here.planet.id, endsIn: Math.max(0, Math.ceil(vote.endsAt - time)), choice: vote.ballots.get(pilot.id) },
            },
            planets: [...this.places.values()].map((place) => this.describePlace(place, you)),
            players: [...this.contestants.values()].filter((contestant) => !contestant.pilot.gone).map((contestant) => ({
                id: contestant.pilot.id,
                name: contestant.pilot.name,
                classId: contestant.pilot.classId,
                faction: contestant.faction,
                alive: contestant.alive,
                score: contestant.score,
                kills: contestant.kills,
                deaths: contestant.deaths,
            })),
        };
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
        // The pirates are a side like the others in this: they only differ in being free to shoot each other.
        const comrades = you ? this.membersAt(place, you.faction).filter((member) => member !== you).map((member) => member.pilot.name) : [];
        const beacon = Boolean(you) && place.scouts.has(you.faction);
        const known = Boolean(you) && (this.placeOf(you) === place || comrades.length > 0 || place.owner === you.faction || beacon);
        const description = {
            id: place.planet.id,
            status: place.status,
            changesIn: wait === null ? null : Math.ceil(wait),
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
