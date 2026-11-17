import { useEffect, useState } from 'react';
import { DIFFICULTY_ORDER } from '../config/gameConfig.js';
import { GRAPHICS_ORDER } from '../config/graphics.js';
import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { FINAL_SCORE } from '../config/scoring.js';
import { LOCALES, LOCALE_LABELS } from '../i18n/index.js';
import { isTouchDevice } from '../input/device.js';
import { PHASE } from '../state/GameSession.js';
import { loadSave } from '../state/saveGame.js';
import { playerModelFile, requestShipModel } from '../scene/models/ShipModel.jsx';
import { useGameStore, useT } from '../state/gameStore.js';
import {
    enterFullscreen, exitFullscreen, FULLSCREEN_CHANGE_EVENTS, getFullscreenElement, isFullscreenSupported, setAutoFullscreenOff,
} from '../../utils/fullscreen.js';
import { VR_DIAGNOSTICS, enterVR, useVRActive, useVRSupported } from '../xr/vrState.js';
import { bucketURL } from '../../Settings';
import { MATCH_PANEL } from '../modes/battleRoyale/BattleRoyalePresenter.js';
import { LOBBY_SCOPE } from '../net/lobby/LanMultiplayer.js';
import { useLanStore } from '../net/lobby/lanStore.js';
import EquipmentPanel from './multiplayer/EquipmentPanel.jsx';
import LanLobby from './multiplayer/LanLobby.jsx';
import MatchCinematic from './multiplayer/MatchCinematic.jsx';
import MatchResults from './multiplayer/MatchResults.jsx';
import StarMapPanel from './multiplayer/StarMapPanel.jsx';
import RefitPanel from './RefitPanel.jsx';

/** Title screen, pause menu, game-over and ending screens, and the refit window. */

/** Phones fly in chase view only and have no keyboard, so their menus drop those rows. */
const IS_TOUCH = isTouchDevice();

/**
 * Safari on iPhone has no fullscreen for web pages; the only way to lose the browser bars is
 * to open the game from the home screen (see the web-app tags in urls/EchoesOfDawn.jsx).
 */
const NEEDS_HOME_SCREEN = IS_TOUCH && typeof window !== 'undefined' && !isFullscreenSupported()
    && !(window.navigator.standalone || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);

