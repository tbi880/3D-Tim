/**
 * What the battle royale's rules (BattleRoyaleMode, on the host) and its presenter
 * (BattleRoyalePresenter, on every device) say to each other, beyond the match state.
 */

/** Requests a player's device may make (`client.request(name, data)`). */
export const BR_REQUEST = Object.freeze({
    /** { to: planetId } */
    JUMP: 'jump',
    /** { added: { rating: levels } } - spend refit points */
    REFIT: 'refit',
    /** {} - call reinforcements */
    SUMMON: 'summon',
    /** { at: planetId } - come back, after being shot down, at the station of a planet the player's side holds */
    RESPAWN: 'respawn',
    /** {} - clamp on to the station's dock (the ship must be at its mouth), and let go again */
    DOCK: 'dock',
    UNDOCK: 'undock',
    /** { item: EQUIPMENT } - spend a choice of equipment */
    PICK: 'pick',
    /** { to: planetId } - launch a beacon at a neighbouring planet */
    BEACON: 'beacon',
});

/** Things the rules announce (WORLD_EVENT.MODE entries). */
export const BR_EVENT = Object.freeze({
    /** { to, seconds } - the player's jump drive is spooling up */
    JUMP_SPOOL: 'jumpSpool',
    /** { reason: JUMP_REFUSAL } */
    JUMP_REFUSED: 'jumpRefused',
    /** { to } - the player has arrived */
    JUMPED: 'jumped',
    /** { planet, status } - a planet started falling in, or was swallowed */
    COLLAPSE: 'collapse',
    /** { planet, faction } - a side took the planet the player is at */
    CAPTURED: 'captured',
    /** { points, summons } */
    REWARD: 'reward',
    /** { planet } - the player's side took a planet and brought them back there */
    REVIVED: 'revived',
    /** { planet } - the player came back at a station of their side's */
    RESPAWNED: 'respawned',
    /** { reason: RESPAWN_REFUSAL } */
    RESPAWN_REFUSED: 'respawnRefused',
    /** { faction } - the player has been firing on their own side */
    WARNING: 'warning',
    /** { former } - the player is a pirate now */
    BRANDED: 'branded',
    /** { seconds } - the player's ship has clamped on to the station */
    DOCKED: 'docked',
    /** { reason: DOCK_END } - and has let go, or was made to */
    UNDOCKED: 'undocked',
    /** { reason: DOCK_REFUSAL } */
    DOCK_REFUSED: 'dockRefused',
    /** { planet, faction } - somebody is docked at a station the player's side holds */
    STATION_ALARM: 'stationAlarm',
    /** { planet, faction } - a station the player's side held has been taken */
    STATION_LOST: 'stationLost',
    /** { picks } - the player may choose equipment */
    PICKS: 'picks',
    /** { item } - a piece of the player's equipment has come on by itself */
    EQUIPMENT_USED: 'equipmentUsed',
    /** { planet } - the player's beacon has reached a planet */
    BEACON_SET: 'beaconSet',
});

export const JUMP_REFUSAL = Object.freeze({
    NO_SHIP: 'noShip',
    SPOOLING: 'spooling',
    NOT_ADJACENT: 'notAdjacent',
    CHARGING: 'charging',
    TRAPPED: 'trapped',
});

export const DOCK_REFUSAL = Object.freeze({
    NO_SHIP: 'noShip',
    /** Not at the mouth of the dock. */
    TOO_FAR: 'tooFar',
    /** The player's own side holds the station already. */
    HELD: 'held',
    /** The jump drive is spooling up. */
    JUMPING: 'jumping',
});

/** Why a docking ended before the station was taken. */
export const DOCK_END = Object.freeze({
    /** The pilot let go. */
    RELEASED: 'released',
    /** Somebody else took the station first. */
    TAKEN: 'taken',
});

/** Why a pilot cannot come back where they asked to. */
export const RESPAWN_REFUSAL = Object.freeze({
    /** Their ship is still flying (or they are out of the match). */
    FLYING: 'flying',
    /** Their wait is not over yet. */
    WAITING: 'waiting',
    /** Their side does not hold that planet's station (any more). */
    NOT_HELD: 'notHeld',
    /** Another side is docked at it, taking it: nobody comes back there until that is settled. */
    CONTESTED: 'contested',
});
