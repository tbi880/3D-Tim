/**
 * Minimal publish / subscribe hub. The simulation emits gameplay events (explosions, hits,
 * kills...) and the presentation layers (3D effects, sound, HUD, story) listen to them, so
 * the core never needs to know who is watching.
 */
export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /** @returns {() => void} unsubscribe function */
    on(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
        return () => this.listeners.get(type)?.delete(listener);
    }

    emit(type, payload) {
        const listeners = this.listeners.get(type);
        if (!listeners) return;
        for (const listener of listeners) listener(payload);
    }

    clear() {
        this.listeners.clear();
    }
}

/** Every event the simulation can emit, with the payload each one carries. */
export const GAME_EVENTS = Object.freeze({
    /** { ship } */
    SHIP_SPAWNED: 'shipSpawned',
    /** { ship, killer } */
    SHIP_DESTROYED: 'shipDestroyed',
    /** { ship, flash? } - removed without an explosion (warped out / despawned); `flash` when it left with a warp flash */
    SHIP_REMOVED: 'shipRemoved',
    /** { position, size, color?, capital?, ship? } - `ship` is set when a ship (not a projectile) blew up */
    EXPLOSION: 'explosion',
    /**
     * { target, position, shield: boolean, amount, source?, weapon? } - `source` is the ship that
     * fired and `weapon` its weapon's definition, when known (not on a multiplayer guest's device).
     */
    HIT: 'hit',
    /** { ship, weapon, kind: 'bolt' | 'torpedo', projectile } */
    WEAPON_FIRED: 'weaponFired',
    /** { projectile, exploded: boolean } - a shot hit something, was shot down or ran out of fuel */
    PROJECTILE_REMOVED: 'projectileRemoved',
    /**
     * { position, size, quaternion?, ship? } - a ship dropped out of / jumped into warp here.
     * `ship` is set when it is a ship finishing its warp-in (WARP_IN_STARTED came first).
     */
    WARP_FLASH: 'warpFlash',
    /** { ship, duration } - a ship has started dropping out of warp; it lands at `ship.position` in `duration` s */
    WARP_IN_STARTED: 'warpInStarted',
    /** { position, radius, obstacle } - an asteroid was blown apart */
    OBSTACLE_DESTROYED: 'obstacleDestroyed',
    /** { ship, weapon } - a lance started charging */
    LANCE_CHARGING: 'lanceCharging',
    /** { ship, weapon } */
    LANCE_FIRING: 'lanceFiring',
    /** { speed, ship } - a player's ship ran into something solid (in multiplayer: not always the local one) */
    PLAYER_COLLISION: 'playerCollision',
    /** { target } - the local player's lock changed (target may be null) */
    TARGET_CHANGED: 'targetChanged',
    /** { sectorId } - the world moved to another sector; positions from the old one mean nothing now */
    SECTOR_CHANGED: 'sectorChanged',
    /** { ship } - a player tried to fire with an empty capacitor / no torpedoes */
    WEAPON_EMPTY: 'weaponEmpty',
});
