import { useState } from 'react';
import { DIFFICULTY_ORDER } from '../config/gameConfig.js';
import { GRAPHICS_ORDER } from '../config/graphics.js';
import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { FINAL_SCORE } from '../config/scoring.js';
import { LOCALES, LOCALE_LABELS } from '../i18n/index.js';
import { PHASE } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';

/** Title screen, pause menu, game-over and ending screens. */

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

/** Language, difficulty, sound and pitch-inversion switches (shared by title and pause menus). */
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
            <button type="button" className="eod-setting" onClick={() => session.handleAction('toggleView')}>
                <span>{t('ui.view')}</span><strong>{t(`ui.view.${settings.cameraMode}`)}</strong>
            </button>
            <button type="button" className="eod-setting" onClick={() => session.updateSettings({ autoFire: !settings.autoFire })}>
                <span>{t('ui.autoFire')}</span><strong>{settings.autoFire ? t('ui.on') : t('ui.off')}</strong>
            </button>
            <button
                type="button"
                className="eod-setting"
                title={t(`ui.graphicsHint.${settings.graphics}`)}
                onClick={() => session.updateSettings({ graphics: next(GRAPHICS_ORDER, settings.graphics) })}
            >
                <span>{t('ui.graphics')}</span><strong>{t(`ui.graphics.${settings.graphics}`)}</strong>
            </button>
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

/** The hangar: pick the ship to fly before a new game starts. */
function Hangar({ session, onLaunch, onBack }) {
    const selected = useGameStore((state) => state.settings.playerShip);
    const t = useT();
    return (
        <div className="eod-hangar">
            <h2 className="eod-hangar-title">{t('ui.hangar.title')}</h2>
            <div className="eod-hangar-ships">
                {PLAYER_SHIPS.map(({ classId, ratings }) => (
                    <button
                        key={classId}
                        type="button"
                        className={`eod-ship-card ${classId === selected ? 'eod-ship-card--selected' : ''}`}
                        onClick={() => session.updateSettings({ playerShip: classId })}
                    >
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

function TitleScreen({ session, onStart }) {
    const hasSave = useGameStore((state) => state.hasSave);
    const saveCheckpointId = useGameStore((state) => state.saveCheckpointId);
    const t = useT();
    const [view, setView] = useState('main');
    const [confirmingNewGame, setConfirmingNewGame] = useState(false);

    const startNewGame = () => {
        if (hasSave && !confirmingNewGame) {
            setConfirmingNewGame(true);
            return;
        }
        setView('hangar');
    };
    const launch = () => {
        onStart();
        session.newGame();
    };
    const continueGame = () => {
        onStart();
        session.continueGame();
    };

    return (
        <div className="eod-screen eod-screen--title">
            <div className="eod-title-block">
                <p className="eod-title-kicker">{t('ui.subtitle')}</p>
                <h1 className="eod-title">{t('ui.title')}</h1>
                <p className="eod-title-tagline">{t('ui.tagline')}</p>
                <p className="eod-touch-hint">{t('ui.touchHint')}</p>
            </div>
            {view === 'hangar' && <Hangar session={session} onLaunch={launch} onBack={() => setView('main')} />}
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
                    <button type="button" className="eod-button" onClick={() => setView('controls')}>{t('ui.controls')}</button>
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

function PauseMenu({ session }) {
    const hasSave = useGameStore((state) => state.hasSave);
    const t = useT();
    return (
        <div className="eod-screen eod-screen--overlay">
            <h2 className="eod-screen-heading">{t('ui.paused')}</h2>
            <div className="eod-menu">
                <button type="button" className="eod-button eod-button--primary" onClick={() => session.resume()}>{t('ui.resume')}</button>
                {hasSave && <button type="button" className="eod-button" onClick={() => session.continueGame()}>{t('ui.restartCheckpoint')}</button>}
                <button type="button" className="eod-button" onClick={() => session.enterTitle()}>{t('ui.quitToTitle')}</button>
                <SettingsRows session={session} />
                <ControlsList />
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
 * @param {() => void} props.onStart called from the click that starts play (unlocks audio)
 */
export default function Menus({ session, onStart }) {
    const phase = useGameStore((state) => state.phase);
    const assetsReady = useGameStore((state) => state.assetsReady);
    if (!assetsReady) return null;
    switch (phase) {
        case PHASE.TITLE: return <TitleScreen session={session} onStart={onStart} />;
        case PHASE.PAUSED: return <PauseMenu session={session} />;
        case PHASE.GAME_OVER: return <GameOverScreen session={session} />;
        case PHASE.ENDING: return <EndingScreen session={session} />;
        default: return null;
    }
}
