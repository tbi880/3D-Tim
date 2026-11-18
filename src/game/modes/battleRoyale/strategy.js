import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { FACTION } from '../../config/gameConfig.js';
import { PLANET_STATUS } from './collapse.js';

/**
 * Where a side's computer-flown units go (BATTLE_ROYALE.strategy): its bots and the
 * reinforcements its pilots have called. Each side has a war council on the host's device
 * that, every few seconds, looks at the star system as the side's pilots can see it, lists
 * what needs doing and gives every unit a planet to be at. A bot or a squad of reinforcements
 * that is somewhere else jumps towards it - by the same rules as any pilot - and when it is
 * there does what it does anyway: fights, docks, keeps watch.
 *
 * The jobs, most pressing first:
 *   dockAlarm  another side is docked at one of the side's stations, taking it
 *   defend     hostile ships at one of its stations
 *   avenge     one of its pilots was shot down at one of its stations a moment ago
 *   rescue     one of its pilots is outnumbered where the side holds nothing
 *   revive     a station to take while the side holds none and has pilots down: taking it brings them back
 *   take       a station it does not hold (outer ones first, the stargate's most of all; more for every pilot down)
 *   guard      one ship on watch at each station it holds (two at the stargate's, near the end): the most
 *              valuable one before anything but the urgent, the next before most stations to take
 * A side does not go looking for a fight it cannot hope to win (`boldness`): a unit caught in
 * one gets out, and the side's last pilot in the air keeps out of trouble until the others are
 * back - with nobody flying the side would be out of the match.
 * Every job asks for as much strength as the enemy has there and a little more; once a job
 * has that, the next unit goes to the next job - so the side spreads out over what needs
 * doing instead of piling into one place. A job further away is worth less (each jump on
 * the way costs a minute of the drive), and one that cannot be reached before the collapse
 * gets there is not offered at all - a station of the side's own no more than any other:
 * holding it is no shelter from the collapse.
 *
 * Only what the side could know is used: what stands where it has eyes (a pilot there, a
 * station it holds, a beacon), the alarms its pilots hear, the losses they see on the team list.
 * The planning (`planSide`) is a pure function of that picture, so it can be tested on its own.
 */

const TUNING = BATTLE_ROYALE.strategy;

export const TASK = Object.freeze({
    DOCK_ALARM: 'dockAlarm',
    DEFEND: 'defend',
    AVENGE: 'avenge',
    RESCUE: 'rescue',
    REVIVE: 'revive',
    TAKE: 'take',
    GUARD: 'guard',
    /** Not a job but an order for the side's last pilot in the air: keep out of trouble. */
    HIDE: 'hide',
});

/**
 * Jobs a unit drops everything for: it jumps the moment its drive allows, mid-fight or not, and
 * may burn an overdrive chip to get there - further in one jump, or before the drive has charged.
 */
export const URGENT_TASKS = new Set([TASK.DOCK_ALARM, TASK.DEFEND, TASK.AVENGE, TASK.RESCUE, TASK.REVIVE]);

/**
 * How much a ship counts for in a fight (BATTLE_ROYALE.strategy `strength`). What is bolted on
 * another ship (a mothership's gun battery) counts as part of it.
 */
export function shipStrength(ship, tuning = TUNING) {
    if (ship.isPlayer) return tuning.strength.player;
    if (ship.parent) return 0;
    return ship.cls.kind === 'capital' ? tuning.strength.capital : tuning.strength.other;
}

/**
 * The next planet on the way from orbit `from` to orbit `to`: one orbit along, or two with
 * `reach` 2 when at least two are left.
 * @returns {number} the orbit
 */
export function stepToward(from, to, reach = 1) {
    if (from === to) return from;
    const direction = Math.sign(to - from);
    return from + direction * Math.min(Math.abs(to - from), reach);
}

/** Total strength of a side's units. */
const forceOf = (situation) => situation.units.reduce((sum, unit) => sum + unit.strength, 0);

/**
 * True when a side could hope to win a fight at a place: the enemy there (or what may be
 * there, where it has no eyes) is no more than `boldness` times what it could bring - every
 * unit it has, and its people and garrison there.
 */
function canWin(place, force, tuning, boldness = tuning.boldness) {
    return (place.enemy ?? tuning.unknownEnemy) <= boldness * (force + place.friends);
}

