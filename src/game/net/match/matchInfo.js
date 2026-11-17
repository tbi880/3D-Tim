import { DEFAULT_PLAYER_SHIP, isPlayerShip } from '../../config/playerShips.js';
import { mergeUpgrades } from '../../core/refit.js';

const MAX_NAME_LENGTH = 24;
const MAX_SETTINGS = 12;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/**
 * Turns the lobby server's announcement of a match (LanMatchStartDTO) into what the game
 * plays: every id checked against the game's own tables, with a safe default for anything
 * it does not know. The server only promises that ids look like ids; what they mean is
 * decided here, the same way on every device. What the mode's `settings` mean is the
 * mode's business (see modes/index.js).
 *
 * @param {object} start { matchId, seed, hostPlayerId, mode, settings, players: [{ playerId, displayName, shipClassId, loadout }] }
 * @returns {{ matchId: string, seed: number, hostPlayerId: string, mode: string, settings: Record<string, string>,
 *            players: { id: string, name: string, classId: string, upgrades: object, equipment: string[] }[] }}
 */
export function normalizeMatchInfo(start) {
    const players = Array.isArray(start?.players) ? start.players : [];
    return {
        matchId: String(start?.matchId ?? ''),
        seed: Number.isInteger(start?.seed) ? start.seed : 1,
        hostPlayerId: String(start?.hostPlayerId ?? ''),
        // Every player, the best host first; a lobby server that does not say leaves the host and then the rest.
        succession: cleanSuccession(start?.succession, String(start?.hostPlayerId ?? ''), players),
        mode: IDENTIFIER.test(start?.mode ?? '') ? start.mode : '',
        settings: cleanSettings(start?.settings),
        players: players.map((player) => {
            const classId = isPlayerShip(player?.shipClassId) ? player.shipClassId : DEFAULT_PLAYER_SHIP;
            return {
                id: String(player?.playerId ?? ''),
                name: String(player?.displayName ?? '').slice(0, MAX_NAME_LENGTH) || 'Pilot',
                classId,
                // Refit levels from the player's account, capped the way a refit in the campaign is.
                upgrades: mergeUpgrades(classId, {}, cleanUpgrades(player?.loadout?.upgrades)),
                // Reserved for extra equipment; nothing reads it yet.
                equipment: Array.isArray(player?.loadout?.equipment) ? player.loadout.equipment.filter((id) => typeof id === 'string') : [],
            };
        }),
    };
}

/**
 * The order in which devices take the match over: every player exactly once, starting with
 * the host. Whatever the lobby server sent that is not a player of this match is dropped,
 * and whoever it left out is added at the end.
 */
function cleanSuccession(order, hostPlayerId, players) {
    const ids = players.map((player) => String(player?.playerId ?? ''));
    const listed = Array.isArray(order) ? order.filter((id) => typeof id === 'string' && ids.includes(id)) : [];
    return [...new Set([hostPlayerId, ...listed, ...ids])].filter((id) => ids.includes(id));
}

function cleanSettings(settings) {
    const cleaned = {};
    if (!settings || typeof settings !== 'object') return cleaned;
    for (const [key, value] of Object.entries(settings).slice(0, MAX_SETTINGS)) {
        if (IDENTIFIER.test(key) && typeof value === 'string' && IDENTIFIER.test(value)) cleaned[key] = value;
    }
    return cleaned;
}

/** Refit levels as whole numbers of 1..10 per rating; anything else is dropped. */
export function cleanUpgrades(upgrades) {
    const cleaned = {};
    if (!upgrades || typeof upgrades !== 'object') return cleaned;
    for (const [rating, levels] of Object.entries(upgrades)) {
        if (Number.isInteger(levels) && levels > 0) cleaned[rating] = Math.min(levels, 10);
    }
    return cleaned;
}
