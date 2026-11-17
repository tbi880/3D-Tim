import { useEffect, useState } from 'react';
import AuthPanel from '../../../Tools/AuthPanel';
import { useAuthStore } from '../../../hooks/useAuthStore';
import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { LAN_ERROR, LAN_STATUS, LOBBY_SCOPE, ROOM_STATE, ROOM_VISIBILITY } from '../../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../../net/lobby/lanStore.js';
import { LINK_STATUS } from '../../net/transport/PeerLink.js';
import { useGameStore, useT } from '../../state/gameStore.js';
import { enterVR, useVRSupported } from '../../xr/vrState.js';
import Hangar from '../Hangar.jsx';
import { hangarImage } from '../hangarImages.js';
import { shipAbilityText } from '../shipText.js';
import { EquipmentList } from './EquipmentPanel.jsx';
import './multiplayer.css';

/**
 * The multiplayer lobby, reached from the title screen in one of two scopes: one Wi-Fi (the
 * rooms on this network are listed) or anywhere (quick match, a private room, or a room's
 * code). Then, once in a room: everybody in it with their device, ship and readiness, and
 * the quartermaster's stores. The ship is chosen on a page of its own, the hangar the title
 * screen uses (ui/Hangar.jsx), opened from the lobby before a room or from inside one.
 * It only shows the LAN store and calls LanMultiplayer; nothing is decided here.
 */

const PACES = Object.keys(BATTLE_ROYALE.paces);
/** The room's `bots` setting: fill the empty seats with computer-flown players, or leave them empty. */
const BOT_SETTINGS = ['fill', 'none'];
const SEATS = [2, 3, 4, 5, 6, 7, 8];
const next = (list, current) => list[(list.indexOf(current) + 1) % list.length];
const DEVICE_ICONS = { Desktop: '🖥', Mobile: '📱', VR: '🥽' };
/** What a player's beams and torpedoes do to another player's ship in a match, as a share of their damage (config/battleRoyale.js). */
const VERSUS_DAMAGE = BATTLE_ROYALE.difficulty.playerDamage ?? 1;

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

/** Seconds left until `startsAt` (`Date.now()` milliseconds), counted down on screen; null without one. */
function useCountdown(startsAt) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (startsAt === null) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [startsAt]);
    return startsAt === null ? null : Math.max(0, Math.ceil((startsAt - now) / 1000));
}

/**
 * The ship this player flies - its picture, its name, what it is and its ability - and the
 * way to the page where it is chosen.
 */
function ShipSummary({ disabled = false, onOpen }) {
    const ship = useGameStore((state) => state.settings.playerShip);
    const t = useT();
    return (
        <button type="button" className="eod-lan-ship" disabled={disabled} onClick={onOpen}>
            <img src={hangarImage(ship, 'side')} alt="" draggable={false} />
            <span className="eod-lan-ship-text">
                <small>{t('mp.lan.ship')}</small>
                <strong>{t(`ship.${ship}`)} <i>{t(`playerShip.${ship}.role`)}</i></strong>
                <small>{shipAbilityText(t, ship).heading}</small>
            </span>
            <em>{t('mp.ship.open')}</em>
        </button>
    );
}

/** On the ship page: a public room's countdown, so the match does not start behind the player's back. */
function ShipPageStatus() {
    const startsIn = useCountdown(useLanStore((state) => state.startsAt));
    const t = useT();
    if (startsIn === null) return null;
    return <p className="eod-lan-countdown eod-lan-countdown--on" role="status">{t('mp.global.startsIn', { seconds: startsIn })}</p>;
}

/** A room's code typed in: the way into any room from anywhere. */
function JoinByCode({ lan }) {
    const t = useT();
    const [code, setCode] = useState('');
    return (
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
    );
}

/** Playing with anybody anywhere: quick match, a private room for friends, or a friend's code. */
function GlobalBrowser({ lan, onStart }) {
    const matching = useLanStore((state) => state.matching);
    const t = useT();
    // Audio can only be unlocked inside a tap: a quick match goes into the game with no further one.
    const quickMatch = () => { onStart(); lan.quickMatch(); };
    if (matching) {
        return (
            <div className="eod-lan-browser">
                <p className="eod-lan-searching">{t('mp.global.searching')}</p>
                <div className="eod-lan-actions">
                    <button type="button" className="eod-button" onClick={() => lan.leaveRoom()}>{t('mp.global.cancel')}</button>
                </div>
            </div>
        );
    }
    return (
        <div className="eod-lan-browser">
            <div className="eod-lan-actions">
                <button type="button" className="eod-button eod-button--primary" onClick={quickMatch}>
                    {t('mp.global.quickMatch')}
                    <small>{t('mp.global.quickMatchHint')}</small>
                </button>
                <button type="button" className="eod-button" onClick={() => { onStart(); lan.createPrivateRoom(); }}>
                    {t('mp.global.private')}
                    <small>{t('mp.global.privateHint')}</small>
                </button>
            </div>
            <div className="eod-lan-actions">
                <JoinByCode lan={lan} />
            </div>
            <p className="eod-lan-empty">{t('mp.global.note')}</p>
        </div>
    );
}

