import { BATTLE_ROYALE, PLAYER_FACTIONS, STAR_SYSTEM } from '../config/battleRoyale.js';
import { PLAYER_SHIPS } from '../config/playerShips.js';
import { MATCH_ACTION, MATCH_PANEL } from '../modes/battleRoyale/BattleRoyalePresenter.js';
import { VOTE } from '../modes/battleRoyale/battleRoyaleProtocol.js';
import { isBattle, rankPlayers, rosterBySide } from '../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../modes/battleRoyale/collapse.js';
import { EQUIPMENT, EQUIPMENT_ORDER } from '../modes/battleRoyale/equipment.js';
import { LAN_STATUS, ROOM_STATE } from '../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../net/lobby/lanStore.js';
import { MATCH_PHASE } from '../net/match/matchState.js';
import { LINK_STATUS } from '../net/transport/PeerLink.js';
import { PHASE } from '../state/GameSession.js';
import { exitVR } from './vrState.js';

/**
 * Multiplayer inside the headset: the LAN lobby, and in a match the star map (with the
 * beacon on it), the equipment, the vote after a capture, the menu and the result. The flat page's screens for these (ui/
 * multiplayer) cannot be seen in VR; these are the same choices as rows for VRMenu, which
 * draws them and moves the selection (see there for what a row is).
 *
 * In flight the B button opens the star map (there are no comms lines to skip in a match),
 * and holding the right grip docks at a station or lets go of it.
 */

const cycle = (list, current, step) => list[(list.indexOf(current) + step + list.length) % list.length];
/** The numbers each piece of equipment's description quotes (as ui/multiplayer/EquipmentPanel.jsx). */
const EQUIPMENT_PARAMS = Object.freeze({
    [EQUIPMENT.GRAVITY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.gravityShieldSeconds },
    [EQUIPMENT.EMERGENCY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.emergencyShieldSeconds },
});
const ORBITS = STAR_SYSTEM.planets.map((planet) => planet.id);

/** True when a multiplayer panel should be up over the flight view: the story, the map, a vote. */
export function isMatchMenuOpen(state) {
    const { match } = state;
    return Boolean(match) && (match.intro != null || Boolean(state.matchOutro) || Boolean(state.matchPanel) || Boolean(match.you?.vote));
}

/**
 * The multiplayer menu for the current state, or null when the game's own menus apply.
 * @param {object} game { session, sound, lan }
 * @param {object} state the game store
 * @param {(key: string, params?: object) => string} t
 * @param {{ lobbyOpen: boolean, setLobbyOpen: (open: boolean) => void }} view whether the player opened the LAN lobby from the VR title menu
 */
export function buildMatchMenu(game, state, t, view) {
    const { session, lan } = game;
    const lanState = useLanStore.getState();
    const exitItem = { label: t('ui.vr.exit'), select: () => exitVR() };

    if (session.phase === PHASE.TITLE) {
        if (lanState.room) return lobbyRoom(game, state, lanState, t, exitItem);
        if (view.lobbyOpen) return lobbyBrowser(lan, lanState, t, view, exitItem);
        return null;
    }
    const match = state.match;
    if (!match) return null;
    if (session.phase === PHASE.MATCH_OVER) return result(lan, lanState, match, t, exitItem);
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
    if (state.matchOutro) return ending(state.matchOutro, t);
    if (match.intro != null) return introduction(match, t);
    const presenter = session.match?.presenter;
    if (!presenter) return null;
    if (match.you.vote) return vote(presenter, match.you.vote, t);
    if (state.matchPanel === MATCH_PANEL.MAP) return starMap(session, presenter, match, t);
    if (state.matchPanel === MATCH_PANEL.EQUIPMENT) return equipment(presenter, match, t);
    return null;
}

// ---- The lobby --------------------------------------------------------------------------------