/**
 * The jobs a side has, from its picture of the system.
 * @param {object} situation see `planSide`
 * @returns {{ planet: string, orbit: number, task: string, priority: number, need: number }[]} at most one per planet
 */
export function listTasks(situation, tuning = TUNING) {
    const { places, front, gateOrbit, fallen = 0, holdsStation = true } = situation;
    const { priority } = tuning;
    const force = forceOf(situation);
    const unitCount = situation.units.length;
    const reachable = (place) => place.orbit <= front + tuning.maxAhead;
    // Strength wanted at a place beyond what is there already and cannot be moved.
    const wanted = (place) => Math.min(tuning.maxNeed, Math.max(0, (place.enemy ?? tuning.unknownEnemy) * tuning.overmatch + tuning.margin - place.friends));
    // The stations worth a watch most - the stargate's, then the outer ones - come first; only a side with more than one unit spares one for the watch first.
    const watched = places.filter((place) => place.mine && !place.swallowed).sort((a, b) => b.orbit - a.orbit);
    const watchWorth = (place) => {
        const rank = unitCount > 1 ? watched.indexOf(place) : Infinity;
        const base = rank === 0 ? priority.guardFirst : rank === 1 ? priority.guardSecond : priority.guard;
        return base + priority.guardPerOrbit * place.orbit;
    };
    // Taking a station brings the side's fallen back: worth more for each, and everything while they have nowhere else to come back to.
    const stranded = fallen > 0 && !holdsStation;
    const tasks = [];
    for (const place of places) {
        // Nothing is worth doing where the collapse is about to come (or has come), the side's own station included.
        if (place.swallowed || place.safeFor <= tuning.routeMargin) continue;
        const gate = place.orbit === gateOrbit && reachable(place);
        const add = (task, worth, need) => tasks.push({ planet: place.id, orbit: place.orbit, task, priority: worth, need });
        if (place.mine) {
            // A station being taken is worth a braver fight than any other.
            if (place.beingTaken) {
                if (canWin(place, force, tuning, tuning.boldness * tuning.dockAlarmBoldness)) add(TASK.DOCK_ALARM, priority.dockAlarm, Math.max(tuning.dockAlarmNeed, wanted(place)));
            } else if (place.enemy > 0) {
                if (canWin(place, force, tuning)) add(TASK.DEFEND, priority.defend, Math.max(1, wanted(place)));
            } else if (place.losses > 0) {
                add(TASK.AVENGE, priority.avenge, Math.max(1, Math.min(tuning.maxNeed, place.losses)));
            } else if (place.safeFor > tuning.doomSeconds) {
                // (Guarding is not held back by the collapse's front: what the side holds, it keeps watch over.
                // A watch it already has - one of its people, its own garrison - needs no unit.)
                const need = (gate ? tuning.gateGuards : 1) - place.friends;
                if (need > 0) add(TASK.GUARD, watchWorth(place) + (gate ? priority.gate : 0), need);
            }
            continue;
        }
        if (!canWin(place, force, tuning)) continue;
        // Outnumbered and being shot at, not merely in sight of a garrison on guard.
        const outnumbered = place.pilots > 0 && place.underFire && place.enemy > place.friends + place.units;
        if (outnumbered) add(TASK.RESCUE, priority.rescue, Math.max(1, wanted(place)));
        else if (stranded && place.safeFor > tuning.doomSeconds) {
            add(TASK.REVIVE, priority.revive + priority.takePerOrbit * place.orbit + priority.reviveEach * fallen, Math.max(1, wanted(place)));
        } else if (reachable(place) && place.safeFor > tuning.doomSeconds) {
            add(TASK.TAKE, priority.take + priority.takePerOrbit * place.orbit + priority.reviveEach * fallen + (gate ? priority.gate : 0), Math.max(1, wanted(place)));
        }
    }
    return tasks;
}

/**
 * How a unit would get to a planet: the jumps, and whether the way is open. Every planet it
 * stops at on the way must still be standing when it leaves again (whoever holds its station:
 * that is no shelter), and where it is going must still be worth being at when it arrives.
 * @param {{ orbit: number, task: string }} task where to, and what for (an urgent job may burn an overdrive chip)
 * @returns {{ hops: number, eta: number } | null} null when it cannot get there in time
 */
