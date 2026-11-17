import { useEffect, useState } from 'react';
import { TUTORIAL_ACTION, TUTORIAL_LAST_STEP, TUTORIAL_STEPS } from '../config/tutorial.js';
import { PHASE } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';
import { TUTORIAL_STATE } from '../state/Tutorial.js';
import { useVRActive } from '../xr/vrState.js';
import { tutorialKeys, tutorialParams, tutorialText } from './tutorialText.js';

/** Room left around a spotlit HUD element, in pixels. */
const SPOT_PADDING = 8;

/**
 * Where the element a card points at is on the page right now: { left, top, width, height,
 * round }, or null when there is none (yet). Followed every frame, since HUD panels appear,
 * move with the window and differ between a desk and a phone.
 */
function useElementBox(selector) {
    const [box, setBox] = useState(null);
    useEffect(() => {
        let frame = 0;
        let lastKey = null;
        const measure = () => {
            const element = selector ? document.querySelector(selector) : null;
            const rect = element?.getBoundingClientRect();
            const found = rect && rect.width > 0 && rect.height > 0;
            const next = found
                ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), round: getComputedStyle(element).borderRadius === '50%' }
                : null;
            const key = next ? `${next.left},${next.top},${next.width},${next.height},${next.round}` : '';
            if (key !== lastKey) {
                lastKey = key;
                setBox(next);
            }
            frame = requestAnimationFrame(measure);
        };
        frame = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(frame);
    }, [selector]);
    return selector ? box : null;
}

/**
 * The first-flight tutorial on the page (state/Tutorial.js decides what is asked; in a headset
 * xr/VRHud.jsx draws the card instead).
 *
 * While a step waits, the game stands still under a dark veil with a hole over the part of the
 * HUD the step is about, and a card says what to do. Nothing here takes the pointer except the
 * card's two buttons: the pilot answers an action step on the real controls (the keys, the
 * mouse, the on-screen stick and buttons under the veil), exactly as they will in a fight.
 */
export default function TutorialOverlay({ session }) {
    const tutorial = useGameStore((state) => state.tutorial);
    const phase = useGameStore((state) => state.phase);
    const hasTarget = useGameStore((state) => Boolean(state.target));
    const vrActive = useVRActive();
    const t = useT();
    const asking = tutorial?.state === TUTORIAL_STATE.ASK;
    const selector = asking ? TUTORIAL_STEPS[tutorial.id]?.target?.[tutorial.platform] ?? null : null;
    const box = useElementBox(selector);

    if (!tutorial || phase !== PHASE.PLAYING || vrActive) return null;
    const { id, kind, platform, index, total } = tutorial;
    const title = t(`tutorial.${id}.title`);

    if (!asking) {
        return (
            <div className="eod-tutorial">
                <div key={id} className="eod-tutorial-done">✓ {title} · {t('tutorial.done')}</div>
            </div>
        );
    }

    const keys = tutorialKeys(t, id, platform);
    const isInfo = kind === 'info';
    const place = TUTORIAL_STEPS[id]?.place ?? 'centre';
    return (
        <div className="eod-tutorial">
            {box ? (
                <div
                    className={`eod-tutorial-spot ${box.round ? 'eod-tutorial-spot--round' : ''}`}
                    style={{ left: box.left - SPOT_PADDING, top: box.top - SPOT_PADDING, width: box.width + SPOT_PADDING * 2, height: box.height + SPOT_PADDING * 2 }}
                />
            ) : <div className="eod-tutorial-veil" />}
            <div key={id} className={`eod-tutorial-card eod-tutorial-card--${place}`}>
                <div className="eod-tutorial-head">
                    <span>❚❚ {t('tutorial.header')}</span>
                    <span>{index} / {total}</span>
                </div>
                <h3 className="eod-tutorial-title">{title}</h3>
                <p className="eod-tutorial-text">{tutorialText(t, `tutorial.${id}.text`, platform, tutorialParams(t, tutorial))}</p>
                {keys.length > 0 && (
                    <div className="eod-tutorial-keys">
                        {keys.map((key) => <kbd key={key}>{key}</kbd>)}
                    </div>
                )}
                {tutorial.needsTarget && (
                    <p className={`eod-tutorial-check ${hasTarget ? 'eod-tutorial-check--ok' : ''}`}>
                        {hasTarget ? t('tutorial.targetLocked') : tutorialText(t, 'tutorial.needTarget', platform)}
                    </p>
                )}
                <div className="eod-tutorial-actions">
                    <button type="button" className="eod-tutorial-button" onClick={() => session.handleAction(TUTORIAL_ACTION.SKIP)}>
                        {t('tutorial.skip')}
                    </button>
                    <span className="eod-tutorial-waiting">{isInfo ? tutorialText(t, 'tutorial.nextHint', platform) : t('tutorial.waiting')}</span>
                    {isInfo && (
                        <button type="button" className="eod-tutorial-button eod-tutorial-button--primary" onClick={() => session.handleAction(TUTORIAL_ACTION.NEXT)}>
                            {t(id === TUTORIAL_LAST_STEP ? 'tutorial.finish' : 'tutorial.next')} ▸
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
