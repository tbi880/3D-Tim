import { BATTLE_ROYALE, MAX_PLAYERS, STAR_SYSTEM } from '../config/battleRoyale.js';
import { PLAYER_SHIPS } from '../config/playerShips.js';
import { MATCH_ACTION, MATCH_PANEL, OUTRO_ACT } from '../modes/battleRoyale/BattleRoyalePresenter.js';
import { jumpChoice, rankPlayers, respawnBlockedKey, rosterBySide } from '../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../modes/battleRoyale/collapse.js';
import { EQUIPMENT, EQUIPMENT_ORDER } from '../modes/battleRoyale/equipment.js';
import { LAN_STATUS, LOBBY_SCOPE, ROOM_STATE, ROOM_VISIBILITY } from '../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../net/lobby/lanStore.js';
import { MATCH_PHASE } from '../net/match/matchState.js';
import { LINK_STATUS } from '../net/transport/PeerLink.js';
import { PHASE } from '../state/GameSession.js';
import { matchMenuPlace } from './menuPlacement.js';
import { exitVR } from './vrState.js';
import { drawStarMap, respawnMarks } from './vrStarMap.js';

/**
 * Multiplayer inside the headset: the LAN lobby, and in a match the star map (with the
 * beacon on it), the equipment, where to come back after being shot down, the menu and the
 * result. The flat page's screens for these (ui/
 * multiplayer) cannot be seen in VR; these are the same choices as rows for VRMenu, which
 * draws them and moves the selection (see there for what a row is).
 *
 * In flight a press of A opens the star map (there are no comms lines to skip in a match),
 * and keeping A down docks at a station or lets go of it.
 */

const cycle = (list, current, step) => list[(list.indexOf(current) + step + list.length) % list.length];
/** The numbers each piece of equipment's description quotes (as ui/multiplayer/EquipmentPanel.jsx). */
const EQUIPMENT_PARAMS = Object.freeze({
    [EQUIPMENT.GRAVITY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.gravityShieldSeconds },
    [EQUIPMENT.EMERGENCY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.emergencyShieldSeconds },
});
const ORBITS = STAR_SYSTEM.planets.map((planet) => planet.id);
/**
 * Rows that fit, at a comfortable height, under the star map on the menu of a pilot who is down
 * with the two lines of rules above it (xr/VRMenu.js lays the panel out); with more, the rules go.
 */
const RESPAWN_ROWS_WITH_RULES = 6;

/**
 * True while the player's ship is lost and the menu of where to come back (or of whom to
 * watch, once their side is out) is up - not while they have put it away to watch somebody fly.
 */
function isDownMenuOpen(state) {
    const you = state.match?.you;
    return Boolean(you) && !you.alive && (Boolean(you.respawn) || you.out) && !state.matchWatchView;
}

/** True when a multiplayer panel should be up over the flight view: the story, the map, where to come back once shot down. */
export function isMatchMenuOpen(state) {
    const { match } = state;
    return Boolean(match) && (match.intro != null || Boolean(state.matchOutro) || Boolean(state.matchPanel) || isDownMenuOpen(state));
}

/**
 * The multiplayer menu for the current state, or null when the game's own menus apply.
 * @param {object} game { session, sound, lan }
 * @param {object} state the game store
 * @param {(key: string, params?: object) => string} t
 * @param {{ lobbyOpen: boolean, setLobbyOpen: (open: boolean) => void, openShipPage: () => void }} view whether the player opened
 *   the LAN lobby from the VR title menu, and the way to the ship page (VRMenu.buildShipPage)
 */