export function route(unit, task, situation, tuning = TUNING) {
    const { places, timing } = situation;
    const distance = Math.abs(task.orbit - unit.orbit);
    if (distance === 0) return { hops: 0, eta: 0 };
    // An overdrive chip (a unit with `reach` past one orbit carries one) is only burned for
    // something urgent, on the first jump: when that jump crosses more than one orbit, or the
    // drive is still charging - the chip does not wait for the charge, and leaves it as it was.
    const overdrive = URGENT_TASKS.has(task.task) && unit.reach > 1 && (distance > 1 || unit.readyIn > 0);
    let orbit = unit.orbit;
    let hops = 0;
    let time = overdrive ? 0 : unit.readyIn;
    for (;;) {
        const onChip = overdrive && hops === 0;
        orbit = stepToward(orbit, task.orbit, onChip ? unit.reach : 1);
        hops += 1;
        time += timing.spool;
        const stop = places[orbit];
        if (orbit === task.orbit) {
            // Somewhere to take or guard is only worth it with time to do so; something urgent needs less -
            // but a station taken to bring the fallen back must stand long enough for them to get away again.
            const keep = URGENT_TASKS.has(task.task) && task.task !== TASK.REVIVE ? tuning.routeMargin : tuning.doomSeconds;
            return stop.safeFor > time + keep ? { hops, eta: time } : null;
        }
        // On the way: it waits out the drive's charge there (after the chip's jump, only what was
        // left of the charge it had), and must be gone before the collapse begins.
        const leaves = onChip ? Math.max(time, unit.readyIn) : time + timing.cooldown;
        if (stop.swallowed || stop.safeFor <= leaves + tuning.routeMargin) return null;
        time = leaves;
    }
}

/**
 * Where a side's last pilot in the air lies low while the others wait to come back: somewhere
 * it can see nothing hostile - where it is, if that will do - and can reach in time.
 */
function hideout(unit, situation, tuning) {
    let best = null;
    for (const place of situation.places) {
        if (place.swallowed || place.enemy !== 0) continue;
        const way = route(unit, { orbit: place.orbit, task: TASK.HIDE }, situation, tuning);
        if (!way) continue;
        const worth = (place.mine ? 1 : 0) - way.hops * 2;
        if (!best || worth > best.worth) best = { place, worth };
    }
    return best?.place ?? null;
}

/**
 * Gives a side's units their planets.
 * @param {object} situation the side's picture of the system:
 *   places   one per orbit, innermost first: { id, orbit, mine, swallowed, safeFor (seconds until it starts
 *            to fall in: Infinity if never, 0 once it has), beingTaken, enemy (hostile strength, null where
 *            the side has no eyes), friends (strength of the side there that takes no orders: people, the
 *            side's garrison), units (strength of the side's units there), pilots (the side's pilots there,
 *            bots included), underFire (one of them was hit just now), losses (strength the side has lost there lately) }
 *   front    the innermost orbit still standing; gateOrbit the stargate's
 *   flying   the side's pilots in the air (people too); fallen those who are down and may come back;
 *            holdsStation whether it holds any station for them to come back to (not one about to be swallowed)
 *   timing   { cooldown, spool } of a jump drive
 *   units    { key, orbit, readyIn (seconds until its drive is charged), reach (orbits its next jump may
 *            cross: more than one with an overdrive chip aboard, which does not wait for the charge), strength, squad (true for reinforcements), current (the planet it was last given),
 *            fixed (a planet it is bound to whatever happens: where it is jumping, docked or called to) }
 * @returns {{ orders: Map<string, { planet: string, task: string | null, urgent: boolean }>, tasks: object[] }}
 *          a unit with no order stays where it is; an urgent order is one to go at once, mid-fight or not
 */
