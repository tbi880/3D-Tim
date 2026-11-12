import { useState } from 'react';
import { DIFFICULTY_ORDER } from '../config/gameConfig.js';
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
            <p className="eod-setting-hint">{t(`ui.difficultyHint.${settings.difficulty}`)}</p>
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
            {view === 'main' ? (
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
            ) : (
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

function EndingScreen({ session }) {
    const stats = useGameStore((state) => state.stats);
    const t = useT();
    return (
        <div className="eod-screen eod-screen--ending">
            <h2 className="eod-screen-heading">{t('ui.ending.title')}</h2>
            <p className="eod-screen-text">{t('ui.ending.text')}</p>
            {stats && (
                <dl className="eod-stats">
                    <div><dt>{t('ui.ending.time')}</dt><dd>{formatDuration(stats.time)}</dd></div>
                    <div><dt>{t('ui.ending.kills')}</dt><dd>{stats.kills}</dd></div>
                    <div><dt>{t('ui.ending.losses')}</dt><dd>{stats.losses}</dd></div>
                </dl>
            )}
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