export function buildMatchMenu(game, state, t, view) {
    const { session, lan } = game;
    const lanState = useLanStore.getState();
    const exitItem = { label: t('ui.vr.exit'), select: () => exitVR() };

    if (session.phase === PHASE.TITLE) {
        if (lanState.room) return lobbyRoom(game, state, lanState, t, view, exitItem);
        if (view.lobbyOpen) return lobbyBrowser(game, state, lanState, t, view, exitItem);
        return null;
    }
    const match = state.match;
    if (!match) return null;
    if (session.phase === PHASE.MATCH_OVER) return result(lan, lanState, state, t, exitItem);
    if (session.phase === PHASE.PAUSED) {
        return {
            key: 'match:menu',
            title: t('mp.pause.title'),
            lines: [t('mp.pause.note')],
            columns: t('ui.vr.controls').split(' · '),
            items: [
                { label: t('ui.resume'), select: () => session.resume() },
                { label: t('mp.pause.leave'), select: () => lan.leaveRoom() },
                exitItem,
            ],
        };
    }
    if (session.phase !== PHASE.PLAYING || !match.you) return null;
    if (state.matchOutro) return ending(state, t);
    if (match.intro != null) return introduction(match, t);
    const presenter = session.match?.presenter;
    if (!presenter) return null;
    if (state.matchPanel === MATCH_PANEL.MAP) return starMap(session, presenter, match, t);
    if (state.matchPanel === MATCH_PANEL.EQUIPMENT) return equipment(presenter, match, t);
    // Shot down: the choice of where to come back stays up until the pilot is (the map can be looked at
    // meanwhile, and it is put away to watch a comrade fly).
    if (isDownMenuOpen(state)) return respawn(presenter, match, t);
    return null;
}

// ---- The lobby --------------------------------------------------------------------------------

/**
 * The player's ship as a row: left and right change it, the trigger opens the ship page with
 * everything about it. `editable` false (the room is playing a match): it only shows.
 */
function shipRow(game, state, t, view, editable = true) {
    const { session, lan } = game;
    const ships = PLAYER_SHIPS.map((entry) => entry.classId);
    const ship = state.settings.playerShip;
    const change = (step) => () => {
        if (!editable) return;
        session.updateSettings({ playerShip: cycle(ships, ship, step) });
        lan.pushProfile();
    };
    return {
        id: 'ship', label: t('mp.lan.ship'), sub: `${t(`playerShip.${ship}.role`)} · ${t('ui.vr.shipDetails')}`, value: t(`ship.${ship}`),
        left: change(-1), right: change(1), select: () => { if (editable) view.openShipPage(); },
    };
}

function lobbyBrowser(game, state, lanState, t, view, exitItem) {
    const { lan, sound } = game;
    const global = lanState.scope === LOBBY_SCOPE.GLOBAL;
    const lines = [t('mp.lan.rules')];
    if (lanState.error) lines.push(t(lanState.error));
    if (lanState.status === LAN_STATUS.CONNECTING) lines.push(t('mp.lan.connecting'));
    const items = [];
    if (lanState.status === LAN_STATUS.OFFLINE) items.push({ label: t('mp.lan.retry'), select: () => lan.open() });
    if (lanState.status === LAN_STATUS.ONLINE && global) {
        // Anywhere: quick match or a private room. (A friend's code needs a keyboard: that is on the flat page.)
        if (lanState.matching) {
            lines.push(t('mp.global.searching'));
            items.push({ label: t('mp.global.cancel'), select: () => lan.leaveRoom() });
        } else {
            lines.push(t('mp.global.note'));
            items.push({ label: t('mp.global.quickMatch'), sub: t('mp.global.quickMatchHint'), select: () => { sound.unlock(); lan.quickMatch(); } });
            items.push({ label: t('mp.global.private'), sub: t('mp.global.privateHint'), select: () => { sound.unlock(); lan.createPrivateRoom(); } });
        }
    } else if (lanState.status === LAN_STATUS.ONLINE) {
        for (const room of lanState.rooms) {
            items.push({ label: `${t('mp.lan.join')} · ${room.hostName}`, sub: room.hostDeviceName, value: `${room.playerCount} / ${room.maxPlayers}`, select: () => lan.joinRoom(room.code) });
        }
        items.push({ label: t('mp.lan.create'), sub: lanState.rooms.length === 0 ? t('mp.lan.noRooms') : null, select: () => lan.createRoom() });
    }
    // The ship to go in with, chosen before a room is: a quick match may start soon after it is found.
    if (lanState.status === LAN_STATUS.ONLINE && !lanState.matching) items.push(shipRow(game, state, t, view));
    items.push({ label: t('ui.back'), select: () => { lan.close(); view.setLobbyOpen(false); } }, exitItem);
    return { key: `lan:browser:${lanState.scope}`, title: t(global ? 'mp.global.title' : 'mp.lan.title'), lines, items };
}