/** Rooms found on this network, and the two other ways into one. */
function RoomBrowser({ lan }) {
    const rooms = useLanStore((state) => state.rooms);
    const t = useT();
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
                <JoinByCode lan={lan} />
            </div>
        </div>
    );
}

/** One player of the room. `onKick`, given to the host for everybody else while in the lobby, puts them out. */
function PlayerRow({ player, isMe, link, onKick = null }) {
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
                {onKick && <button type="button" className="eod-lan-kick" onClick={onKick}>{t('mp.lan.kick')}</button>}
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
    const bots = room.settings?.bots ?? BATTLE_ROYALE.bots.defaultSetting;
    const setBots = () => lan.setOptions({ settings: { ...room.settings, bots: next(BOT_SETTINGS, bots) } });
    return (
        <div className="eod-settings eod-lan-options">
            <button type="button" className="eod-setting" disabled={!editable} title={t(`mp.lan.paceHint.${pace}`)} onClick={setPace}>
                <span>{t('mp.lan.pace')}</span><strong>{t(`mp.lan.pace.${pace}`)}</strong>
            </button>
            <button type="button" className="eod-setting" disabled={!editable} onClick={setSeats}>
                <span>{t('mp.lan.maxPlayers')}</span><strong>{room.maxPlayers}</strong>
            </button>
            <button type="button" className="eod-setting" disabled={!editable} title={t('mp.lan.botsHint', { count: BATTLE_ROYALE.bots.fillTo })} onClick={setBots}>
                <span>{t('mp.lan.bots')}</span><strong>{t(`mp.lan.bots.${bots}`, { count: BATTLE_ROYALE.bots.fillTo })}</strong>
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
function Room({ lan, onStart, onOpenShipPage }) {
    const room = useLanStore((state) => state.room);
    const me = useLanStore((state) => state.me);
    const links = useLanStore((state) => state.links);
    const error = useLanStore((state) => state.error);
    const startsIn = useCountdown(useLanStore((state) => state.startsAt));
    const vrSupported = useVRSupported();
    const t = useT();
    const self = room.players.find((player) => player.playerId === me?.playerId);
    const inLobby = room.state === ROOM_STATE.LOBBY;
    // A public room starts itself, on a countdown, once everybody in it is ready: its host has no
    // start button and no options - only, like every host, the power to put a player out.
    const isPublic = room.visibility === ROOM_VISIBILITY.PUBLIC;
    const everybodyReady = room.players.every((player) => player.ready);
    // Every device links to every other (any of them may be given the match to run): each row
    // shows this device's link to that player, and "linked" is being linked to somebody.
    const linkOf = (player) => (player.playerId === me?.playerId ? null : links[player.playerId] ?? LINK_STATUS.CONNECTING);
    const linked = room.players.length === 1 || Object.values(links).includes(LINK_STATUS.OPEN);
    const ownLink = linked ? LINK_STATUS.OPEN : Object.values(links).includes(LINK_STATUS.CONNECTING) ? LINK_STATUS.CONNECTING : LINK_STATUS.CLOSED;
    // Audio can only be unlocked inside a tap: the taps that lead into a match do it.
    const ready = () => { onStart(); lan.setReady(!self?.ready); };
    const start = () => { onStart(); lan.startMatch(); };

    return (
        <div className="eod-lan-room-view">
            <div className="eod-lan-code-banner">
                <span>{t(`mp.room.${room.visibility ?? ROOM_VISIBILITY.NETWORK}`)} · {t('mp.lan.roomCode')}</span>
                <strong>{room.code}</strong>
                <span>{t('mp.lan.players', { count: room.players.length, max: room.maxPlayers })}</span>
            </div>
            {isPublic && inLobby && (
                <p className={`eod-lan-countdown ${startsIn !== null ? 'eod-lan-countdown--on' : ''}`} role="status">
                    {startsIn !== null ? t('mp.global.startsIn', { seconds: startsIn })
                        : !linked ? t('mp.global.linking')
                            : room.players.length > 1 && !everybodyReady ? t('mp.global.waitingReady')
                                : t('mp.global.waiting', { count: room.players.length, max: room.maxPlayers })}
                    {lan.isHost && <small>{t('mp.global.hostNote')}</small>}
                    {room.players.length < BATTLE_ROYALE.bots.fillTo && <small>{t('mp.global.botsNote', { count: BATTLE_ROYALE.bots.fillTo })}</small>}
                </p>
            )}
            <ul className="eod-lan-players">
                {room.players.map((player) => (
                    <PlayerRow
                        key={player.playerId}
                        player={player}
                        isMe={player.playerId === me?.playerId}
                        link={linkOf(player)}
                        onKick={lan.isHost && inLobby && !player.isHost ? () => lan.kick(player.playerId) : null}
                    />
                ))}
            </ul>
            <ShipSummary disabled={!inLobby} onOpen={onOpenShipPage} />
            {!isPublic && <RoomOptions lan={lan} room={room} />}
            <Loadout lan={lan} editable={inLobby} />
            {!inLobby && <p className="eod-lan-empty">{t('mp.lan.matchRunning')}</p>}
            <div className="eod-lan-actions">
                {!isPublic && lan.isHost && (
                    <button type="button" className="eod-button eod-button--primary" disabled={!lan.canStart} onClick={start}>
                        {t('mp.lan.start')}
                        {!lan.canStart && <small>{t('mp.lan.startWaiting')}</small>}
                    </button>
                )}
                {!lan.isHost && (
                    <button type="button" className="eod-button eod-button--primary" disabled={!inLobby || !linked} onClick={ready}>
                        {self?.ready ? t('mp.lan.setNotReady') : t('mp.lan.setReady')}
                        <small>{linked ? t('mp.lan.waitingForHost') : t(`mp.lan.link.${ownLink}`)}</small>
                    </button>
                )}
                {error === LAN_ERROR.LINK_FAILED && (
                    <button type="button" className="eod-button" onClick={() => lan.retryLink()}>{t('mp.lan.linkRetry')}</button>
                )}
                {vrSupported && (
                    <button type="button" className="eod-button" data-skip-fullscreen="" onClick={() => { onStart(); enterVR(); }}>
                        {t('ui.vr.enter')}
                        <small>{t('ui.vr.enterHint')}</small>
                    </button>
                )}
                <button type="button" className="eod-button" onClick={() => lan.leaveRoom()}>{isPublic && inLobby ? t('mp.global.cancel') : t('mp.lan.leave')}</button>
            </div>
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../../net/lobby/LanMultiplayer.js').LanMultiplayer} props.lan
 * @param {import('../../state/GameSession.js').GameSession} props.session
 * @param {string} [props.scope] LOBBY_SCOPE: players on one Wi-Fi (the default), or anywhere
 * @param {() => void} props.onStart called from the taps that lead into a match (unlocks audio)
 * @param {() => void} props.onBack back to the title menu
 */
export default function LanLobby({ lan, session, scope = LOBBY_SCOPE.LAN, onStart, onBack }) {
    const status = useLanStore((state) => state.status);
    const inRoom = useLanStore((state) => Boolean(state.room));
    // A room that is playing a match takes no change of ship.
    const shipLocked = useLanStore((state) => Boolean(state.room) && state.room.state !== ROOM_STATE.LOBBY);
    const t = useT();
    const global = scope === LOBBY_SCOPE.GLOBAL;
    /**
     * While the ship page is open: the ship the player had on opening it, which Back gives them
     * again; null while the page is closed. A plain value, not an object holding it: the React
     * Compiler reads what a handler depends on during render, so a handler that reads
     * `page.before` makes every render read it, also the ones where `page` is still null.
     */
    const [shipBefore, setShipBefore] = useState(null);

    useEffect(() => {
        lan.open(scope);
    }, [lan, scope]);
    useEffect(() => {
        if (shipLocked) setShipBefore(null);
    }, [shipLocked]);

    const leave = () => {
        lan.close();
        onBack();
    };

    // The room is told of every ship the player tries (pushProfile; it does nothing outside a
    // room): if the match starts while the page is open, they fly the one they are looking at.
    const cancelShipPage = () => {
        if (shipBefore !== null && session.settings.playerShip !== shipBefore) {
            session.updateSettings({ playerShip: shipBefore });
            lan.pushProfile();
        }
        setShipBefore(null);
    };
    if (shipBefore !== null && !shipLocked) {
        return (
            <Hangar
                session={session}
                title={t('mp.ship.title')}
                status={<ShipPageStatus />}
                note={VERSUS_DAMAGE < 1 ? t('mp.ship.versusNote', { percent: Math.round(VERSUS_DAMAGE * 100) }) : null}
                confirmLabel={t('ui.hangar.confirm')}
                onSelect={() => lan.pushProfile()}
                onConfirm={() => setShipBefore(null)}
                onBack={cancelShipPage}
            />
        );
    }
    const openShipPage = () => setShipBefore(session.settings.playerShip);

    return (
        <div className="eod-lan">
            <h2 className="eod-hangar-title">{t(global ? 'mp.global.title' : 'mp.lan.title')}</h2>
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
                    <ShipSummary onOpen={openShipPage} />
                    {global ? <GlobalBrowser lan={lan} onStart={onStart} /> : <RoomBrowser lan={lan} />}
                </>
            )}
            {inRoom && <Room lan={lan} onStart={onStart} onOpenShipPage={openShipPage} />}
            {!inRoom && <button type="button" className="eod-button" onClick={leave}>{t('ui.back')}</button>}
        </div>
    );
}
