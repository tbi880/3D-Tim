/**
 * Points for the player's kills, and the final score shown on the ending screen.
 *
 * Only the player's own kills score: allies harass and soak fire, the player is the one who
 * gets paid. The final score adds a bonus for finishing, a bonus for every second under par,
 * takes something off for every ship lost, and scales the lot by difficulty.
 */

/** Points per kill, by ship class. Classes not listed (scenery, the Forge itself) score nothing. */
export const KILL_POINTS = Object.freeze({
    drone: 100,
    raider: 150,
    lancer: 250,
    corvette: 600,
    warden: 1000,
    eclipse: 5000,
    penumbra: 3000,
    stationTurret: 200,
    tractorEmitter: 400,
    shieldGenerator: 500,
    eclipseCannon: 400,
    reactor: 600,
});

export const FINAL_SCORE = Object.freeze({
    /** For bringing the Dawnbreaker home at all. */
    missionBonus: 5000,
    /** Seconds of story the time bonus counts down from. */
    parSeconds: 52 * 60,
    timeBonusPerSecond: 5,
    lossPenalty: 1000,
    /** The whole score is multiplied by this for the difficulty it was flown on. */
    difficultyMultiplier: Object.freeze({ cadet: 0.6, captain: 1, admiral: 1.6 }),
    /** Lowest total for each rank, best first. */
    // Raised by a third with the Barrens chapters (four carriers, two more battles).
    ranks: Object.freeze([['S', 43000], ['A', 32000], ['B', 21500], ['C', 0]]),
});

/** Points for one kill (0 for anything that does not score). */
export function killPoints(ship) {
    return KILL_POINTS[ship.classId] ?? 0;
}

/**
 * The ending screen's breakdown.
 * @param {{ time: number, kills: number, losses: number, score: number }} stats
 * @param {string} difficultyId
 */
export function computeFinalScore(stats, difficultyId) {
    const combat = Math.round(stats.score ?? 0);
    const missionBonus = FINAL_SCORE.missionBonus;
    const timeBonus = Math.round(Math.max(0, FINAL_SCORE.parSeconds - stats.time) * FINAL_SCORE.timeBonusPerSecond);
    const lossPenalty = (stats.losses ?? 0) * FINAL_SCORE.lossPenalty;
    const multiplier = FINAL_SCORE.difficultyMultiplier[difficultyId] ?? 1;
    const total = Math.round(Math.max(0, combat + missionBonus + timeBonus - lossPenalty) * multiplier);
    const rank = FINAL_SCORE.ranks.find(([, minimum]) => total >= minimum)?.[0] ?? 'C';
    return { combat, missionBonus, timeBonus, lossPenalty, multiplier, total, rank, difficultyId };
}