function lobbyRoom(game, state, lanState, t, view, exitItem) {
    const { lan, sound } = game;
    const { room, me, links } = lanState;
    const self = room.players.find((player) => player.playerId === me?.playerId);
    const inLobby = room.state === ROOM_STATE.LOBBY;
    // A public room starts itself, on a countdown, once everybody is ready: no start, no options for its host.
    const isPublic = room.visibility === ROOM_VISIBILITY.PUBLIC;
    const lines = [`${t(`mp.room.${room.visibility ?? ROOM_VISIBILITY.NETWORK}`)} · ${t('mp.lan.roomCode')}  ${room.code}`];
    if (isPublic && inLobby) {
        const seconds = lanState.startsAt === null ? null : Math.max(0, Math.ceil((lanState.startsAt - Date.now()) / 1000));
        lines.push(seconds !== null ? t('mp.global.startsIn', { seconds })
            : room.players.length > 1 && !Object.values(links).includes(LINK_STATUS.OPEN) ? t('mp.global.linking')
                : room.players.length > 1 && !room.players.every((player) => player.ready) ? t('mp.global.waitingReady')
                    : t('mp.global.waiting', { count: room.players.length, max: room.maxPlayers }));
        if (lan.isHost) lines.push(t('mp.global.hostNote'));
    }
    for (const player of room.players) {
        const ready = player.ready ? t('mp.lan.ready') : t('mp.lan.notReady');
        lines.push(`${player.displayName}${player.isHost ? ` (${t('mp.lan.host')})` : ''} · ${player.deviceName} · ${t(`ship.${player.shipClassId}`)} · ${ready}`);
    }
    if (lanState.error) lines.push(t(lanState.error));
    if (!inLobby) lines.push(t('mp.lan.matchRunning'));

    const items = [shipRow(game, state, t, view, inLobby)];
    // The quartermaster: one piece to take along, or none yet (it can be chosen in the match).
    const pieces = [null, ...EQUIPMENT_ORDER];
    const piece = lanState.loadout.equipment;
    const pieceRow = (step) => () => { if (inLobby) lan.setLoadout({ equipment: cycle(pieces, piece, step) }); };
    items.push({
        label: t('mp.equipment.title'),
        sub: piece ? t(`mp.equipment.${piece}.text`, EQUIPMENT_PARAMS[piece]) : t('mp.lan.loadoutLater'),
        value: piece ? t(`mp.equipment.${piece}.name`) : '—',
        left: pieceRow(-1), right: pieceRow(1), select: pieceRow(1),
    });
    if (isPublic && lan.isHost) {
        // Nothing to set, nothing to start.
    } else if (lan.isHost) {
        const paces = Object.keys(BATTLE_ROYALE.paces);
        const pace = room.settings?.pace ?? BATTLE_ROYALE.defaultPace;
        const paceRow = (step) => () => lan.setOptions({ settings: { ...room.settings, pace: cycle(paces, pace, step) } });
        items.push({ label: t('mp.lan.pace'), sub: t(`mp.lan.paceHint.${pace}`), value: t(`mp.lan.pace.${pace}`), left: paceRow(-1), right: paceRow(1), select: paceRow(1) });
        // Empty seats: taken by computer-flown players, or left empty.
        const botSettings = ['fill', 'none'];
        const bots = room.settings?.bots ?? BATTLE_ROYALE.bots.defaultSetting;
        const botsRow = (step) => () => lan.setOptions({ settings: { ...room.settings, bots: cycle(botSettings, bots, step) } });
        const seats = { count: BATTLE_ROYALE.bots.fillTo };
        items.push({ label: t('mp.lan.bots'), sub: t('mp.lan.botsHint', seats), value: t(`mp.lan.bots.${bots}`, seats), left: botsRow(-1), right: botsRow(1), select: botsRow(1) });
        items.push({
            label: t('mp.lan.start'),
            sub: lan.canStart ? null : t('mp.lan.startWaiting'),
            disabled: !lan.canStart,
            select: () => { sound.unlock(); lan.startMatch(); },
        });
    } else {
        // Linked to somebody is enough to be ready: the match is given to a device everybody reaches.
        const linked = Object.values(links).includes(LINK_STATUS.OPEN);
        items.push({
            label: self?.ready ? t('mp.lan.setNotReady') : t('mp.lan.setReady'),
            sub: linked ? t('mp.lan.waitingForHost') : t(`mp.lan.link.${Object.values(links).includes(LINK_STATUS.CONNECTING) ? LINK_STATUS.CONNECTING : LINK_STATUS.CLOSED}`),
            disabled: !inLobby || !linked,
            select: () => { sound.unlock(); lan.setReady(!self?.ready); },
        });
        if (!linked) items.push({ label: t('mp.lan.linkRetry'), select: () => lan.retryLink() });
    }
    // The host can put a player out, in any kind of room.
    if (lan.isHost && inLobby) {
        for (const player of room.players) {
            if (!player.isHost) items.push({ label: `${t('mp.lan.kick')} · ${player.displayName}`, value: player.ready ? t('mp.lan.ready') : t('mp.lan.notReady'), select: () => lan.kick(player.playerId) });
        }
    }
    items.push({ label: isPublic && inLobby ? t('mp.global.cancel') : t('mp.lan.leave'), select: () => lan.leaveRoom() }, exitItem);
    return { key: 'lan:room', title: t(lanState.scope === LOBBY_SCOPE.GLOBAL ? 'mp.global.title' : 'mp.lan.title'), lines, items };
}

