import { Vector3 } from 'three';
import { BATTLE_ROYALE, NPC_FACTIONS, PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { RATING_ORDER } from '../../config/playerShips.js';
import { SECTORS } from '../../config/sectors.js';
import { createRng, randomUnitVector } from '../../core/math.js';
import { mergeUpgrades } from '../../core/refit.js';
import { applyDamage } from '../../core/systems/damage.js';
import { cleanUpgrades } from '../../net/match/matchInfo.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { WORLD_EVENT } from '../../net/protocol.js';
import { LOYALTY, LoyaltyRecord, dealFactions, isPirate } from './allegiance.js';
import { BR_EVENT, BR_REQUEST, JUMP_REFUSAL, VOTE } from './battleRoyaleProtocol.js';
import { CollapseClock, PLANET_STATUS } from './collapse.js';
import { buildStargate, callReinforcements, planGarrisons, stationGarrison } from './garrisons.js';
import { StarMap } from './starMap.js';

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
    }
}

/** What the rules know about one planet. */
class Place {
    constructor(planet, orbit, zone) {
        this.planet = planet;
        this.orbit = orbit;
        this.zone = zone;
        /** The side whose anti-gravity bubble covers the planet, or null. */
        this.owner = null;
        /** Sides that have destroyed something hostile here since they last arrived: only they can take the planet. */
        this.earned = new Set();
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
 * the stargate on the last one. Players are dealt into the sides at random; planets are held
 * by the Federation's and the Umbra's computer-flown garrisons, some of them already at war.
 *
 * Tuning is in config/battleRoyale.js. The pieces: StarMap (who can jump where), CollapseClock
 * (what falls in when), allegiance (sides and treason), garrisons (the computer-flown ships).
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
            this.places.set(planet.id, new Place(planet, orbit, zone));
            if (planet.gate) buildStargate(zone);
            const sidesHere = garrisons.get(planet.id);
            for (const faction of sidesHere) {
                const ships = planet.gate ? BATTLE_ROYALE.garrisons.gate[faction] : BATTLE_ROYALE.garrisons[faction];
                stationGarrison(zone, faction, ships, BATTLE_ROYALE.garrisons, sidesHere.length === 1);
            }
        });

        const sides = dealFactions([...server.pilots.keys()], PLAYER_FACTIONS, rng);
        const startOf = new Map();
        for (const pilot of server.pilots.values()) {
            const faction = sides.get(pilot.id);
            const contestant = new Contestant(pilot, faction);
            this.contestants.set(pilot.id, contestant);
            this.sidesAtStart.add(faction);
            // A side starts together - except the pirates, who are no side at all.
            const together = isPirate(faction) ? pilot.id : faction;
            if (!startOf.has(together)) startOf.set(together, this.pickStart(faction, garrisons, new Set(startOf.values())));
            contestant.start = startOf.get(together);
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

    /** Puts a contestant in a (new) ship at a planet, scattered around its zone's start point. */
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
        }
        for (const place of this.places.values()) {
            if (!place.zone.active) continue;
            if (place.vote && time >= place.vote.endsAt) this.resolveVote(place);
            this.checkCapture(place);
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

        const drain = status === PLANET_STATUS.COLLAPSING ? BATTLE_ROYALE.collapse.collapsingDrain : BATTLE_ROYALE.collapse.swallowedDrain;
        const { world } = place.zone;
        for (const ship of world.ships) {
            if (!ship.alive || this.isShielded(place, ship)) continue;
            applyDamage(world, ship, drain * (ship.maxHull + ship.maxShield) * dt, { continuous: true });
        }
    }

    /** True for ships the black hole cannot touch here: scenery, and the side whose bubble covers the planet. */
    isShielded(place, ship) {
        return ship.invulnerable || ship.faction === FACTION.NEUTRAL || ship.faction === place.owner;
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
        if (!this.map.areNeighbours(here.planet.id, to)) return JUMP_REFUSAL.NOT_ADJACENT;
        if (this.server.time < contestant.jumpReadyAt) return JUMP_REFUSAL.CHARGING;
        // A swallowed planet lets nothing go - except the side whose bubble holds the gravity off.
        if (here.status === PLANET_STATUS.SWALLOWED && here.owner !== contestant.faction) return JUMP_REFUSAL.TRAPPED;
        return null;
    }

    requestJump(contestant, to) {
        const refusal = typeof to === 'string' ? this.jumpRefusal(contestant, to) : JUMP_REFUSAL.NOT_ADJACENT;
        if (refusal) {
            this.tellMode(contestant.pilot, BR_EVENT.JUMP_REFUSED, { reason: refusal });
            return;
        }
        contestant.jump = { to, left: BATTLE_ROYALE.jump.spool };
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

    /**
     * A side takes a planet when it has a pilot there, has destroyed something hostile there,
     * and nothing hostile to it is left: no ship of another side, computer-flown or not.
     */
    checkCapture(place) {
        const { ships } = place.zone.world;
        for (const faction of PLAYER_FACTIONS) {
            if (this.membersAt(place, faction).length === 0) {
                place.earned.delete(faction);
                continue;
            }
            if (place.owner === faction || !place.earned.has(faction) || place.vote) continue;
            const contested = ships.some((ship) => ship.alive && ship.faction !== faction && ship.faction !== FACTION.NEUTRAL);
            if (!contested) this.capture(place, faction);
        }
    }

    capture(place, faction) {
        place.owner = faction;
        place.earned.clear();
        place.zone.share(WORLD_EVENT.MODE, BR_EVENT.CAPTURED, { planet: place.planet.id, faction });
        const members = this.membersAt(place, faction);
        for (const member of members) member.score += BATTLE_ROYALE.capture.score;

        // The stargate, once it is the only planet left, is the match.
        if (place.planet.gate && this.clock.finalStand) {
            this.finish(faction);
            return;
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
        if (!contestant || this.result || this.introLeft > 0) return;
        switch (name) {
            case BR_REQUEST.JUMP: this.requestJump(contestant, data.to); break;
            case BR_REQUEST.REFIT: this.spendPoints(contestant, data.added); break;
            case BR_REQUEST.SUMMON: this.summon(contestant); break;
            case BR_REQUEST.VOTE: this.castVote(contestant, data.choice); break;
            default:
        }
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

    /** A traitor is nobody's any more: every side's guns, their old one's included, are free to fire. */
    brandPirate(contestant, zone) {
        const former = contestant.faction;
        contestant.faction = FACTION.PIRATE;
        contestant.summons = 0;
        if (contestant.pilot.ship?.alive) this.server.setShipFaction(zone, contestant.pilot.ship, FACTION.PIRATE);
        this.tellMode(contestant.pilot, BR_EVENT.BRANDED, { former });
        this.server.publishState();
    }

    onShipDestroyed(zone, ship, killer) {
        const place = this.places.get(zone.id);
        // Whoever is here and was hostile to that ship has done some of the fighting for this planet.
        if (ship.faction !== FACTION.NEUTRAL) {
            for (const faction of PLAYER_FACTIONS) {
                if (faction !== ship.faction && this.membersAt(place, faction).length > 0) place.earned.add(faction);
            }
        }

        const scorer = killer?.isPlayer ? this.contestants.get(killer.pilotId) : null;
        const victim = ship.isPlayer ? this.contestants.get(ship.pilotId) : null;
        if (victim) {
            victim.alive = false;
            victim.deaths += 1;
            victim.jump = null;
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
        else if (this.clock.finalStandLeft === 0) this.finish(this.strongestAtGate());
    }

    /** When the last stand runs out: the side with the most ships at the stargate, then the best score. */
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

    /** A planet as the map shows it. Garrisons are public knowledge; where other sides' pilots are is not. */
    describePlace(place, you) {
        const forces = {};
        for (const faction of NPC_FACTIONS) forces[faction] = 0;
        for (const ship of place.zone.world.ships) {
            if (ship.alive && !ship.isPlayer && ship.faction in forces) forces[ship.faction] += 1;
        }
        const wait = this.clock.secondsToChange(place.orbit);
        const comrades = you && !isPirate(you.faction)
            ? this.membersAt(place, you.faction).filter((member) => member !== you).map((member) => member.pilot.name)
            : [];
        return {
            id: place.planet.id,
            status: place.status,
            changesIn: wait === null ? null : Math.ceil(wait),
            owner: place.owner,
            forces,
            comrades,
        };
    }
}
