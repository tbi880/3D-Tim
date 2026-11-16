import { useEffect, useState } from 'react';
import AuthPanel from '../../../Tools/AuthPanel';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { PLAYER_SHIPS } from '../../config/playerShips.js';
import { LAN_ERROR, LAN_STATUS, ROOM_STATE } from '../../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../../net/lobby/lanStore.js';
import { LINK_STATUS } from '../../net/transport/PeerLink.js';
import { useGameStore, useT } from '../../state/gameStore.js';
import { enterVR, useVRSupported } from '../../xr/vrState.js';
import { EquipmentList } from './EquipmentPanel.jsx';
import './multiplayer.css';

/**
 * The LAN lobby, reached from the title screen: who you are, the rooms on this network,
 * and - once in a room - everybody in it with their device, ship and readiness, and the
 * quartermaster's stores.
 * It only shows the LAN store and calls LanMultiplayer; nothing is decided here.
 */

const PACES = Object.keys(BATTLE_ROYALE.paces);
const SEATS = [2, 3, 4, 5, 6, 7, 8];
const next = (list, current) => list[(list.indexOf(current) + 1) % list.length];
const DEVICE_ICONS = { Desktop: '🖥', Mobile: '📱', VR: '🥽' };

/** The site's account, if the player is signed in: `{ name }` or null. */
function useAccount() {
    const token = useAuthStore((state) => state.token);
    const profile = useAuthStore((state) => state.profile);
    return token && profile ? { name: profile.name } : null;
}

function ErrorLine() {
    const error = useLanStore((state) => state.error);
    const t = useT();
    return error ? <p className="eod-lan-error" role="alert">{t(error)}</p> : null;
}

/** Guest or account, the player's own name and what the lobby will call this device. */
function Identity({ lan }) {
    const me = useLanStore((state) => state.me);
    const pilotName = useLanStore((state) => state.pilotName);
    const inRoom = useLanStore((state) => Boolean(state.room));
    const account = useAccount();
    const t = useT();
    const [name, setName] = useState(pilotName);
    useEffect(() => setName(pilotName), [pilotName]);
    // The lobby connection was made as someone else than the page is signed in as now.
    const stale = Boolean(me) && !inRoom && me.isGuest === Boolean(account);

    return (
        <div className="eod-lan-identity">
            <label className="eod-lan-field">
                <span>{t('mp.lan.name')}</span>
                <input
                    type="text"
                    value={name}
                    maxLength={20}
                    placeholder={account?.name ?? t('mp.lan.namePlaceholder')}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => lan.setPilotName(name)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur(); }}
                />
            </label>
            <div className="eod-lan-field">
                <span>{t('mp.lan.device')}</span>
                <strong>{DEVICE_ICONS[lan.device.kind]} {lan.device.name}</strong>
            </div>
            <div className="eod-lan-field">
                <span>{me && !me.isGuest ? t('mp.lan.identity.account', { name: me.accountName }) : t('mp.lan.identity.guest')}</span>
                {stale
                    ? <button type="button" className="eod-setting" onClick={() => lan.reopen()}>{t('mp.lan.identity.refresh')}</button>
                    : <small>{t('mp.lan.identity.hint')}</small>}
            </div>
        </div>
    );
}

/** Rooms found on this network, and the two other ways into one. */
function RoomBrowser({ lan }) {
    const rooms = useLanStore((state) => state.rooms);
    const t = useT();
    const [code, setCode] = useState('');
    return (
        <div className="eod-lan-browser">
            <h3 className="eod-lan-heading">{t('mp.lan.rooms')}</h3>
            {rooms.length === 0 && <p className="eod-lan-empty">{t('mp.lan.noRooms')}</p>}
            {rooms.map((room) => (
                <button key={room.code} type="button" className="eod-lan-room" onClick={() => lan.joinRoom(room.code)}>
                    <strong>{room.hostName}</strong>
                    <span>{DEVICE_ICONS[room.hostDeviceKind]} {room.hostDeviceName}</span>
                    <span>{room.playerCount} / {room.maxPlayers}</span>
                    <em>{t('mp.lan.join')}</em>
                </button>
            ))}
            <div className="eod-lan-actions">
                <button type="button" className="eod-button eod-button--primary" onClick={() => lan.createRoom()}>{t('mp.lan.create')}</button>
                <form className="eod-lan-code" onSubmit={(event) => { event.preventDefault(); lan.joinRoom(code); }}>
                    <input
                        type="text"
                        value={code}
                        maxLength={5}
                        placeholder={t('mp.lan.codePlaceholder')}
                        autoCapitalize="characters"
                        autoComplete="off"
                        onChange={(event) => setCode(event.target.value.toUpperCase())}
                    />
                    <button type="submit" className="eod-button" disabled={code.trim().length !== 5}>{t('mp.lan.joinByCode')}</button>
                </form>
            </div>
        </div>
    );
}