// ---- The story before a match, and its ending -------------------------------------------------

/** What is happening here, and the three sides with their pilots (ui/multiplayer/MatchCinematic.jsx in the headset). */
function introduction(match, t) {
    const lines = [t('mp.intro.story1'), t('mp.intro.story2'), t('mp.intro.story3')];
    for (const side of rosterBySide(match)) {
        const count = side.players.length === 0 ? t('mp.intro.noPilots')
            : side.players.length === 1 ? t('mp.intro.onePilot') : t('mp.intro.pilots', { count: side.players.length });
        const yours = side.faction === match.you?.faction ? ` (${t('mp.intro.yours')})` : '';
        const names = side.players.map((player) => player.name).join(', ');
        lines.push(`${t(`mp.faction.${side.faction}`)}${yours} · ${count}${names ? `: ${names}` : ''}`);
    }
    lines.push(t('mp.intro.entering', { seconds: match.intro }));
    return { key: 'match:intro', title: t('mp.intro.title'), lines, items: [], footer: '' };
}

/**
 * The ending: the show plays straight ahead with nothing over it, so this panel is not shown
 * (menuPlacement.js). It is open all the same, so that the controllers work the menu, not the
 * ship; the result comes up in front once the show is over.
 */
function ending(state, t) {
    const outro = state.matchOutro;
    const kind = !outro.winner ? 'none' : outro.won ? 'won' : 'lost';
    const faction = outro.winner ? t(`mp.faction.${outro.winner}`) : '';
    const words = outro.act === OUTRO_ACT.FALL ? `mp.outro.fall.${kind}` : `mp.outro.${kind}`;
    return {
        key: `match:outro:${outro.act}:${kind}`,
        title: t(`${words}.title`),
        lines: [t(`${words}.text`, { faction })],
        items: [],
        footer: '',
        tone: outro.won ? 'victory' : 'failure',
        place: matchMenuPlace(state, false),
    };
}