export function planSide(situation, tuning = TUNING) {
    const tasks = listTasks(situation, tuning);
    const byPlanet = new Map(tasks.map((task) => [task.planet, task]));
    const filled = new Map(tasks.map((task) => [task, 0]));
    const orders = new Map();
    const order = (unit, planet, task, urgent = URGENT_TASKS.has(task)) => orders.set(unit.key, { planet, task, urgent });
    const free = [];
    for (const unit of situation.units) {
        if (unit.fixed === null || unit.fixed === undefined) {
            free.push(unit);
            continue;
        }
        const task = byPlanet.get(unit.fixed) ?? null;
        order(unit, unit.fixed, task?.task ?? null);
        if (task) filled.set(task, filled.get(task) + unit.strength);
    }

    // The side's last pilot in the air keeps out of trouble until the others are back: with
    // nobody flying, the side would be out of the match. (With no station to come back to,
    // the others can only be brought back by taking one, and that is worth the risk.)
    const pilots = free.filter((unit) => !unit.squad);
    if (situation.flying === 1 && situation.fallen > 0 && situation.holdsStation && pilots.length === 1) {
        const [last] = pilots;
        const hiding = hideout(last, situation, tuning);
        if (hiding) {
            order(last, hiding.id, TASK.HIDE, true);
            free.splice(free.indexOf(last), 1);
        }
    }

    const pairs = [];
    for (const unit of free) {
        for (const task of tasks) {
            const way = route(unit, task, situation, tuning);
            if (!way) continue;
            let worth = task.priority - tuning.hopCost * way.hops;
            if (unit.current === task.planet) worth += tuning.stickiness;
            // Reinforcements cannot dock: the watch is theirs before a pilot's, a station to take a pilot's before theirs.
            if (unit.squad && (task.task === TASK.TAKE || task.task === TASK.REVIVE)) worth -= tuning.squadTake;
            if (unit.squad && task.task === TASK.GUARD) worth += tuning.squadGuard;
            pairs.push({ unit, task, worth });
        }
    }
    // Best first; ties go the same way every time (the plan is the host's alone, but tests like it steady).
    pairs.sort((a, b) => b.worth - a.worth || a.task.orbit - b.task.orbit || (a.unit.key < b.unit.key ? -1 : 1));
    for (const { unit, task } of pairs) {
        if (orders.has(unit.key) || filled.get(task) >= task.need) continue;
        order(unit, task.planet, task.task);
        filled.set(task, filled.get(task) + unit.strength);
    }
    // Whoever is left over goes where it adds most, every job's need being met already.
    for (const unit of free) {
        if (orders.has(unit.key)) continue;
        let best = null;
        for (const pair of pairs) {
            if (pair.unit !== unit) continue;
            const worth = pair.worth - (filled.get(pair.task) >= pair.task.need ? tuning.overflow : 0);
            if (!best || worth > best.worth) best = { task: pair.task, worth };
        }
        if (best) {
            order(unit, best.task.planet, best.task.task);
            filled.set(best.task, filled.get(best.task) + unit.strength);
        }
    }
    // A unit caught where its side cannot hope to win - no job there for it - gets out at once.
    const force = forceOf(situation);
    for (const unit of free) {
        const given = orders.get(unit.key);
        const here = situation.places[unit.orbit];
        if (given && given.planet !== here.id && !byPlanet.has(here.id) && here.enemy > 0 && !canWin(here, force, tuning)) given.urgent = true;
    }
    return { orders, tasks };
}

/**
 * One side's war council: it keeps the side's picture of the system up to date on its own
 * slow beat (`planInterval`, each side on a different one) and hands out the orders.
 */
export class WarCouncil {
    /**
     * @param {object} mode the battle royale's rules (BattleRoyaleMode)
     * @param {string} faction
     * @param {number} firstIn seconds until it first plans
     */
    constructor(mode, faction, firstIn = 0) {
        this.mode = mode;
        this.faction = faction;
        this.planIn = firstIn;
        /** @type {Map<string, { planet: string, task: string | null }>} by unit key (a bot's player id, a squad's key) */
        this.orders = new Map();
        /** The jobs of the last plan. */
        this.tasks = [];
        /** The side's pilots and reinforcements lost lately: { planet, at, strength }. */
        this.losses = [];
    }

    update(dt) {
        this.planIn -= dt;
        if (this.planIn > 0) return;
        this.planIn = TUNING.planInterval;
        this.plan();
    }

    /** Plans now. */
    plan() {
        const units = this.mode.unitsOf(this.faction);
        if (units.length === 0) {
            this.orders = new Map();
            this.tasks = [];
            return;
        }
        const plan = planSide(this.survey(units));
        this.orders = plan.orders;
        this.tasks = plan.tasks;
    }

    /** The planet a unit is to be at and why, or null (it stays where it is). */
    orderFor(key) {
        return this.orders.get(key) ?? null;
    }

