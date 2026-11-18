import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { isValidTarget } from '../../core/systems/targeting.js';
import { PLANET_STATUS } from './collapse.js';
import { garrisonGroup } from './garrisons.js';
import { shipStrength, stepToward } from './strategy.js';

/**
 * Reinforcements a pilot has called (BATTLE_ROYALE.summon), kept together as a squad that
 * goes where its side's war council sends it (strategy.js): the ships fight as every
 * computer-flown ship does (core/systems/aiPilot.js), and the squad between planets by a
 * pilot's rules - one orbit a jump, `jump.spool` seconds to leave, the drive's cooldown after
 * every arrival, nothing out of a swallowed planet (whoever holds its station). For the first
 * `strategy.summonCommit` seconds they stay with the fight they were called into.
 *
 * A squad's ships carry its tag (`squad:<id>`), so a checkpoint's ships find their squad again.
 */

const SQUAD_TAG_PREFIX = 'squad:';
export const squadTag = (id) => `${SQUAD_TAG_PREFIX}${id}`;

/** The squad number in a ship's tags, or null. */
export function squadIdOf(ship) {
    for (const tag of ship.tags) {
        if (!tag.startsWith(SQUAD_TAG_PREFIX)) continue;
        const id = Number(tag.slice(SQUAD_TAG_PREFIX.length));
        if (Number.isInteger(id) && id > 0) return id;
    }
    return null;
}

export class Squad {
    /**
     * @param {object} params
     * @param {number} params.id
     * @param {string} params.faction
     * @param {object[]} params.ships the squad's ships, all in one place
     * @param {object} params.place where they are (BattleRoyaleMode's Place)
     * @param {number} params.readyAt match time at which their jump drives are charged
     * @param {number} [params.committedUntil] match time until which they stay where they were called
     */
    constructor({ id, faction, ships, place, readyAt, committedUntil = -Infinity }) {
        this.id = id;
        this.faction = faction;
        this.ships = ships;
        this.place = place;
        this.readyAt = readyAt;
        this.committedUntil = committedUntil;
        /** The jump being spooled up: { to, left }, or null. */
        this.jump = null;
    }

    get key() {
        return squadTag(this.id);
    }

    get alive() {
        return this.ships.length > 0;
    }

    /** Forgets ships that are gone (shot down, or swallowed with a planet nobody was at). */
    prune() {
        this.ships = this.ships.filter((ship) => ship.alive);
    }

    /** As the war council sees it (strategy.js planSide `units`). */
    describe(time) {
        const fixed = this.jump ? this.jump.to : time < this.committedUntil ? this.place.planet.id : null;
        return {
            key: this.key,
            orbit: this.place.orbit,
            readyIn: Math.max(0, this.readyAt - time),
            reach: 1,
            strength: this.ships.reduce((sum, ship) => sum + shipStrength(ship), 0),
            squad: true,
            fixed,
        };
    }

    /** True while any of its ships has something hostile to fight. */
    get engaged() {
        return this.ships.some((ship) => isValidTarget(ship.target));
    }

    /** Once per server frame. */
    update(mode, dt) {
        this.prune();
        if (!this.alive) return;
        if (this.jump) {
            this.jump.left -= dt;
            if (this.jump.left <= 0) this.arrive(mode, mode.places.get(this.jump.to));
            return;
        }
        const to = this.nextJump(mode);
        if (to) this.jump = { to, left: BATTLE_ROYALE.jump.spool };
    }