// ---- In a match -------------------------------------------------------------------------------

function planetLine(planet, t) {
    const timer = planet.changesIn === null ? ''
        : ` · ${t(planet.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: planet.changesIn })}`;
    const station = planet.owner ? t('mp.map.station', { faction: t(`mp.faction.${planet.owner}`) }) : t('mp.map.stationFree');
    const intel = planet.known ? `${t('mp.map.forces', planet.forces)} · ${station}` : t('mp.map.unknown');
    return `${t(`mp.hud.status.${planet.status}`)}${timer} · ${intel}`;
}

function starMap(session, presenter, match, t) {
    const { you } = match;
    const here = match.planets.find((planet) => planet.id === you.planet);
    const orbitsTo = (planet) => Math.abs(ORBITS.indexOf(planet.id) - ORBITS.indexOf(you.planet));
    const close = () => presenter.setPanel(null);
    const items = [];
    // (Docking is not here: in the headset it is A, kept down - see XRGamepadInput.js.)
    // (What is at each planet is on the map above; the rows only say where a jump - or a beacon - can go.)
    for (const planet of match.planets) {
        const jump = jumpChoice(you, orbitsTo(planet));
        if (!jump) continue;
        // Going on the chip before the drive has charged: say what it costs.
        const value = jump.block ? t(jump.block.key, jump.block.params)
            : jump.overdrive && you.jump.cooldown > 0 ? t('mp.map.overdriveCharging', { seconds: you.jump.cooldown }) : t(`mp.hud.status.${planet.status}`);
        items.push({
            label: `${jump.overdrive ? t('mp.map.overdrive') : t('mp.map.jump')} · ${t(`mp.planet.${planet.id}`)}`,
            planet: planet.id,
            value,
            disabled: Boolean(jump.block),
            select: () => presenter.jumpTo(planet.id),
        });
    }
    if (you.alive && you.equipment[EQUIPMENT.BEACON] > 0) {
        for (const planet of match.planets) {
            if (orbitsTo(planet) !== 1 || planet.beacon) continue;
            items.push({
                label: `${t('mp.map.beacon')} · ${t(`mp.planet.${planet.id}`)}`,
                planet: planet.id,
                value: `×${you.equipment[EQUIPMENT.BEACON]}`,
                select: () => presenter.launchBeacon(planet.id),
            });
        }
    }
    items.push(
        { label: t('mp.vr.gear'), value: you.picks > 0 ? t('mp.equipment.picks', { count: you.picks }) : carriedLine(you, t), select: () => presenter.setPanel(MATCH_PANEL.EQUIPMENT) },
        {
            label: t('mp.hud.refit'), value: String(you.points), disabled: !you.alive || you.points === 0,
            select: () => { close(); session.handleAction(MATCH_ACTION.REFIT); },
        },
        {
            label: t('mp.hud.summon'), value: String(you.summons), disabled: !you.alive || you.summons === 0,
            select: () => { close(); session.handleAction(MATCH_ACTION.SUMMON); },
        },
        { label: t('mp.map.close'), select: close },
    );
    const lines = [`${t(`mp.faction.${you.faction}`)} · ${here ? `${t(`mp.planet.${here.id}`)} · ${planetLine(here, t)}` : ''}`];
    if (match.finalStand !== null) lines.push(t('mp.map.finalStand', { seconds: match.finalStand }));
    return {
        key: 'match:map',
        title: t('mp.map.title'),
        lines,
        // The whole system at a glance, as on the flat page; redrawn whenever anything on it changes.
        // The planet a jump or beacon row goes to is framed while the row is selected.
        diagram: (ctx, x, y, width, row) => drawStarMap(ctx, x, y, width, match, t, { focus: row?.planet ?? null }),
        diagramKey: JSON.stringify([match.planets, you.planet]),
        items,
    };
}