function lobbyBrowser(lan, lanState, t, view, exitItem) {
    const lines = [t('mp.lan.rules')];
    if (lanState.error) lines.push(t(lanState.error));
    if (lanState.status === LAN_STATUS.CONNECTING) lines.push(t('mp.lan.connecting'));
    const items = [];
    if (lanState.status === LAN_STATUS.OFFLINE) items.push({ label: t('mp.lan.retry'), select: () => lan.open() });
    if (lanState.status === LAN_STATUS.ONLINE) {
        for (const room of lanState.rooms) {
            items.push({ label: `${t('mp.lan.join')} · ${room.hostName}`, sub: room.hostDeviceName, value: `${room.playerCount} / ${room.maxPlayers}`, select: () => lan.joinRoom(room.code) });
        }
        items.push({ label: t('mp.lan.create'), sub: lanState.rooms.length === 0 ? t('mp.lan.noRooms') : null, select: () => lan.createRoom() });
    }
    items.push({ label: t('ui.back'), select: () => { lan.close(); view.setLobbyOpen(false); } }, exitItem);
    return { key: 'lan:browser', title: t('mp.lan.title'), lines, items };
}

function lobbyRoom(game, state, lanState, t, exitItem) {
    const { session, lan, sound } = game;
    const { room, me, links } = lanState;
    const self = room.players.find((player) => player.playerId === me?.playerId);
    const inLobby = room.state === ROOM_STATE.LOBBY;
    const lines = [`${t('mp.lan.roomCode')}  ${room.code}`];
    for (const player of room.players) {
        const ready = player.ready ? t('mp.lan.ready') : t('mp.lan.notReady');
        lines.push(`${player.displayName}${player.isHost ? ` (${t('mp.lan.host')})` : ''} · ${player.deviceName} · ${t(`ship.${player.shipClassId}`)} · ${ready}`);
    }
    if (lanState.error) lines.push(t(lanState.error));
    if (!inLobby) lines.push(t('mp.lan.matchRunning'));

    const ships = PLAYER_SHIPS.map((ship) => ship.classId);
    const ship = state.settings.playerShip;
    const shipRow = (step) => () => {
        if (!inLobby) return;
        session.updateSettings({ playerShip: cycle(ships, ship, step) });
        lan.pushProfile();
    };
    const items = [{ label: t('mp.lan.ship'), sub: t(`playerShip.${ship}.role`), value: t(`ship.${ship}`), left: shipRow(-1), right: shipRow(1), select: shipRow(1) }];
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
    if (lan.isHost) {
        const paces = Object.keys(BATTLE_ROYALE.paces);
        const pace = room.settings?.pace ?? BATTLE_ROYALE.defaultPace;
        const paceRow = (step) => () => lan.setOptions({ settings: { ...room.settings, pace: cycle(paces, pace, step) } });
        items.push({ label: t('mp.lan.pace'), sub: t(`mp.lan.paceHint.${pace}`), value: t(`mp.lan.pace.${pace}`), left: paceRow(-1), right: paceRow(1), select: paceRow(1) });
        items.push({
            label: t('mp.lan.start'),
            sub: lan.canStart ? null : t('mp.lan.startWaiting'),
            disabled: !lan.canStart,
            select: () => { sound.unlock(); lan.startMatch(); },
        });
    } else {
        const linked = links[room.hostPlayerId] === LINK_STATUS.OPEN;
        items.push({
            label: self?.ready ? t('mp.lan.setNotReady') : t('mp.lan.setReady'),
            sub: linked ? t('mp.lan.waitingForHost') : t(`mp.lan.link.${links[room.hostPlayerId] ?? LINK_STATUS.CLOSED}`),
            disabled: !inLobby || !linked,
            select: () => { sound.unlock(); lan.setReady(!self?.ready); },
        });
        if (!linked) items.push({ label: t('mp.lan.linkRetry'), select: () => lan.retryLink() });
    }
    items.push({ label: t('mp.lan.leave'), select: () => lan.leaveRoom() }, exitItem);
    return { key: 'lan:room', title: t('mp.lan.title'), lines, items };
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

function ending(outro, t) {
    const kind = !outro.winner ? 'none' : outro.won ? 'won' : 'lost';
    const faction = outro.winner ? t(`mp.faction.${outro.winner}`) : '';
    return {
        key: `match:outro:${kind}`,
        title: t(`mp.outro.${kind}.title`),
        lines: [t(`mp.outro.${kind}.text`, { faction })],
        items: [],
        footer: '',
        tone: outro.won ? 'victory' : 'failure',
    };
}

// ---- In a match -------------------------------------------------------------------------------

const SIDE_COLORS = Object.freeze({ dawn: '#59d0ff', umbra: '#c04dff', pirate: '#ffb648' });
const STATUS_COLORS = Object.freeze({ [PLANET_STATUS.SAFE]: '#7dffa8', [PLANET_STATUS.COLLAPSING]: '#ffb648', [PLANET_STATUS.SWALLOWED]: '#ff4b6e' });
const MAP_FONT = '"PingFang SC", "Microsoft YaHei", Orbitron, sans-serif';
const MAP_HEIGHT = 196;

/**
 * Draws the star map the flat page shows as cards (ui/multiplayer/StarMapPanel.jsx): the
 * collapsing sun, then every planet in orbit order with its state and countdown, and where
 * the player is. Where their side has eyes (a pilot, a station it holds, or a beacon): who
 * holds the station (a ring in that side's colour), the ships there by side, a docking in
 * progress, comrades. Elsewhere: a question mark.
 * @returns {number} the height it took
 */
function drawStarMap(ctx, x, y, width, match, t) {
    const { planets, you } = match;
    const sunWidth = 54;
    const cell = (width - sunWidth) / planets.length;
    const centreY = y + 62;
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // The sun that is eating the system, and the line of orbits leading away from it.
    ctx.strokeStyle = 'rgba(150, 200, 235, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 30, centreY);
    ctx.lineTo(x + width - cell / 2, centreY);
    ctx.stroke();
    ctx.fillStyle = '#12061f';
    ctx.strokeStyle = '#b06bff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x + 24, centreY, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    planets.forEach((planet, index) => {
        const cx = x + sunWidth + cell * (index + 0.5);
        const here = planet.id === you.planet;
        const gate = index === planets.length - 1;
        const color = STATUS_COLORS[planet.status];
        ctx.textAlign = 'center';

        if (here) {
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 17px ${MAP_FONT}`;
            ctx.fillText(`▼ ${t('mp.lan.you')}`, cx, y + 20);
        }
        // The side whose bubble covers the planet.
        if (planet.owner) {
            ctx.strokeStyle = SIDE_COLORS[planet.owner];
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(cx, centreY, 30, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = planet.status === PLANET_STATUS.SWALLOWED ? 0.45 : 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, centreY, gate ? 13 : 19, 0, Math.PI * 2);
        ctx.fill();
        if (gate) {
            // The stargate: a ring around the last planet.
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(cx, centreY, 22, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = here ? '#ffffff' : 'rgba(225, 240, 255, 0.92)';
        ctx.font = `700 19px ${MAP_FONT}`;
        ctx.fillText(t(`mp.planet.${planet.id}`), cx, centreY + 56);
        ctx.fillStyle = color;
        ctx.font = `600 15px ${MAP_FONT}`;
        const status = gate && planet.status === PLANET_STATUS.SAFE ? t('mp.map.gate') : t(`mp.hud.status.${planet.status}`);
        ctx.fillText(planet.changesIn === null ? status : `${status} ${planet.changesIn}s`, cx, centreY + 77);

        ctx.font = `700 16px ${MAP_FONT}`;
        if (!planet.known) {
            ctx.fillStyle = 'rgba(225, 240, 255, 0.45)';
            ctx.fillText('?', cx, centreY + 99);
        } else {
            // The ships there, in their sides' colours; red under them when sides are fighting.
            const sides = PLAYER_FACTIONS.filter((faction) => planet.forces[faction] > 0);
            const spacing = 40;
            sides.forEach((faction, slot) => {
                ctx.fillStyle = SIDE_COLORS[faction];
                ctx.fillText(`◆${planet.forces[faction]}`, cx + (slot - (sides.length - 1) / 2) * spacing, centreY + 99);
            });
            if (planet.beacon) {
                ctx.fillStyle = '#7dffa8';
                ctx.fillText('⌖', cx + 34, centreY - 22);
            }
            const note = planet.docking ? t('mp.map.docking', { faction: t(`mp.faction.${planet.docking}`) })
                : isBattle(planet.forces) ? t('mp.map.battle') : null;
            if (note && planet.comrades.length === 0) {
                ctx.fillStyle = planet.docking ? SIDE_COLORS[planet.docking] : '#ff4b6e';
                ctx.font = `600 14px ${MAP_FONT}`;
                ctx.fillText(note, cx, centreY + 119);
            }
        }
        if (planet.comrades.length > 0) {
            ctx.fillStyle = SIDE_COLORS[you.faction];
            ctx.font = `600 14px ${MAP_FONT}`;
            const names = planet.comrades.join(', ');
            ctx.fillText(names.length > 14 ? `${names.slice(0, 13)}…` : names, cx, centreY + 119);
        }
        ctx.globalAlpha = 1;
    });
    ctx.restore();
    return MAP_HEIGHT;
}

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
    const block = !you.alive ? t('mp.jump.refused.noShip')
        : you.jump.to ? t('mp.jump.refused.spooling')
            : you.jump.trapped ? t('mp.hud.jumpTrapped')
                : you.jump.cooldown > 0 ? t('mp.hud.jumpCharging', { seconds: you.jump.cooldown }) : null;
    const orbitsTo = (planet) => Math.abs(ORBITS.indexOf(planet.id) - ORBITS.indexOf(you.planet));
    const close = () => presenter.setPanel(null);
    const items = [];
    // (Docking is not here: in the headset it is the right grip, held - see XRGamepadInput.js.)
    // (What is at each planet is on the map above; the rows only say where a jump - or a beacon - can go.)
    for (const planet of match.planets) {
        const orbits = orbitsTo(planet);
        if (orbits < 1 || orbits > you.jump.reach) continue;
        items.push({
            label: `${orbits > 1 ? t('mp.map.overdrive') : t('mp.map.jump')} · ${t(`mp.planet.${planet.id}`)}`,
            value: block ?? t(`mp.hud.status.${planet.status}`),
            disabled: Boolean(block),
            select: () => presenter.jumpTo(planet.id),
        });
    }
    if (you.alive && you.equipment[EQUIPMENT.BEACON] > 0) {
        for (const planet of match.planets) {
            if (orbitsTo(planet) !== 1 || planet.beacon) continue;
            items.push({ label: `${t('mp.map.beacon')} · ${t(`mp.planet.${planet.id}`)}`, value: `×${you.equipment[EQUIPMENT.BEACON]}`, select: () => presenter.launchBeacon(planet.id) });
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
        diagram: (ctx, x, y, width) => drawStarMap(ctx, x, y, width, match, t),
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

function vote(presenter, ballot, t) {
    const row = (choice, label) => ({ label: t(label), value: ballot.choice === choice ? t('mp.vote.chosen') : null, select: () => presenter.vote(choice) });
    return {
        key: 'match:vote',
        title: t('mp.vote.title', { planet: t(`mp.planet.${ballot.planet}`) }),
        lines: [t('mp.vote.text'), t('mp.vote.endsIn', { seconds: ballot.endsIn })],
        items: [row(VOTE.REWARD, 'mp.vote.reward'), row(VOTE.REVIVE, 'mp.vote.revive')],
    };
}

function result(lan, lanState, match, t, exitItem) {
    const disconnected = match.phase === MATCH_PHASE.DISCONNECTED;
    const won = Boolean(match.winner) && match.you?.faction === match.winner;
    const title = disconnected ? 'mp.result.disconnected' : !match.winner ? 'mp.result.draw' : won ? 'mp.result.victory' : 'mp.result.defeat';
    const lines = [disconnected ? t('mp.result.disconnectedText') : match.winner ? t('mp.result.winner', { faction: t(`mp.faction.${match.winner}`) }) : t('mp.result.noWinner')];
    const players = match.players?.length ? rankPlayers(match) : [];
    players.slice(0, 8).forEach((player, index) => {
        lines.push(`${index + 1}. ${player.name} · ${t(`mp.faction.${player.faction}`)} · ${player.score.toLocaleString()}`);
    });
    const online = Boolean(lanState.room) && lanState.status === LAN_STATUS.ONLINE;
    const items = [];
    if (online && lan.isHost) items.push({ label: t('mp.result.backToLobby'), select: () => lan.returnToLobby() });
    else if (online) lines.push(t('mp.result.waitingForHost'));
    items.push({ label: t('mp.result.leave'), select: () => lan.leaveRoom() }, exitItem);
    return { key: `match:result:${title}`, title: t(title), lines, items, tone: won ? undefined : 'failure' };
}
