import { PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { RATING_ORDER } from '../../config/playerShips.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { LOYALTY } from './allegiance.js';
import { VOTE } from './battleRoyaleProtocol.js';
import { PLANET_STATUS } from './collapse.js';
import { EQUIPMENT_ORDER } from './equipment.js';

/**
 * The battle royale's match state, as each player's device receives it (built by
 * BattleRoyaleMode.describeState; this file is its description and its check).
 *
 * {
 *   mode: 'battleRoyale', matchId,
 *   phase,                MATCH_PHASE
 *   winner,               the winning side once the match is over, or null (nobody won)
 *   time,                 seconds played
 *   intro,                seconds of introduction left (nobody is in the system yet), or null once it is over
 *   finalStand,           seconds left of the last planet's stand, or null before it
 *   you: {
 *     faction,            the side this player is on now (it changes if they turn pirate)
 *     planet,             where they are
 *     alive,
 *     points, summons,    refit points and calls for reinforcements not yet used
 *     upgrades,           { rating: levels } installed on their ship
 *     loyalty,            LOYALTY
 *     jump: { cooldown, to, spool, trapped, reach },   seconds until the drive is charged; the jump in progress;
 *                         stuck on a swallowed planet; orbits the next jump can cross
 *     dock,               the station where they are: { ready, left, seconds } - can they clamp on; seconds
 *                         left of a docking in progress (else null) out of `seconds`; null while they have no ship
 *     picks,              pieces of equipment they may still choose
 *     equipment,          { item: count } they carry (equipment.js)
 *     effects,            { gravityShield, emergencyShield }: seconds each is still on (0: off)
 *     vote,               { planet, endsIn, choice } while their side is choosing after taking a planet, else null
 *   },
 *   planets: [{           innermost first
 *     id, status, changesIn,
 *     known,              whether their side has eyes on the planet (a pilot there, its station, or a
 *                         beacon); if not, the next three are null
 *     owner,              the side that holds its station
 *     forces,             { dawn, umbra, pirate }: ships there, players' included
 *     docking,            a side whose ship is docked at the station right now
 *     beacon,             whether a beacon of theirs watches it
 *     comrades: [name],
 *   }],
 *   players: [{ id, name, classId, faction, alive, score, kills, deaths }],
 * }
 */

const PLANET_IDS = new Set(STAR_SYSTEM.planets.map((planet) => planet.id));
const oneOf = (allowed, value, fallback) => (allowed.includes(value) ? value : fallback);
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const seconds = (value) => (Number.isFinite(value) ? Math.max(0, value) : null);
const planetId = (value) => (PLANET_IDS.has(value) ? value : null);
const sideOrNull = (value) => (PLAYER_FACTIONS.includes(value) ? value : null);

function cleanYou(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const upgrades = {};
    for (const rating of RATING_ORDER) upgrades[rating] = count(raw.upgrades?.[rating]);
    const vote = raw.vote && typeof raw.vote === 'object'
        ? { planet: planetId(raw.vote.planet), endsIn: seconds(raw.vote.endsIn) ?? 0, choice: oneOf(Object.values(VOTE), raw.vote.choice, null) }
        : null;
    return {
        faction: oneOf(PLAYER_FACTIONS, raw.faction, PLAYER_FACTIONS[0]),
        planet: planetId(raw.planet),
        alive: Boolean(raw.alive),
        points: count(raw.points),
        summons: count(raw.summons),
        upgrades,
        loyalty: oneOf(Object.values(LOYALTY), raw.loyalty, LOYALTY.TRUSTED),
        jump: {
            cooldown: seconds(raw.jump?.cooldown) ?? 0,
            to: planetId(raw.jump?.to),
            spool: seconds(raw.jump?.spool),
            trapped: Boolean(raw.jump?.trapped),
            reach: Math.max(1, count(raw.jump?.reach)),
        },
        dock: raw.dock && typeof raw.dock === 'object'
            ? { ready: Boolean(raw.dock.ready), left: seconds(raw.dock.left), seconds: Math.max(1, seconds(raw.dock.seconds) ?? 1) }
            : null,
        picks: count(raw.picks),
        equipment: Object.fromEntries(EQUIPMENT_ORDER.map((item) => [item, count(raw.equipment?.[item])])),
        effects: { gravityShield: count(raw.effects?.gravityShield), emergencyShield: count(raw.effects?.emergencyShield) },
        vote,
    };
}

/**
 * Checks a match state received from the host. Returns a clean copy with every field of
 * the type the UI expects, or null if it is not a battle royale state at all.
 */
export function sanitizeBattleRoyaleState(raw) {
    if (!raw || typeof raw !== 'object' || raw.mode !== 'battleRoyale') return null;
    if (!Array.isArray(raw.planets) || !Array.isArray(raw.players)) return null;
    if (!Object.values(MATCH_PHASE).includes(raw.phase)) return null;
    return {
        mode: 'battleRoyale',
        matchId: String(raw.matchId ?? ''),
        phase: raw.phase,
        winner: sideOrNull(raw.winner),
        time: count(raw.time),
        intro: seconds(raw.intro),
        finalStand: seconds(raw.finalStand),
        you: cleanYou(raw.you),
        planets: raw.planets.slice(0, 16).filter((planet) => PLANET_IDS.has(planet?.id)).map((planet) => ({
            id: planet.id,
            status: oneOf(Object.values(PLANET_STATUS), planet.status, PLANET_STATUS.SAFE),
            changesIn: seconds(planet.changesIn),
            known: Boolean(planet.known),
            beacon: Boolean(planet.beacon),
            owner: planet.known ? sideOrNull(planet.owner) : null,
            forces: planet.known ? Object.fromEntries(PLAYER_FACTIONS.map((faction) => [faction, count(planet.forces?.[faction])])) : null,
            docking: planet.known ? sideOrNull(planet.docking) : null,
            comrades: Array.isArray(planet.comrades) ? planet.comrades.slice(0, 16).map((name) => String(name).slice(0, 40)) : [],
        })),
        players: raw.players.slice(0, 32).map((player) => ({
            id: String(player?.id ?? ''),
            name: String(player?.name ?? '').slice(0, 40),
            classId: String(player?.classId ?? ''),
            faction: oneOf(PLAYER_FACTIONS, player?.faction, PLAYER_FACTIONS[0]),
            alive: Boolean(player?.alive),
            score: count(player?.score),
            kills: count(player?.kills),
            deaths: count(player?.deaths),
        })),
    };
}

/** The sides with their players, in the order sides are always shown: `[{ faction, players }]`. */
export function rosterBySide(state) {
    return PLAYER_FACTIONS.map((faction) => ({ faction, players: state.players.filter((player) => player.faction === faction) }));
}

/** True when ships of more than one side are at a planet (`forces` of a planet in the match state). */
export function isBattle(forces) {
    return Boolean(forces) && Object.values(forces).filter((ships) => ships > 0).length > 1;
}

/** The winning side's players, best score first: the order of the result screen. */
export function rankWinners(state) {
    return state.players.filter((player) => player.faction === state.winner)
        .sort((a, b) => b.score - a.score || b.kills - a.kills || a.name.localeCompare(b.name));
}

/** Everybody, grouped for the scoreboard: winners first, then by score. */
export function rankPlayers(state) {
    const won = (player) => (state.winner && player.faction === state.winner ? 1 : 0);
    return [...state.players].sort((a, b) => won(b) - won(a) || b.score - a.score || b.kills - a.kills || a.name.localeCompare(b.name));
}