/** What the pilot carries, in a few words: "Beacon ×1 · Overdrive chip ×1", or a dash for nothing. */
function carriedLine(you, t) {
    const carried = EQUIPMENT_ORDER.filter((item) => you.equipment[item] > 0);
    return carried.length === 0 ? '—' : carried.map((item) => `${t(`mp.equipment.${item}.name`)} ×${you.equipment[item]}`).join(' · ');
}

/** The quartermaster's stores (ui/multiplayer/EquipmentPanel.jsx in the headset): a row for each piece. */
function equipment(presenter, match, t) {
    const { you } = match;
    const items = EQUIPMENT_ORDER.map((item) => ({
        label: t(`mp.equipment.${item}.name`),
        sub: t(`mp.equipment.${item}.text`, EQUIPMENT_PARAMS[item]),
        value: `×${you.equipment[item]}`,
        disabled: you.picks === 0 || you.equipment[item] >= BATTLE_ROYALE.equipment.stack,
        select: () => presenter.pickEquipment(item),
    }));
    items.push(
        { label: t('mp.map.title'), select: () => presenter.setPanel(MATCH_PANEL.MAP) },
        { label: t('mp.map.close'), select: () => presenter.setPanel(null) },
    );
    const effects = Object.entries(you.effects).filter(([, seconds]) => seconds > 0).map(([item, seconds]) => t(`mp.equipment.effect.${item}`, { seconds }));
    return {
        key: 'match:equipment',
        title: t('mp.equipment.title'),
        lines: [you.picks > 0 ? t('mp.equipment.picks', { count: you.picks }) : t('mp.equipment.noPicks'), ...effects],
        items,
    };
}

/**
 * Shot down (ui/multiplayer/MatchHud.jsx RespawnPrompt in the headset): the wait, the star map
 * with the stations the side holds marked on it (the one the pilot is sent to if the clock
 * runs out, those that may be chosen, and those that may not: being taken, or about to be
 * swallowed), then a row for each station that may be chosen - the first is the default -
 * and the comrades to watch. The station or comrade whose row is selected is framed on the
 * map. The station rows are there during the wait too, but cannot be chosen yet. The gear
 * row leads to the equipment (and from there to the whole star map, with what is at the
 * pilot's planet).
 *
 * The map takes no more of the view than the rows did: it is drawn into the same panel, the
 * line saying what the trigger does moves to the panel's foot, and when there are many rows
 * the rules make room for them.
 */
function respawn(presenter, match, t) {
    const { you } = match;
    if (you.out) {
        return {
            key: 'match:out',
            title: t('mp.out.title'),
            lines: [t('mp.out.text')],
            // (No map here: every pilot still flying, of any side, may be watched - up to nine rows.)
            items: [...watchRows(presenter, match, t), { label: t('mp.map.title'), select: () => presenter.setPanel(MATCH_PANEL.MAP) }],
            tone: 'failure',
        };
    }
    const comeback = you.respawn;
    const ready = comeback.wait === 0;
    const open = comeback.stations.length > 0;
    const none = !open && comeback.contested.length === 0 && comeback.falling.length === 0;
    const headline = !ready ? t('mp.respawn.waiting', { seconds: comeback.wait })
        : none ? t('mp.respawn.noStation')
            : !open ? t(respawnBlockedKey(comeback)) : t('mp.respawn.choose', { seconds: comeback.choose ?? 0 });
    const statusOf = (planetId) => match.planets.find((planet) => planet.id === planetId)?.status ?? PLANET_STATUS.SAFE;
    // (Stations being taken or about to fall in are marked on the map, not listed: they cannot be chosen.)
    const items = comeback.stations.map((planetId, index) => {
        const status = t(`mp.hud.status.${statusOf(planetId)}`);
        return {
            id: `respawn:${planetId}`,
            planet: planetId,
            label: t('mp.respawn.station', { planet: t(`mp.planet.${planetId}`) }),
            value: index === 0 ? `${status} · ${t('mp.respawn.default')}` : status,
            disabled: !ready,
            select: () => presenter.respawnAt(planetId),
        };
    });
    items.push(...watchRows(presenter, match, t), {
        label: t('mp.vr.gear'),
        value: you.picks > 0 ? t('mp.equipment.picks', { count: you.picks }) : carriedLine(you, t),
        select: () => presenter.setPanel(MATCH_PANEL.EQUIPMENT),
    });
    // With more rows than fit under the map, the two lines of rules give way to them (the headline stays).
    const lines = [headline];
    if (items.length <= RESPAWN_ROWS_WITH_RULES) lines.push(none ? t('mp.respawn.noStationText') : t('mp.respawn.text', { next: comeback.next }));
    if (match.finalStand !== null) lines.push(t('mp.map.finalStand', { seconds: match.finalStand }));
    const marks = respawnMarks(comeback);
    return {
        // A new key when the stations can be chosen, and when one starts or stops being taken or
        // starts to fall: the selection goes back to the first one offered, never left on one that cannot be chosen.
        key: `match:respawn:${ready && open ? 'ready' : 'waiting'}:${comeback.contested.join()}:${comeback.falling.join()}`,
        title: t('mp.hud.dead'),
        lines,
        diagram: (ctx, x, y, width, row) => drawStarMap(ctx, x, y, width, match, t, { marks, focus: row?.planet ?? null }),
        diagramKey: JSON.stringify([match.planets, you.planet, marks]),
        items,
        footer: ready && open ? t('mp.respawn.vrFooter') : undefined,
        tone: 'failure',
    };
}