    /** One of the side's ships was lost at `place`: there is trouble there. */
    noteLoss(place, strength) {
        const { time } = this.mode.server;
        this.losses = this.losses.filter((loss) => time - loss.at < TUNING.lossMemory);
        this.losses.push({ planet: place.planet.id, at: time, strength });
    }

    /**
     * Of the stations a pilot of the side who is down may come back at, the one nearest the
     * most pressing job - so a bot shot down defending comes back next door - or, with
     * nothing pressing, the first one offered.
     */
    respawnPick(stations) {
        const urgent = this.tasks.filter((task) => URGENT_TASKS.has(task.task)).sort((a, b) => b.priority - a.priority)[0];
        if (!urgent || stations.length === 0) return stations[0] ?? null;
        let best = stations[0];
        for (const place of stations) {
            if (Math.abs(place.orbit - urgent.orbit) < Math.abs(best.orbit - urgent.orbit)) best = place;
        }
        return best;
    }

    /** The side's picture of the system (see planSide), from what its pilots can know. */
    survey(units = this.mode.unitsOf(this.faction)) {
        const { mode, faction } = this;
        const { time } = mode.server;
        this.losses = this.losses.filter((loss) => time - loss.at < TUNING.lossMemory);
        const unitShips = new Set();
        for (const unit of units) for (const ship of unit.ships) unitShips.add(ship);

        let front = mode.map.count - 1;
        const places = [...mode.places.values()].map((place) => {
            const status = place.status;
            if (status !== PLANET_STATUS.SWALLOWED) front = Math.min(front, place.orbit);
            const wait = mode.clock.secondsToChange(place.orbit);
            const seen = mode.sideSees(place, faction);
            let enemy = 0;
            let friends = 0;
            let unitStrength = 0;
            for (const ship of place.zone.world.ships) {
                if (!ship.alive || ship.faction === FACTION.NEUTRAL || ship.invulnerable) continue;
                const strength = shipStrength(ship);
                if (ship.faction !== faction) enemy += strength;
                else if (unitShips.has(ship)) unitStrength += strength;
                else friends += strength;
            }
            const members = mode.membersAt(place, faction);
            const losses = this.losses.filter((loss) => loss.planet === place.planet.id).reduce((sum, loss) => sum + loss.strength, 0);
            return {
                id: place.planet.id,
                orbit: place.orbit,
                mine: place.owner === faction,
                swallowed: status === PLANET_STATUS.SWALLOWED,
                safeFor: status === PLANET_STATUS.SAFE ? wait ?? Infinity : 0,
                beingTaken: place.owner === faction && mode.beingTaken(place),
                // Where the side has no eyes its pilots know neither who is there nor - beyond its own - who holds what.
                enemy: seen ? enemy : null,
                friends: seen ? friends : 0,
                units: unitStrength,
                pilots: members.length,
                underFire: members.some((member) => place.zone.world.time - member.pilot.ship.lastDamagedAt < TUNING.underFireSeconds),
                losses,
            };
        });
        const fallen = [...mode.contestants.values()].filter((contestant) => contestant.faction === faction && !contestant.alive
            && !contestant.pilot.gone && contestant.respawnAt !== null).length;
        return {
            places,
            front,
            gateOrbit: mode.map.count - 1,
            flying: [...mode.contestants.values()].filter((contestant) => contestant.faction === faction && contestant.alive && !contestant.pilot.gone).length,
            fallen,
            holdsStation: mode.holdsStation(faction),
            timing: { cooldown: mode.jumpCooldown, spool: BATTLE_ROYALE.jump.spool },
            units: units.map((unit) => this.describeUnit(unit, time)),
        };
    }

    /**
     * A unit as planSide wants it. One that is jumping is bound to where it was going - the
     * end of its way, not the stop it is jumping to - so the job it is on its way to stays its.
     */
    describeUnit(unit, time) {
        const described = unit.describe(time);
        const current = this.orders.get(unit.key)?.planet ?? null;
        if (unit.jump && current !== null) {
            const { orbitOf } = this.mode.map;
            const ahead = Math.sign(orbitOf.get(unit.jump.to) - described.orbit) === Math.sign(orbitOf.get(current) - described.orbit);
            if (ahead) described.fixed = current;
        }
        return { ...described, current };
    }
}