function PlayerRow({ player, isMe, link }) {
    const t = useT();
    return (
        <li className={`eod-lan-player ${isMe ? 'eod-lan-player--me' : ''}`}>
            <div className="eod-lan-player-name">
                <strong>{player.displayName}</strong>
                <small>
                    {player.isHost && <b>{t('mp.lan.host')}</b>}
                    {isMe && <b>{t('mp.lan.you')}</b>}
                    <span>{player.isGuest ? t('mp.lan.guest') : `${t('mp.lan.account')} · ${player.accountName}`}</span>
                </small>
            </div>
            <div className="eod-lan-player-device" title={t(`mp.lan.device.${player.deviceKind}`)}>
                <span>{DEVICE_ICONS[player.deviceKind]} {t(`mp.lan.device.${player.deviceKind}`)}</span>
                <small>{player.deviceName}</small>
            </div>
            <span className="eod-lan-player-ship">{t(`ship.${player.shipClassId}`)}</span>
            <span className={`eod-lan-player-ready ${player.ready ? 'eod-lan-player-ready--yes' : ''}`}>
                {player.ready ? t('mp.lan.ready') : t('mp.lan.notReady')}
                {link && <small className={`eod-lan-link eod-lan-link--${link}`}>{t(`mp.lan.link.${link}`)}</small>}
            </span>
        </li>
    );
}

/** What the host can set; everybody else reads it. */
function RoomOptions({ lan, room }) {
    const t = useT();
    const pace = room.settings?.pace ?? BATTLE_ROYALE.defaultPace;
    const editable = lan.isHost;
    const setPace = () => lan.setOptions({ settings: { ...room.settings, pace: next(PACES, pace) } });
    const setSeats = () => lan.setOptions({ maxPlayers: next(SEATS.filter((seats) => seats >= room.players.length), room.maxPlayers) });
    return (
        <div className="eod-settings eod-lan-options">
            <button type="button" className="eod-setting" disabled={!editable} title={t(`mp.lan.paceHint.${pace}`)} onClick={setPace}>
                <span>{t('mp.lan.pace')}</span><strong>{t(`mp.lan.pace.${pace}`)}</strong>
            </button>
            <button type="button" className="eod-setting" disabled={!editable} onClick={setSeats}>
                <span>{t('mp.lan.maxPlayers')}</span><strong>{room.maxPlayers}</strong>
            </button>
            <p className="eod-setting-hint">{t(`mp.lan.paceHint.${pace}`)}</p>
        </div>
    );
}

/**
 * The piece of equipment this player takes into the match. Nobody else in the room is told;
 * leaving it open is a choice too - it can be made at any time in the match.
 */
function Loadout({ lan, editable }) {
    const chosen = useLanStore((state) => state.loadout.equipment);
    const t = useT();
    return (
        <div className="eod-lan-loadout">
            <h3 className="eod-lan-heading">{t('mp.lan.loadout')}</h3>
            <EquipmentList
                selected={chosen}
                action={(item) => (
                    <button
                        type="button"
                        className={`eod-button ${chosen === item ? 'eod-button--primary' : ''}`}
                        disabled={!editable}
                        aria-pressed={chosen === item}
                        onClick={() => lan.setLoadout({ equipment: chosen === item ? null : item })}
                    >
                        {chosen === item ? t('mp.vote.chosen') : t('mp.equipment.take')}
                    </button>
                )}
            />
            {!chosen && <p className="eod-lan-empty">{t('mp.lan.loadoutLater')}</p>}
        </div>
    );
}

