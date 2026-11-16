/**
 * Central tuning values for "Echoes of Dawn".
 *
 * Everything a designer may want to tweak (speeds, energy, difficulty, storage keys)
 * lives here or in the sibling config files, so gameplay code never hard-codes numbers.
 * World units are roughly metres; time is in seconds; angles are in radians unless a
 * property name ends in "Deg".
 */

export const FACTION = Object.freeze({
    DAWN: 'dawn',
    UMBRA: 'umbra',
    NEUTRAL: 'neutral',
    /** Multiplayer only: players with no side, at war with everyone including each other. */
    PIRATE: 'pirate',
});

/** Player ship handling. */
export const PLAYER = Object.freeze({
    classId: 'kestrel',
    pitchRate: 1.15,
    yawRate: 1.0,
    rollRate: 1.9,
    /** How quickly the ship reaches the requested turn rate (1/s). */
    turnResponse: 5,
    /** Throttle change per second while W / S is held. */
    throttleRate: 0.75,
    acceleration: 110,
    /** How quickly the velocity vector follows the nose (1/s). Lower = more drift. */
    driftDamping: 2.6,
    boostMultiplier: 2.4,
    /** Seconds of afterburner in a full tank, and seconds to refill it from empty. */
    boostDuration: 14,
    boostRecharge: 10,
    energyMax: 100,
    energyRegen: 16,
    /** Seconds without firing before the beam capacitor recharges at full rate. */
    energyRegenDelay: 0.6,
    startThrottle: 0.5,
    /** Checkpoints always hand the ship back with at least this hull fraction. */
    checkpointMinHull: 0.75,
    /** ...and allied capital ships (the Dawnbreaker, the frigates) with at least this much. */
    checkpointMinAllyHull: 0.5,
});

/** "Divert power" presets, switched with the 1 / 2 / 3 keys. */
export const POWER_MODES = Object.freeze({
    balanced: { id: 'balanced', damage: 1, shieldRegen: 1, damageTaken: 1, engine: 1 },
    attack: { id: 'attack', damage: 1.35, shieldRegen: 0.55, damageTaken: 1.1, engine: 0.95 },
    defense: { id: 'defense', damage: 0.75, shieldRegen: 1.9, damageTaken: 0.75, engine: 1.1 },
});
export const POWER_MODE_ORDER = ['balanced', 'attack', 'defense'];

/**
 * Difficulty scales both fleets, never the story: every beat, wave and timer is identical.
 * Everything is applied while the game runs (not when ships spawn), so the setting can be
 * changed mid-mission and saved games stay valid.
 *
 *   damageTaken      - damage the player's ship takes
 *   allyDamageTaken  - damage other Dawn ships take
 *   enemyToughness   - how much punishment Umbra hulls and shields soak up (2 = twice as much)
 *   enemyFireRate    - how often Umbra guns and torpedo tubes fire
 *   enemyBeamDamage  - damage of Umbra continuous beams (they have no "rate" to scale)
 *   allyDamage       - damage dealt by Dawn ships other than the player
 *   shieldRegen      - recharge rate of the player's shields
 *   allyDamageVsShips - optional, replaces ALLIES.damageVsShips (multiplayer sets it to 1:
 *                       there both fleets fight each other for real)
 */
export const DIFFICULTY = Object.freeze({
    cadet: {
        id: 'cadet', damageTaken: 0.45, allyDamageTaken: 0.5,
        enemyToughness: 0.7, enemyFireRate: 0.7, enemyBeamDamage: 0.7, allyDamage: 1.5, shieldRegen: 1.5,
    },
    captain: {
        id: 'captain', damageTaken: 1, allyDamageTaken: 0.8,
        enemyToughness: 1, enemyFireRate: 1, enemyBeamDamage: 1, allyDamage: 1, shieldRegen: 1,
    },
    admiral: {
        id: 'admiral', damageTaken: 1.55, allyDamageTaken: 1.1,
        enemyToughness: 1.65, enemyFireRate: 1.5, enemyBeamDamage: 1.4, allyDamage: 0.75, shieldRegen: 0.65,
    },
});
/**
 * Dawn ships other than the player. They carry the story, draw fire and harass Umbra, but the
 * kills are the player's: against Umbra *ships* they only chip (`damageVsShips`), while station
 * parts the story needs destroyed (generators, reactors, emitters, gun batteries) take full damage.
 * Multiplies with the difficulty's `allyDamage`.
 */
export const ALLIES = Object.freeze({
    damageVsShips: 0.3,
});

export const DIFFICULTY_ORDER = ['cadet', 'captain', 'admiral'];
export const DEFAULT_DIFFICULTY = 'captain';

export const WORLD = Object.freeze({
    /** Soft edge of every sector; past it the helm is nudged back towards the centre. */
    arenaRadius: 12000,
    /** Base length (seconds) of a ship's warp-in; scaled up for large ships. */
    warpInSeconds: 1.1,
    /** Longest simulation step. Larger frame gaps (tab switch) are clamped to this. */
    maxStep: 1 / 20,
    /** Minimum seconds between two "hit" effect events from continuous beams on one target. */
    beamHitEffectInterval: 0.14,
});

/** Timing shared by the pieces of a big ship's death (explosions and the hull that stays visible). */
export const EFFECTS = Object.freeze({
    /** Seconds a destroyed capital ship's hull stays on screen, breaking up, before the main blast. */
    breakupSeconds: 6,
    /** The same for the very largest hulls (dreadnought, shipyard). */
    hugeBreakupSeconds: 10,
    /** How far (radians) a dying hull has rolled by the time it finally explodes. */
    breakupTumble: 0.85,
    /** Explosion size (metres) above which a hull counts as "very largest". */
    hugeExplosionSize: 600,
});

export const TARGETING = Object.freeze({
    /** Max distance at which the player can lock a target. */
    lockRange: 14000,
    /** Half-angle (deg) used by "target nearest to crosshair". */
    crosshairConeDeg: 25,
    /** The same for locking a ship of one's own side (multiplayer friendly fire): it has to be dead ahead. */
    friendlyConeDeg: 4,
});

export const STORAGE_KEYS = Object.freeze({
    save: 'echoesOfDawn.save.v1',
    settings: 'echoesOfDawn.settings.v1',
    bestScore: 'echoesOfDawn.bestScore.v1',
    /** The name the player goes by in multiplayer. */
    pilotName: 'echoesOfDawn.pilotName.v1',
});

/** Music tracks reuse the site's existing soundtrack (served from the asset bucket). */
export const MUSIC_TRACKS = Object.freeze({
    calm: 'music/bgm2.mp3',
    battle: 'music/bgm6.mp3',
    finale: 'music/bgm5.mp3',
});

/** How often (seconds) the React HUD receives a fresh snapshot of the simulation. */
export const HUD_REFRESH_INTERVAL = 0.1;

/**
 * Ceilings for the big fleet battles (the Barrens chapters), so a melee of carriers, cruisers
 * and two fleets stays inside what the renderer can draw smoothly: every ship is at least two
 * draw calls plus its exhaust and shield, and every gun adds projectiles. Reinforcement waves
 * wait until the sector is back under both limits (`underBattleBudget` in story/campaign.js).
 */
export const BATTLE = Object.freeze({
    /** Ships of every faction in the sector, mounted modules included. */
    maxShips: 48,
    /** Umbra fighters, bombers and drones in the air at once. */
    maxHostileFighters: 7,
});
