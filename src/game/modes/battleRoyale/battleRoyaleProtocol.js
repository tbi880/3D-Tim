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
    /** { choice: VOTE } */
    VOTE: 'vote',
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
    /** { planet } - the player's side brought them back */
    REVIVED: 'revived',
    /** { faction } - the player has been firing on their own side */
    WARNING: 'warning',
    /** { former } - the player is a pirate now */
    BRANDED: 'branded',
});

export const JUMP_REFUSAL = Object.freeze({
    NO_SHIP: 'noShip',
    SPOOLING: 'spooling',
    NOT_ADJACENT: 'notAdjacent',
    CHARGING: 'charging',
    TRAPPED: 'trapped',
});

/** After taking a planet: bring the side's fallen pilots back, or take the reward. */
export const VOTE = Object.freeze({ REVIVE: 'revive', REWARD: 'reward' });