    /** Where to jump now, if anywhere: away from a planet falling in, else towards the council's orders. */
    nextJump(mode) {
        const { place, faction } = this;
        const { time } = mode.server;
        if (time < this.readyAt) return null;
        // A swallowed planet lets nothing go, and holding its station is no shelter from the collapse.
        if (place.status === PLANET_STATUS.SWALLOWED) return null;
        const outermost = place.orbit >= mode.map.count - 1;
        if (!outermost) {
            const wait = mode.clock.secondsToChange(place.orbit);
            const falling = place.status === PLANET_STATUS.COLLAPSING || (wait !== null && wait < BATTLE_ROYALE.bots.fleeAhead);
            if (falling) return mode.map.planets[place.orbit + 1].id;
        }
        const order = mode.councilOf(faction).orderFor(this.key);
        if (!order || order.planet === place.planet.id) return null;
        // Not in the middle of a fight, unless it is needed somewhere badly.
        if (!order.urgent && this.engaged) return null;
        const target = mode.map.orbitOf.get(order.planet);
        return mode.map.planets[stepToward(place.orbit, target, 1)].id;
    }

    /** The jump is spooled up: out of one place in a flash, out of warp at the next, each ship as battered as it was. */
    arrive(mode, to) {
        this.jump = null;
        const from = this.place.zone.world;
        const arrived = [];
        for (const ship of this.ships) {
            if (!ship.alive) continue;
            const hullFraction = ship.hullFraction;
            const shieldFraction = ship.maxShield > 0 ? ship.shield / ship.maxShield : 1;
            from.removeShip(ship, { flash: true });
            const { position, facing } = mode.arrivalPoint(to);
            const copy = to.zone.world.spawnShip(ship.classId, {
                faction: this.faction, position, facing, group: garrisonGroup(this.faction), tags: [this.key], warpIn: true, hullFraction,
            });
            copy.shield = copy.maxShield * shieldFraction;
            arrived.push(copy);
        }
        this.ships = arrived;
        this.place = to;
        this.readyAt = mode.server.time + mode.jumpCooldown;
    }

    /** For a checkpoint: times as "seconds from now". */
    save(time) {
        return {
            id: this.id,
            faction: this.faction,
            readyIn: this.readyAt - time,
            committedIn: Number.isFinite(this.committedUntil) ? this.committedUntil - time : null,
            jump: this.jump && { to: this.jump.to, left: this.jump.left },
        };
    }
}

/**
 * The squads of a match rebuilt from a checkpoint: every tagged ship in every place, grouped
 * by its tag, with what the checkpoint says of each squad (a squad it says nothing of - one
 * from a checkpoint older than squads - gets uncharged drives and no orders to stay).
 * @param {object} mode BattleRoyaleMode with its places rebuilt
 * @param {object[]} saved Squad.save()'s, as the checkpoint has them (unchecked)
 * @returns {Squad[]}
 */
export function restoreSquads(mode, saved) {
    const { time } = mode.server;
    const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    const savedById = new Map((Array.isArray(saved) ? saved : []).filter((entry) => Number.isInteger(entry?.id)).map((entry) => [entry.id, entry]));
    const found = new Map();
    for (const place of mode.places.values()) {
        for (const ship of place.zone.world.ships) {
            const id = ship.alive ? squadIdOf(ship) : null;
            if (id === null) continue;
            // A squad is in one place: ships of its found anywhere else are not counted as its.
            const entry = found.get(id) ?? { place, ships: [], faction: ship.faction };
            if (entry.place !== place) continue;
            entry.ships.push(ship);
            found.set(id, entry);
        }
    }
    return [...found].map(([id, entry]) => {
        const data = savedById.get(id) ?? {};
        const squad = new Squad({
            id,
            faction: entry.faction,
            ships: entry.ships,
            place: entry.place,
            readyAt: time + finite(data.readyIn, mode.jumpCooldown),
            committedUntil: Number.isFinite(data.committedIn) ? time + data.committedIn : -Infinity,
        });
        if (data.jump && mode.map.has(data.jump.to) && mode.map.areNeighbours(entry.place.planet.id, data.jump.to)) {
            squad.jump = { to: data.jump.to, left: Math.max(0, finite(data.jump.left, 0)) };
        }
        return squad;
    }).sort((a, b) => a.id - b.id);
}