/** Inside a room: the roster, this player's ship, equipment and readiness, and the host's start button. */
function Room({ lan, session, onStart }) {
    const room = useLanStore((state) => state.room);
    const me = useLanStore((state) => state.me);
    const links = useLanStore((state) => state.links);
    const error = useLanStore((state) => state.error);
    const ship = useGameStore((state) => state.settings.playerShip);
    const vrSupported = useVRSupported();
    const t = useT();
    const self = room.players.find((player) => player.playerId === me?.playerId);
    const inLobby = room.state === ROOM_STATE.LOBBY;
    const hostLink = links[room.hostPlayerId] ?? LINK_STATUS.CLOSED;
    const linkOf = (player) => {
        if (lan.isHost) return player.isHost ? null : links[player.playerId] ?? LINK_STATUS.CONNECTING;
        return player.playerId === me?.playerId ? hostLink : null;
    };
    const changeShip = () => {
        const classes = PLAYER_SHIPS.map((entry) => entry.classId);
        session.updateSettings({ playerShip: next(classes, ship) });
        lan.pushProfile();
    };
    // Audio can only be unlocked inside a tap: the taps that lead into a match do it.
    const ready = () => { onStart(); lan.setReady(!self?.ready); };
    const start = () => { onStart(); lan.startMatch(); };

    return (
        <div className="eod-lan-room-view">
            <div className="eod-lan-code-banner">
                <span>{t('mp.lan.roomCode')}</span>
                <strong>{room.code}</strong>
                <span>{t('mp.lan.players', { count: room.players.length, max: room.maxPlayers })}</span>
            </div>
            <ul className="eod-lan-players">
                {room.players.map((player) => <PlayerRow key={player.playerId} player={player} isMe={player.playerId === me?.playerId} link={linkOf(player)} />)}
            </ul>
            <RoomOptions lan={lan} room={room} />
            <Loadout lan={lan} editable={inLobby} />
            {!inLobby && <p className="eod-lan-empty">{t('mp.lan.matchRunning')}</p>}
            <div className="eod-lan-actions">
                <button type="button" className="eod-button" disabled={!inLobby} onClick={changeShip}>
                    {t('mp.lan.ship')}
                    <small>{t(`ship.${ship}`)} · {t(`playerShip.${ship}.role`)}</small>
                </button>
                {lan.isHost ? (
                    <button type="button" className="eod-button eod-button--primary" disabled={!lan.canStart} onClick={start}>
                        {t('mp.lan.start')}
                        {!lan.canStart && <small>{t('mp.lan.startWaiting')}</small>}
                    </button>
                ) : (
                    <button type="button" className="eod-button eod-button--primary" disabled={!inLobby || hostLink !== LINK_STATUS.OPEN} onClick={ready}>
                        {self?.ready ? t('mp.lan.setNotReady') : t('mp.lan.setReady')}
                        <small>{hostLink === LINK_STATUS.OPEN ? t('mp.lan.waitingForHost') : t(`mp.lan.link.${hostLink}`)}</small>
                    </button>
                )}
                {!lan.isHost && error === LAN_ERROR.LINK_FAILED && (
                    <button type="button" className="eod-button" onClick={() => lan.retryLink()}>{t('mp.lan.linkRetry')}</button>
                )}
                {vrSupported && (
                    <button type="button" className="eod-button" data-skip-fullscreen="" onClick={() => { onStart(); enterVR(); }}>
                        {t('ui.vr.enter')}
                        <small>{t('ui.vr.enterHint')}</small>
                    </button>
                )}
                <button type="button" className="eod-button" onClick={() => lan.leaveRoom()}>{t('mp.lan.leave')}</button>
            </div>
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../../net/lobby/LanMultiplayer.js').LanMultiplayer} props.lan
 * @param {import('../../state/GameSession.js').GameSession} props.session
 * @param {() => void} props.onStart called from the taps that lead into a match (unlocks audio)
 * @param {() => void} props.onBack back to the title menu
 */
export default function LanLobby({ lan, session, onStart, onBack }) {
    const status = useLanStore((state) => state.status);
    const inRoom = useLanStore((state) => Boolean(state.room));
    const t = useT();

    useEffect(() => {
        lan.open();
    }, [lan]);

    const leave = () => {
        lan.close();
        onBack();
    };

    return (
        <div className="eod-lan">
            <h2 className="eod-hangar-title">{t('mp.lan.title')}</h2>
            {/* The site's own sign-in (the button at the top of the screen), for playing as an account. */}
            {!inRoom && <AuthPanel isPortraitPhoneScreen={false} setDisplayOverlayCallback={() => {}} />}
            <ErrorLine />
            {status === LAN_STATUS.CONNECTING && <p className="eod-lan-empty">{t('mp.lan.connecting')}</p>}
            {status === LAN_STATUS.OFFLINE && !inRoom && (
                <button type="button" className="eod-button eod-button--primary" onClick={() => lan.open()}>{t('mp.lan.retry')}</button>
            )}
            {status === LAN_STATUS.ONLINE && !inRoom && (
                <>
                    <p className="eod-lan-rules">{t('mp.lan.rules')}</p>
                    <Identity lan={lan} />
                    <RoomBrowser lan={lan} />
                </>
            )}
            {inRoom && <Room lan={lan} session={session} onStart={onStart} />}
            {!inRoom && <button type="button" className="eod-button" onClick={leave}>{t('ui.back')}</button>}
        </div>
    );
}
