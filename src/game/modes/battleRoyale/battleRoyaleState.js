import { PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { RATING_ORDER } from '../../config/playerShips.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { LOYALTY } from './allegiance.js';
import { PLANET_STATUS } from './collapse.js';
import { EQUIPMENT, EQUIPMENT_ORDER } from './equipment.js';

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
 *   skip: {               while the introduction is on (else null): it ends early once every player has asked to skip it
 *     voted, voters,      how many players have asked, of how many (the computer-flown ones are not asked)
 *     you,                whether this player has
 *   },
 *   finalStand,           seconds left of the last planet's stand, or null before it
 *   out: [faction],       the sides that are out (every pilot of theirs was down at once)
 *   you: {
 *     faction,            the side this player is on now (it changes if they turn pirate)
 *     planet,             where they are
 *     alive,
 *     points, summons,    refit points and calls for reinforcements not yet used
 *     upgrades,           { rating: levels } installed on their ship
 *     loyalty,            LOYALTY
 *     jump: { cooldown, to, spool, trapped, reach },   seconds until the drive is charged; the jump in progress;
 *                         stuck on a swallowed planet; orbits the next jump can cross (jumpChoice says what
 *                         a jump to a planet would be)
 *     dock,               the station where they are: { ready, left, seconds } - can they clamp on; seconds
 *                         left of a docking in progress (else null) out of `seconds`; null while they have no ship
 *     picks,              pieces of equipment they may still choose
 *     equipment,          { item: count } they carry (equipment.js)
 *     effects,            { gravityShield, emergencyShield }: seconds each is still on (0: off)
 *     respawn,            while they are down: { wait, stations, contested, falling, choose, next } - seconds
 *                         until they may come back (0: now); the planets whose stations their side holds and may
 *                         come back to, the one they would be sent to first; those their side holds but
 *                         another side is docked at, taking them (not to be chosen); those their side holds on
 *                         a planet that will be swallowed before a new ship could jump away (not to be chosen); seconds left to choose
 *                         before they are sent (null: not counting); the wait after their next comeback.
 *                         Null while they fly.
 *     out,                whether their side is out of the match (they do not come back)
 *     watching,           while they are down: the player id of the pilot they watch fly, or null
 *     watched: {          while they watch somebody fly: that pilot as the HUD shows them in place of the
 *                         player's own ship (whose instruments come with the snapshots), else null:
 *       id, planet,       who, and where they fly
 *       upgrades,         { rating: levels } installed on their ship
 *       jump,             their jump drive, as `jump` above
 *       dock,             a docking of theirs in progress: { left, seconds }, else null
 *       equipment, effects,   what they carry and which of it is on, as above
 *     },
 *     team: [{            their comrades (the pirates are comrades too):
 *       id, name, classId, bot,
 *       planet,           where they fly, or null while they are down
 *       alive,
 *       hull, shield,     percent (0 while down)
 *       docking,          clamped on to a station, taking it
 *       wait,             while down: seconds until they may come back (0: they may), null if they cannot
 *     }],
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
 *   players: [{ id, name, classId, bot, faction, alive, score, kills, deaths }],   `bot`: computer-flown
 * }
 */

const PLANET_IDS = new Set(STAR_SYSTEM.planets.map((planet) => planet.id));
const oneOf = (allowed, value, fallback) => (allowed.includes(value) ? value : fallback);
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const seconds = (value) => (Number.isFinite(value) ? Math.max(0, value) : null);
const planetId = (value) => (PLANET_IDS.has(value) ? value : null);
const sideOrNull = (value) => (PLAYER_FACTIONS.includes(value) ? value : null);
/** Real planet ids only, each once, in the order sent. */
const planetList = (value) => (Array.isArray(value) ? [...new Set(value.slice(0, 16).map(planetId).filter(Boolean))] : []);

const cleanUpgrades = (raw) => Object.fromEntries(RATING_ORDER.map((rating) => [rating, count(raw?.[rating])]));
const cleanJump = (raw) => ({
    cooldown: seconds(raw?.cooldown) ?? 0,
    to: planetId(raw?.to),
    spool: seconds(raw?.spool),
    trapped: Boolean(raw?.trapped),
    reach: Math.max(1, count(raw?.reach)),
});
const cleanEquipment = (raw) => Object.fromEntries(EQUIPMENT_ORDER.map((item) => [item, count(raw?.[item])]));
const cleanEffects = (raw) => ({ gravityShield: count(raw?.gravityShield), emergencyShield: count(raw?.emergencyShield) });

/** The pilot a player who is down watches (`you.watched`), or null. */
function cleanWatched(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    const dock = raw.dock && typeof raw.dock === 'object' && seconds(raw.dock.left) !== null
        ? { left: seconds(raw.dock.left), seconds: Math.max(1, seconds(raw.dock.seconds) ?? 1) }
        : null;
    return {
        id: raw.id.slice(0, 64),
        planet: planetId(raw.planet),
        upgrades: cleanUpgrades(raw.upgrades),
        jump: cleanJump(raw.jump),
        dock,
        equipment: cleanEquipment(raw.equipment),
        effects: cleanEffects(raw.effects),
    };
}

function cleanYou(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const upgrades = cleanUpgrades(raw.upgrades);
    const respawn = raw.respawn && typeof raw.respawn === 'object'
        ? {
            wait: seconds(raw.respawn.wait) ?? 0,
            stations: planetList(raw.respawn.stations),
            contested: planetList(raw.respawn.contested),
            falling: planetList(raw.respawn.falling),
            choose: seconds(raw.respawn.choose),
            next: seconds(raw.respawn.next) ?? 0,
        }
        : null;
    return {
        faction: oneOf(PLAYER_FACTIONS, raw.faction, PLAYER_FACTIONS[0]),
        planet: planetId(raw.planet),
        alive: Boolean(raw.alive),
        points: count(raw.points),
        summons: count(raw.summons),
        upgrades,
        loyalty: oneOf(Object.values(LOYALTY), raw.loyalty, LOYALTY.TRUSTED),
        jump: cleanJump(raw.jump),
        dock: raw.dock && typeof raw.dock === 'object'
            ? { ready: Boolean(raw.dock.ready), left: seconds(raw.dock.left), seconds: Math.max(1, seconds(raw.dock.seconds) ?? 1) }
            : null,
        picks: count(raw.picks),
        equipment: cleanEquipment(raw.equipment),
        effects: cleanEffects(raw.effects),
        respawn,
        out: Boolean(raw.out),
        watching: typeof raw.watching === 'string' ? raw.watching.slice(0, 64) : null,
        // Only while they are down, and only the one they watch.
        watched: !raw.alive && typeof raw.watching === 'string' && raw.watched?.id === raw.watching ? cleanWatched(raw.watched) : null,
        team: Array.isArray(raw.team) ? raw.team.slice(0, 16).filter((mate) => mate && typeof mate === 'object').map(cleanTeammate) : [],
    };
}

const percent = (value) => Math.min(100, count(value));

function cleanTeammate(raw) {
    return {
        id: String(raw.id ?? '').slice(0, 64),
        name: String(raw.name ?? '').slice(0, 40),
        classId: String(raw.classId ?? '').slice(0, 40),
        bot: Boolean(raw.bot),
        planet: planetId(raw.planet),
        alive: Boolean(raw.alive),
        hull: percent(raw.hull),
        shield: percent(raw.shield),
        docking: Boolean(raw.docking),
        wait: raw.alive ? null : seconds(raw.wait),
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
        skip: seconds(raw.intro) !== null && raw.skip && typeof raw.skip === 'object'
            ? { voted: count(raw.skip.voted), voters: count(raw.skip.voters), you: Boolean(raw.skip.you) }
            : null,
        finalStand: seconds(raw.finalStand),
        out: Array.isArray(raw.out) ? [...new Set(raw.out.map(sideOrNull).filter(Boolean))] : [],
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
            bot: Boolean(player?.bot),
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

/**
 * The headline (an i18n key) for a pilot whose wait is over but who has no station to choose
 * (`you.respawn`, its `stations` empty): every one their side holds is being taken, or about to
 * be swallowed, or some of each.
 */
export function respawnBlockedKey(respawn) {
    if (respawn.falling.length === 0) return 'mp.respawn.allContested';
    return respawn.contested.length === 0 ? 'mp.respawn.allFalling' : 'mp.respawn.allBlocked';
}

/**
 * What a jump to a planet `orbits` away would be for the player (`you` of the match state):
 * null when no jump of theirs reaches it; otherwise `{ overdrive, block }`. `overdrive` when it
 * would burn their overdrive chip: a jump across more than the next orbit, or any jump while
 * the drive is still charging (the chip does not wait for the charge, and leaves it as it was).
 * `block` is why they cannot go right now (an i18n key and its numbers), or null. The host has
 * the last word (BattleRoyaleMode.jumpRefusal); this is what the map shows.
 */
export function jumpChoice(you, orbits) {
    if (orbits < 1 || orbits > you.jump.reach) return null;
    const chip = you.equipment[EQUIPMENT.OVERDRIVE] > 0;
    const charging = you.jump.cooldown > 0;
    let block = null;
    if (!you.alive) block = { key: 'mp.jump.refused.noShip' };
    else if (you.jump.to) block = { key: 'mp.jump.refused.spooling' };
    else if (you.jump.trapped) block = { key: 'mp.hud.jumpTrapped' };
    else if (charging && !chip) block = { key: 'mp.hud.jumpCharging', params: { seconds: you.jump.cooldown } };
    return { overdrive: orbits > 1 || (charging && chip), block };
}

/**
 * How a jump drive reads on the HUD (`jump` and `equipment` of the player's state, or of the
 * pilot they watch), in the words of `t` (i18n): spooling up for a planet, stuck, charging (and
 * whether an overdrive chip could go anyway), or charged.
 */
export function jumpStatusText(t, jump, equipment) {
    if (jump.to) return t('mp.hud.jumpSpooling', { planet: t(`mp.planet.${jump.to}`) });
    if (jump.trapped) return t('mp.hud.jumpTrapped');
    if (jump.cooldown > 0) return t(equipment[EQUIPMENT.OVERDRIVE] > 0 ? 'mp.hud.jumpChargingChip' : 'mp.hud.jumpCharging', { seconds: jump.cooldown });
    return t('mp.hud.jumpReady');
}

/**
 * The refits on a ship (`{ rating: levels }`) as one short line in the words of `t` ("Speed +2 ·
 * Shields +1"; a rating and its level never split over two lines), or '' when it has none.
 */
export function upgradesText(t, upgrades) {
    return RATING_ORDER.filter((rating) => upgrades[rating] > 0).map((rating) => `${t(`ui.rating.${rating}`)}\u00a0+${upgrades[rating]}`).join(' · ');
}

/**
 * The pilot the player watches fly while they are down, with their name, ship, side and score
 * from the roster: what the HUD shows in place of the player's own ship. Null while the player
 * flies or watches nobody - or before the host has said anything about the one they watch.
 */
export function watchedPilot(state) {
    const watched = state?.you?.watched;
    if (!watched || state.you.alive) return null;
    const player = state.players.find((entry) => entry.id === watched.id);
    if (!player) return null;
    const { name, classId, faction, bot, score, kills } = player;
    return { ...watched, name, classId, faction, bot, score, kills };
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
