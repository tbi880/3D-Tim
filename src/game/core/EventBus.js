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
    /** { ship } - removed without an explosion (warped out / despawned) */
    SHIP_REMOVED: 'shipRemoved',
    /** { position, size, color? } */
    EXPLOSION: 'explosion',
    /** { target, position, shield: boolean, amount } */
    HIT: 'hit',
    /** { ship, weapon, kind: 'bolt' | 'torpedo' } */
    WEAPON_FIRED: 'weaponFired',
    /** { position, size, quaternion? } - a ship dropped out of / jumped into warp here */
    WARP_FLASH: 'warpFlash',
    /** { position, radius } - an asteroid was blown apart */
    OBSTACLE_DESTROYED: 'obstacleDestroyed',
    /** { ship, weapon } - a lance started charging */
    LANCE_CHARGING: 'lanceCharging',
    /** { ship, weapon } */
    LANCE_FIRING: 'lanceFiring',
    /** { speed } - the player ran into something solid */
    PLAYER_COLLISION: 'playerCollision',
    /** { target } - the player's lock changed (target may be null) */
    TARGET_CHANGED: 'targetChanged',
    /** { sectorId } - the world moved to another sector; positions from the old one mean nothing now */
    SECTOR_CHANGED: 'sectorChanged',
    /** {} - the player tried to fire with an empty capacitor / no torpedoes */
    WEAPON_EMPTY: 'weaponEmpty',
});
