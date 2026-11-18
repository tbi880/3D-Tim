import { GAME_EVENTS } from '../../core/EventBus.js';
import { World } from '../../core/World.js';
import { SnapshotEncoder } from '../codec/snapshotPacket.js';
import { WORLD_EVENT } from '../protocol.js';
import { describeProjectile, describeShip } from '../match/replication.js';

const round = (value) => Math.round(value * 10) / 10;

/**
 * One place of a match: a World of its own, and the record of what happens in it for the
 * players who are there. A match may have one zone (an arena) or many (the planets of a
 * star system); a player is in - and is told about - exactly one at a time.
 *
 * A zone nobody is watching stands still: the server does not simulate it.
 */
export class Zone {
    /**
     * @param {string} id
     * @param {string} sectorId backdrop and start point (config/sectors.js)
     * @param {object} [options]
     * @param {number} [options.seed] for the world's random numbers
     * @param {object} [options.difficulty] damage scaling profile (see DIFFICULTY in config/gameConfig.js)
     * @param {boolean} [options.friendlyFire] players can hurt their own side's computer-flown ships
     */
    constructor(id, sectorId, { seed = 1, difficulty = null, friendlyFire = false } = {}) {
        this.id = id;
        this.sectorId = sectorId;
        this.world = new World({ seed });
        if (difficulty) this.world.difficulty = difficulty;
        this.world.friendlyFire = friendlyFire;
        this.world.setSector(sectorId);
        /** The pilots who are here (alive or watching their wreck). */
        this.viewers = new Set();
        /** This frame's events for everybody here (already JSON). */
        this.frameEvents = [];
        /** Serials of the sector's rocks that are no longer there (shot, rammed, or cleared away). */
        this.destroyedRocks = [];
        this.encoder = new SnapshotEncoder();
        this.captured = false;
        this.unsubscribe = [];
    }

    get active() {
        return this.viewers.size > 0;
    }

    /** Records an event for everybody in the zone. */
    share(...entry) {
        this.frameEvents.push(JSON.stringify(entry));
    }

    /** Takes a rock out of the zone without a bang: something is being built where it was. */
    clearRock(rock) {
        if (!rock.alive) return;
        rock.alive = false;
        this.destroyedRocks.push(rock.serial);
    }

    /**
     * Starts recording the world's events for the players here.
     * @param {object} hooks what the server itself wants to hear about
     * @param {(zone: Zone, ship: object, killer: object | null, weapon: object | null) => void} hooks.onShipDestroyed
     *        `weapon`: the definition of the weapon that did it (config/weapons.js), if one did
     * @param {(zone: Zone, ship: object, speed: number) => void} hooks.onPlayerCollision
     */
    listen({ onShipDestroyed, onPlayerCollision }) {
        const { world } = this;
        const on = (type, listener) => this.unsubscribe.push(world.events.on(type, listener));

        on(GAME_EVENTS.SHIP_SPAWNED, ({ ship }) => this.share(WORLD_EVENT.SPAWN, describeShip(ship)));
        on(GAME_EVENTS.SHIP_REMOVED, ({ ship, flash }) => this.share(WORLD_EVENT.REMOVE, ship.id, flash ? 1 : 0));
        on(GAME_EVENTS.SHIP_DESTROYED, ({ ship, killer, weapon }) => {
            this.share(WORLD_EVENT.DESTROY, ship.id, killer?.id ?? 0);
            onShipDestroyed(this, ship, killer ?? null, weapon ?? null);
        });
        on(GAME_EVENTS.HIT, ({ target, position, shield, amount }) => {
            this.share(WORLD_EVENT.HIT, target?.id ?? 0, round(position.x), round(position.y), round(position.z), shield ? 1 : 0, round(amount));
        });
        on(GAME_EVENTS.WEAPON_FIRED, (fired) => this.share(WORLD_EVENT.FIRE, describeProjectile(fired)));
        on(GAME_EVENTS.PROJECTILE_REMOVED, ({ projectile, exploded }) => {
            const { position } = projectile;
            this.share(WORLD_EVENT.PROJECTILE_GONE, projectile.id, exploded ? 1 : 0, round(position.x), round(position.y), round(position.z));
        });
        on(GAME_EVENTS.OBSTACLE_DESTROYED, ({ obstacle }) => {
            this.destroyedRocks.push(obstacle.serial);
            this.share(WORLD_EVENT.ROCK, obstacle.serial);
        });
        on(GAME_EVENTS.LANCE_CHARGING, ({ ship, weapon }) => this.share(WORLD_EVENT.LANCE, ship.id, ship.weapons.indexOf(weapon), 0));
        on(GAME_EVENTS.LANCE_FIRING, ({ ship, weapon }) => this.share(WORLD_EVENT.LANCE, ship.id, ship.weapons.indexOf(weapon), 1));
        on(GAME_EVENTS.ABILITY, ({ ship, ability, phase, position, radius }) => {
            if (position) this.share(WORLD_EVENT.ABILITY, ship?.id ?? 0, ability, phase, round(position.x), round(position.y), round(position.z), radius);
            else this.share(WORLD_EVENT.ABILITY, ship?.id ?? 0, ability, phase);
        });
        on(GAME_EVENTS.PLAYER_COLLISION, ({ ship, speed }) => onPlayerCollision(this, ship, round(speed)));
    }

    /** Everything a client needs to build this zone as it stands. */
    describe() {
        return {
            zoneId: this.id,
            sectorId: this.sectorId,
            time: this.world.time,
            ships: this.world.ships.filter((ship) => ship.alive).map(describeShip),
            rocks: this.destroyedRocks,
        };
    }

    dispose() {
        for (const off of this.unsubscribe) off();
        this.unsubscribe = [];
    }
}