/**
 * A row for each pilot a player who is down may watch (their comrades in the air; anybody once
 * their side is out): choosing one puts the menu away and the view behind that ship. A brings
 * the menu back. And a row that stops watching.
 */
function watchRows(presenter, match, t) {
    const { you } = match;
    const rows = presenter.watchCandidates().map((id) => {
        const player = match.players.find((entry) => entry.id === id);
        const mate = you.team.find((entry) => entry.id === id);
        return {
            id: `watch:${id}`,
            planet: mate?.planet ?? null,
            label: t('mp.vr.watch', { name: player?.name ?? id }),
            sub: player && player.faction !== you.faction ? t(`mp.faction.${player.faction}`) : null,
            value: you.watching === id ? '◉' : mate?.planet ? t(`mp.planet.${mate.planet}`) : null,
            select: () => {
                presenter.watch(id);
                presenter.setWatchView(true);
            },
        };
    });
    if (you.watching) rows.push({ label: t('mp.vr.watchStop'), select: () => presenter.watch(null) });
    return rows;
}

/** The result, with the way back to the lobby. */
function result(lan, lanState, state, t, exitItem) {
    const { match } = state;
    const disconnected = match.phase === MATCH_PHASE.DISCONNECTED;
    const won = Boolean(match.winner) && match.you?.faction === match.winner;
    const title = disconnected ? 'mp.result.disconnected' : !match.winner ? 'mp.result.draw' : won ? 'mp.result.victory' : 'mp.result.defeat';
    const lines = [disconnected ? t('mp.result.disconnectedText') : match.winner ? t('mp.result.winner', { faction: t(`mp.faction.${match.winner}`) }) : t('mp.result.noWinner')];
    const players = match.players?.length ? rankPlayers(match) : [];
    players.slice(0, MAX_PLAYERS).forEach((player, index) => {
        lines.push(`${index + 1}. ${player.name} · ${t(`mp.faction.${player.faction}`)} · ${player.score.toLocaleString()}`);
    });
    const online = Boolean(lanState.room) && lanState.status === LAN_STATUS.ONLINE;
    const items = [];
    if (online && lan.isHost) items.push({ label: t('mp.result.backToLobby'), select: () => lan.returnToLobby() });
    else if (online) lines.push(t('mp.result.waitingForHost'));
    items.push({ label: t('mp.result.leave'), select: () => lan.leaveRoom() }, exitItem);
    return { key: `match:result:${title}`, title: t(title), lines, items, tone: won ? 'victory' : 'failure', place: matchMenuPlace(state, true) };
}
