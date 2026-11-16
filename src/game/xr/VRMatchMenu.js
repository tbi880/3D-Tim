import { BATTLE_ROYALE, STAR_SYSTEM } from '../config/battleRoyale.js';
import { PLAYER_SHIPS } from '../config/playerShips.js';
import { MATCH_ACTION, MATCH_PANEL } from '../modes/battleRoyale/BattleRoyalePresenter.js';
import { VOTE } from '../modes/battleRoyale/battleRoyaleProtocol.js';
import { rankPlayers } from '../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../modes/battleRoyale/collapse.js';
import { LAN_STATUS, ROOM_STATE } from '../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../net/lobby/lanStore.js';
import { MATCH_PHASE } from '../net/match/matchState.js';
import { LINK_STATUS } from '../net/transport/PeerLink.js';
import { PHASE } from '../state/GameSession.js';
import { exitVR } from './vrState.js';

/**
 * Multiplayer inside the headset: the LAN lobby, and in a match the star map, the vote
 * after a capture, the menu and the result. The flat page's screens for these (ui/
 * multiplayer) cannot be seen in VR; these are the same choices as rows for VRMenu, which
 * draws them and moves the selection (see there for what a row is).
 *
 * In flight the B button opens the star map (there are no comms lines to skip in a match).
 */

const cycle = (list, current, step) => list[(list.indexOf(current) + step + list.length) % list.length];
const ORBITS = STAR_SYSTEM.planets.map((planet) => planet.id);

/** True when a multiplayer menu should be up over the flight view. */
export function isMatchMenuOpen(state) {
    return Boolean(state.match) && (Boolean(state.matchPanel) || Boolean(state.match.you?.vote));
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
    const presenter = session.match?.presenter;
    if (!presenter) return null;
    if (match.you.vote) return vote(presenter, match.you.vote, t);
    if (state.matchPanel === MATCH_PANEL.MAP) return starMap(session, presenter, match, t);
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

// ---- In a match -------------------------------------------------------------------------------

function planetLine(planet, t) {
    const timer = planet.changesIn === null ? ''
        : ` · ${t(planet.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: planet.changesIn })}`;
    const owner = planet.owner ? ` · ${t('mp.hud.bubble', { faction: t(`mp.faction.${planet.owner}`) })}` : '';
    return `${t(`mp.hud.status.${planet.status}`)}${timer} · ${t('mp.map.forces', planet.forces)}${owner}`;
}

function starMap(session, presenter, match, t) {
    const { you } = match;
    const here = match.planets.find((planet) => planet.id === you.planet);
    const block = !you.alive ? t('mp.jump.refused.noShip')
        : you.jump.to ? t('mp.jump.refused.spooling')
            : you.jump.trapped ? t('mp.hud.jumpTrapped')
                : you.jump.cooldown > 0 ? t('mp.hud.jumpCharging', { seconds: you.jump.cooldown }) : null;
    const items = match.planets
        .filter((planet) => Math.abs(ORBITS.indexOf(planet.id) - ORBITS.indexOf(you.planet)) === 1)
        .map((planet) => ({
            label: `${t('mp.map.jump')} · ${t(`mp.planet.${planet.id}`)}`,
            sub: planetLine(planet, t),
            value: block,
            disabled: Boolean(block),
            select: () => presenter.jumpTo(planet.id),
        }));
    items.push(
        {
            label: t('mp.hud.refit'), value: String(you.points), disabled: !you.alive || you.points === 0,
            select: () => { presenter.setPanel(null); session.handleAction(MATCH_ACTION.REFIT); },
        },
        {
            label: t('mp.hud.summon'), value: String(you.summons), disabled: !you.alive || you.summons === 0,
            select: () => { presenter.setPanel(null); session.handleAction(MATCH_ACTION.SUMMON); },
        },
        { label: t('mp.map.close'), select: () => presenter.setPanel(null) },
    );
    const lines = [`${t(`mp.faction.${you.faction}`)} · ${here ? `${t(`mp.planet.${here.id}`)} · ${planetLine(here, t)}` : ''}`];
    if (match.finalStand !== null) lines.push(t('mp.map.finalStand', { seconds: match.finalStand }));
    return { key: 'match:map', title: t('mp.map.title'), lines, items };
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