const CONTROL_ROWS = ['steer', 'throttle', 'roll', 'boost', 'beam', 'torpedo', 'target', 'power', 'view', 'skip', 'pause'];

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function ControlsList() {
    const t = useT();
    return (
        <dl className="eod-controls">
            {CONTROL_ROWS.map((row) => (
                <div key={row} className="eod-controls-row">
                    <dt>{t(`controls.${row}.keys`)}</dt>
                    <dd>{t(`controls.${row}`)}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * "Enter VR", shown only when the browser can open a headset session. While VR runs, the
 * game's menus are inside the headset (xr/VRMenu.js) and this button is greyed out.
 * The button opts out of click-to-fullscreen: entering fullscreen would use up the click that
 * the browser needs to allow the VR session.
 */
function VRButton({ onStart }) {
    const supported = useVRSupported();
    const active = useVRActive();
    const t = useT();
    if (!supported) return null;
    const start = () => {
        onStart?.();
        enterVR();
    };
    return (
        <>
            <button type="button" className="eod-button" data-skip-fullscreen="" disabled={active} onClick={start}>
                {t('ui.vr.enter')}
                <small>{t('ui.vr.enterHint')}</small>
            </button>
            {!active && <VRReport />}
            {!active && VR_DIAGNOSTICS && <VRBenchmarkResults />}
        </>
    );
}

/**
 * How the last VR session went, under the button that started it: a headset has no console,
 * so a session that showed nothing has to say here what happened. A player only sees one
 * that failed (in red), with what to do about it: reload the page and try again. A session
 * that went well is reported only with `?vrtest`.
 */
function VRReport() {
    const report = useGameStore((state) => state.vrReport);
    const t = useT();
    if (!report) return null;
    const summary = report.notStarted
        ? t('ui.vr.report.notStarted')
        : t('ui.vr.report.summary', { ...report, scale: Math.round(report.lowestScale * 100) });
    // A frame or two lost as a session starts is nothing; a session that drew nothing, or kept failing, is.
    const failed = report.notStarted || report.frames === 0 || report.errors > report.frames / 10;
    if (!failed && !VR_DIAGNOSTICS) return null;
    return (
        <p className={`eod-vr-report${failed ? ' eod-vr-report-failed' : ''}`}>
            {summary}
            {report.errors > 0 && <><br />{report.notStarted ? '' : `${t('ui.vr.report.errors', { count: report.errors })} `}{report.firstError}</>}
            {failed && <><br />{t('ui.vr.report.retry')}</>}
        </p>
    );
}

/** The last in-headset test (xr/vrBenchmark.js, shown with `?vrtest`): what each variant cost there. */
function VRBenchmarkResults() {
    const benchmark = useGameStore((state) => state.vrBenchmark);
    if (!benchmark) return null;
    return (
        <table className="eod-vr-benchmark">
            <thead><tr><th>VR test: {benchmark.test}</th><th>fps</th><th>script ms</th></tr></thead>
            <tbody>
                {benchmark.results.map(({ name, fps, js }) => <tr key={name}><td>{name}</td><td>{fps}</td><td>{js}</td></tr>)}
            </tbody>
        </table>
    );
}

/** Whether the page is fullscreen right now (also after Esc or the browser's own controls). */
function useIsFullscreen() {
    const [fullscreen, setFullscreen] = useState(() => Boolean(getFullscreenElement()));
    useEffect(() => {
        const update = () => setFullscreen(Boolean(getFullscreenElement()));
        for (const type of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(type, update);
        return () => { for (const type of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(type, update); };
    }, []);
    return fullscreen;
}

/**
 * Desktop fullscreen switch. Switching it off also stops clicks from going fullscreen again
 * (useClickToFullscreen) until it is switched back on. It opts out of click-to-fullscreen
 * itself, so the click is not undone by the page.
 */
function FullscreenSetting() {
    const fullscreen = useIsFullscreen();
    const t = useT();
    const toggle = () => {
        setAutoFullscreenOff(fullscreen);
        if (fullscreen) exitFullscreen();
        else enterFullscreen();
    };
    return (
        <button type="button" className="eod-setting" data-skip-fullscreen="" onClick={toggle}>
            <span>{t('ui.fullscreen')}</span><strong>{fullscreen ? t('ui.on') : t('ui.off')}</strong>
        </button>
    );
}

/** Language, difficulty, sound, pitch-inversion and tutorial switches (shared by title and pause menus). */
function SettingsRows({ session }) {
    const settings = useGameStore((state) => state.settings);
    const t = useT();
    const next = (list, current) => list[(list.indexOf(current) + 1) % list.length];
    return (
        <div className="eod-settings">
            <button type="button" className="eod-setting" onClick={() => session.updateSettings({ locale: next(LOCALES, settings.locale) })}>
                <span>{t('ui.language')}</span><strong>{LOCALE_LABELS[settings.locale]}</strong>
            </button>
            <button
                type="button"
                className="eod-setting"
                title={t(`ui.difficultyHint.${settings.difficulty}`)}
                onClick={() => session.updateSettings({ difficulty: next(DIFFICULTY_ORDER, settings.difficulty) })}
            >
                <span>{t('ui.difficulty')}</span><strong>{t(`ui.difficulty.${settings.difficulty}`)}</strong>
            </button>
            <button type="button" className="eod-setting" onClick={() => session.updateSettings({ muted: !settings.muted })}>
                <span>{t('ui.sound')}</span><strong>{settings.muted ? t('ui.off') : t('ui.on')}</strong>
            </button>
            <button type="button" className="eod-setting" onClick={() => session.updateSettings({ invertY: !settings.invertY })}>
                <span>{t('ui.invertY')}</span><strong>{settings.invertY ? t('ui.on') : t('ui.off')}</strong>
            </button>
            {!IS_TOUCH && (
                <button type="button" className="eod-setting" onClick={() => session.handleAction('toggleView')}>
                    <span>{t('ui.view')}</span><strong>{t(`ui.view.${settings.cameraMode}`)}</strong>
                </button>
            )}
            <button
                type="button"
                className="eod-setting"
                title={t(`ui.graphicsHint.${settings.graphics}`)}
                onClick={() => session.updateSettings({ graphics: next(GRAPHICS_ORDER, settings.graphics) })}
            >
                <span>{t('ui.graphics')}</span><strong>{t(`ui.graphics.${settings.graphics}`)}</strong>
            </button>
            {/* The prologue's first-flight tutorial: it switches itself off once done, and back on here. */}
            <button type="button" className="eod-setting" onClick={() => session.updateSettings({ tutorial: !settings.tutorial })}>
                <span>{t('ui.tutorial')}</span><strong>{settings.tutorial ? t('ui.on') : t('ui.off')}</strong>
            </button>
            {!IS_TOUCH && isFullscreenSupported() && <FullscreenSetting />}
            <p className="eod-setting-hint">{t(`ui.difficultyHint.${settings.difficulty}`)}</p>
        </div>
    );
}

/** One row of a ship card: a label and a bar of 1-5 pips. */
function Rating({ label, value }) {
    return (
        <div className="eod-rating">
            <span>{label}</span>
            <div className="eod-rating-pips">
                {Array.from({ length: RATING_MAX }, (_, index) => (
                    <i key={index} className={index < value ? 'eod-rating-pip eod-rating-pip--on' : 'eod-rating-pip'} />
                ))}
            </div>
        </div>
    );
}

/**
 * Hangar pictures: every player ship from three views, rendered from the game's models by
 * tools/game-models/player-ships/render_previews.mjs and hosted in the asset bucket.
 */
const HANGAR_VIEWS = ['front', 'side', 'rear'];
const hangarImage = (classId, view) => `${bucketURL}game/player/${classId}-${view}.webp`;

/** Starts fetching every hangar picture, so switching ships shows the next one at once. */
function usePreloadHangarImages() {
    useEffect(() => {
        for (const ship of PLAYER_SHIPS) {
            for (const view of HANGAR_VIEWS) {
                const image = new Image();
                image.src = hangarImage(ship.classId, view);
            }
        }
    }, []);
}

/** The chosen ship from three sides. */
function ShipViews({ classId }) {
    const t = useT();
    return (
        <div className="eod-hangar-views">
            {HANGAR_VIEWS.map((view) => {
                const src = hangarImage(classId, view);
                return (
                    <figure key={view} className="eod-hangar-view">
                        {src && <img src={src} alt={`${t(`ship.${classId}`)} - ${t(`ui.hangar.view.${view}`)}`} draggable={false} />}
                        <figcaption>{t(`ui.hangar.view.${view}`)}</figcaption>
                    </figure>
                );
            })}
        </div>
    );
}

/** The hangar: pick the ship to fly before a new game starts. */
function Hangar({ session, onLaunch, onBack }) {
    const selected = useGameStore((state) => state.settings.playerShip);
    const t = useT();
    usePreloadHangarImages();
    return (
        <div className="eod-hangar">
            <h2 className="eod-hangar-title">{t('ui.hangar.title')}</h2>
            <ShipViews classId={selected} />
            {/* Phones held sideways show the chosen ship's ratings here instead of on every card. */}
            <div className="eod-hangar-stats">
                {RATING_ORDER.map((rating) => (
                    <Rating key={rating} label={t(`ui.rating.${rating}`)} value={PLAYER_SHIPS.find((ship) => ship.classId === selected)?.ratings[rating] ?? 0} />
                ))}
            </div>
            <div className="eod-hangar-ships">
                {PLAYER_SHIPS.map(({ classId, ratings }) => (
                    <button
                        key={classId}
                        type="button"
                        className={`eod-ship-card ${classId === selected ? 'eod-ship-card--selected' : ''}`}
                        onClick={() => session.updateSettings({ playerShip: classId })}
                    >
                        <img className="eod-ship-card-image" src={hangarImage(classId, 'front')} alt="" draggable={false} />
                        <strong>{t(`ship.${classId}`)}</strong>
                        <em>{t(`playerShip.${classId}.role`)}</em>
                        <p>{t(`playerShip.${classId}.text`)}</p>
                        {RATING_ORDER.map((rating) => <Rating key={rating} label={t(`ui.rating.${rating}`)} value={ratings[rating]} />)}
                    </button>
                ))}
            </div>
            <div className="eod-hangar-actions">
                <button type="button" className="eod-button" onClick={onBack}>{t('ui.back')}</button>
                <button type="button" className="eod-button eod-button--primary" onClick={onLaunch}>{t('ui.hangar.launch')}</button>
            </div>
        </div>
    );
}

/**
 * Between "Launch" and the first frame of flight: makes sure the chosen ship's model is in
 * (see requestShipModel; normally instant, the loading screen already fetched it), then
 * starts. The game never begins with a ship that is not there.
 */
function ShipLoading({ classId, onReady, onBack }) {
    const shipLoad = useGameStore((state) => state.shipLoad);
    const t = useT();
    const status = shipLoad?.classId === classId ? shipLoad.status : 'loading';
    useEffect(() => {
        if (status === 'ready') onReady();
    }, [status, onReady]);
    const src = hangarImage(classId, 'side');
    return (
        <div className="eod-ship-loading">
            {src && <img className="eod-ship-loading-image" src={src} alt="" draggable={false} />}
            {status === 'failed' ? (
                <>
                    <p className="eod-screen-text">{t('ui.hangar.loadFailed', { ship: t(`ship.${classId}`) })}</p>
                    <div className="eod-hangar-actions">
                        <button type="button" className="eod-button" onClick={onBack}>{t('ui.back')}</button>
                        <button type="button" className="eod-button eod-button--primary" onClick={() => requestShipModel(classId)}>{t('ui.hangar.retry')}</button>
                    </div>
                </>
            ) : (
                <>
                    <p className="eod-ship-loading-text">{t('ui.hangar.loading', { ship: t(`ship.${classId}`) })}</p>
                    <div className="eod-ship-loading-bar"><span /></div>
                </>
            )}
        </div>
    );
}

/** The ship a saved game continues with (as World.restore picks it). */
function savedShipClass(fallback) {
    const classId = loadSave()?.world?.player?.classId;
    return playerModelFile(classId) ? classId : fallback;
}

function TitleScreen({ session, lan, onStart }) {
    const hasSave = useGameStore((state) => state.hasSave);
    const saveCheckpointId = useGameStore((state) => state.saveCheckpointId);
    const inRoom = useLanStore((state) => Boolean(state.room));
    const lobbyScope = useLanStore((state) => state.scope);
    const t = useT();
    const [chosenView, setView] = useState('main');
    // Back from a match the player is still in its room: that is where the title screen opens,
    // in the lobby they went in by (one Wi-Fi, or anywhere).
    const view = inRoom ? (lobbyScope === LOBBY_SCOPE.GLOBAL ? 'global' : 'lan') : chosenView;
    const [confirmingNewGame, setConfirmingNewGame] = useState(false);
    /** While the ship model loads: { classId, start, backTo } for the game about to begin. */
    const [launching, setLaunching] = useState(null);

    const startNewGame = () => {
        if (hasSave && !confirmingNewGame) {
            setConfirmingNewGame(true);
            return;
        }
        setView('hangar');
    };
    // Audio is unlocked here, in the tap itself (iOS allows it only inside a user gesture);
    // the game starts once the ship's model is in (ShipLoading).
    const beginLoading = (classId, start, backTo) => {
        onStart();
        requestShipModel(classId);
        setLaunching({ classId, start, backTo });
        setView('loading');
    };
    const launch = () => beginLoading(session.settings.playerShip, () => session.newGame(), 'hangar');
    const continueGame = () => beginLoading(savedShipClass(session.settings.playerShip), () => session.continueGame(), 'main');

    return (
        <div className={`eod-screen eod-screen--title ${view === 'hangar' || view === 'loading' || view === 'lan' || view === 'global' ? 'eod-screen--hangar' : ''}`}>
            <div className="eod-title-block">
                <p className="eod-title-kicker">{t('ui.subtitle')}</p>
                <h1 className="eod-title">{t('ui.title')}</h1>
                <p className="eod-title-tagline">{t('ui.tagline')}</p>
                <p className="eod-touch-hint">{t('ui.touchHint')}</p>
                {NEEDS_HOME_SCREEN && <p className="eod-touch-hint eod-home-screen-hint">{t('ui.homeScreenHint')}</p>}
            </div>
            {view === 'hangar' && <Hangar session={session} onLaunch={launch} onBack={() => setView('main')} />}
            {view === 'lan' && <LanLobby lan={lan} session={session} onStart={onStart} onBack={() => setView('main')} />}
            {view === 'global' && <LanLobby lan={lan} session={session} scope={LOBBY_SCOPE.GLOBAL} onStart={onStart} onBack={() => setView('main')} />}
            {view === 'loading' && launching && (
                <ShipLoading classId={launching.classId} onReady={launching.start} onBack={() => setView(launching.backTo)} />
            )}
            {view === 'main' && (
                <div className="eod-menu">
                    {hasSave && (
                        <button type="button" className="eod-button eod-button--primary" onClick={continueGame}>
                            {t('ui.continue')}
                            <small>{t('ui.continueFrom', { checkpoint: t(`checkpoint.${saveCheckpointId}`) })}</small>
                        </button>
                    )}
                    <button type="button" className={`eod-button ${hasSave ? '' : 'eod-button--primary'}`} onClick={startNewGame}>
                        {t('ui.newGame')}
                        {confirmingNewGame && <small>{t('ui.confirmNewGame')}</small>}
                    </button>
                    <button type="button" className="eod-button" onClick={() => setView('global')}>
                        {t('mp.global.open')}
                        <small>{t('mp.global.openHint')}</small>
                    </button>
                    <button type="button" className="eod-button" onClick={() => setView('lan')}>
                        {t('mp.lan.open')}
                        <small>{t('mp.lan.openHint')}</small>
                    </button>
                    <VRButton onStart={onStart} />
                    {!IS_TOUCH && <button type="button" className="eod-button" onClick={() => setView('controls')}>{t('ui.controls')}</button>}
                    <SettingsRows session={session} />
                </div>
            )}
            {view === 'controls' && (
                <div className="eod-menu">
                    <ControlsList />
                    <button type="button" className="eod-button" onClick={() => setView('main')}>{t('ui.back')}</button>
                </div>
            )}
        </div>
    );
}

/** The menu during a multiplayer match. Nothing pauses: the match goes on behind it. */
function MatchMenu({ session, lan, onStart }) {
    const t = useT();
    return (
        <div className="eod-screen eod-screen--overlay">
            <h2 className="eod-screen-heading">{t('mp.pause.title')}</h2>
            <p className="eod-screen-text">{t('mp.pause.note')}</p>
            <div className="eod-menu">
                <button type="button" className="eod-button eod-button--primary" onClick={() => session.resume()}>{t('ui.resume')}</button>
                <button type="button" className="eod-button" onClick={() => lan.leaveRoom()}>{t('mp.pause.leave')}</button>
                <VRButton onStart={onStart} />
                <SettingsRows session={session} />
                {!IS_TOUCH && <ControlsList />}
            </div>
        </div>
    );
}

/** What a match puts over the flight view: its introduction and ending, the refit window, the star map and the equipment. */
function MatchPanels({ session }) {
    const panel = useGameStore((state) => state.matchPanel);
    return (
        <>
            <MatchCinematic />
            <RefitPanel session={session} />
            {panel === MATCH_PANEL.MAP && <StarMapPanel session={session} />}
            {panel === MATCH_PANEL.EQUIPMENT && <EquipmentPanel session={session} />}
        </>
    );
}

function PauseMenu({ session, onStart }) {
    const hasSave = useGameStore((state) => state.hasSave);
    const t = useT();
    return (
        <div className="eod-screen eod-screen--overlay">
            <h2 className="eod-screen-heading">{t('ui.paused')}</h2>
            <div className="eod-menu">
                <button type="button" className="eod-button eod-button--primary" onClick={() => session.resume()}>{t('ui.resume')}</button>
                {hasSave && <button type="button" className="eod-button" onClick={() => session.continueGame()}>{t('ui.restartCheckpoint')}</button>}
                <button type="button" className="eod-button" onClick={() => session.enterTitle()}>{t('ui.quitToTitle')}</button>
                <VRButton onStart={onStart} />
                <SettingsRows session={session} />
                {!IS_TOUCH && <ControlsList />}
            </div>
        </div>
    );
}

function GameOverScreen({ session }) {
    const reason = useGameStore((state) => state.gameOverReason) ?? 'player';
    const t = useT();
    return (
        <div className="eod-screen eod-screen--overlay eod-screen--failure">
            <h2 className="eod-screen-heading">{t(`ui.gameOver.${reason}.title`)}</h2>
            <p className="eod-screen-text">{t(`ui.gameOver.${reason}.text`)}</p>
            <div className="eod-menu">
                <button type="button" className="eod-button eod-button--primary" onClick={() => session.retry()}>{t('ui.retry')}</button>
                <button type="button" className="eod-button" onClick={() => session.enterTitle()}>{t('ui.quitToTitle')}</button>
            </div>
        </div>
    );
}

const formatPoints = (points) => Math.round(points).toLocaleString();

/** The ending scoreboard: what each part of the final score came from, then the total. */
function Scoreboard({ stats, score }) {
    const t = useT();
    const rows = [
        { label: t('ui.score.combat'), detail: t('ui.score.kills', { count: stats.kills }), value: `+${formatPoints(score.combat)}` },
        { label: t('ui.score.mission'), detail: '', value: `+${formatPoints(score.missionBonus)}` },
        {
            label: t('ui.score.time'),
            detail: t('ui.score.par', { time: formatDuration(stats.time), par: formatDuration(FINAL_SCORE.parSeconds) }),
            value: `+${formatPoints(score.timeBonus)}`,
        },
        { label: t('ui.score.losses'), detail: t('ui.score.lossCount', { count: stats.losses }), value: score.lossPenalty > 0 ? `−${formatPoints(score.lossPenalty)}` : '0', negative: score.lossPenalty > 0 },
        { label: t('ui.score.difficulty'), detail: t(`ui.difficulty.${score.difficultyId}`), value: `×${score.multiplier.toFixed(1)}` },
    ];
    return (
        <div className="eod-scoreboard">
            <div className="eod-scoreboard-rows">
                {rows.map(({ label, detail, value, negative }) => (
                    <div key={label} className="eod-scoreboard-row">
                        <span className="eod-scoreboard-label">{label}</span>
                        <span className="eod-scoreboard-detail">{detail}</span>
                        <span className={`eod-scoreboard-value ${negative ? 'eod-scoreboard-value--negative' : ''}`}>{value}</span>
                    </div>
                ))}
            </div>
            <div className="eod-scoreboard-total">
                <span className={`eod-rank eod-rank--${score.rank}`}>{score.rank}</span>
                <div>
                    <span className="eod-scoreboard-label">{t('ui.score.total')}</span>
                    <strong>{formatPoints(score.total)}</strong>
                    <small>
                        {score.isRecord
                            ? t('ui.score.newRecord')
                            : t('ui.score.best', { score: formatPoints(score.previousBest ?? 0) })}
                    </small>
                </div>
            </div>
        </div>
    );
}

function EndingScreen({ session }) {
    const stats = useGameStore((state) => state.stats);
    const finalScore = useGameStore((state) => state.finalScore);
    const t = useT();
    return (
        <div className="eod-screen eod-screen--ending">
            <h2 className="eod-screen-heading">{t('ui.ending.title')}</h2>
            <p className="eod-screen-text">{t('ui.ending.text')}</p>
            {stats && finalScore && <Scoreboard stats={stats} score={finalScore} />}
            <div className="eod-menu">
                <a className="eod-button eod-button--primary" href="/ship_casino">{t('ui.ending.casino')}</a>
                <a className="eod-button" href="/">{t('ui.ending.site')}</a>
                <button type="button" className="eod-button" onClick={() => session.enterTitle()}>{t('ui.ending.again')}</button>
            </div>
            <p className="eod-screen-footnote">{t('ui.ending.thanks')}</p>
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../state/GameSession.js').GameSession} props.session
 * @param {import('../net/lobby/LanMultiplayer.js').LanMultiplayer} props.lan
 * @param {() => void} props.onStart called from the click that starts play (unlocks audio)
 */
export default function Menus({ session, lan, onStart }) {
    const phase = useGameStore((state) => state.phase);
    const inMatch = useGameStore((state) => Boolean(state.match));
    const assetsReady = useGameStore((state) => state.assetsReady);
    if (!assetsReady) return null;
    switch (phase) {
        case PHASE.TITLE: return <TitleScreen session={session} lan={lan} onStart={onStart} />;
        case PHASE.PAUSED: return inMatch ? <MatchMenu session={session} lan={lan} onStart={onStart} /> : <PauseMenu session={session} onStart={onStart} />;
        case PHASE.GAME_OVER: return <GameOverScreen session={session} />;
        case PHASE.ENDING: return <EndingScreen session={session} />;
        case PHASE.MATCH_OVER: return <MatchResults lan={lan} />;
        // In flight the only menus are the windows that open over the view: the refit window,
        // and in a match the star map.
        case PHASE.PLAYING: return inMatch ? <MatchPanels session={session} /> : <RefitPanel session={session} />;
        default: return null;
    }
}
