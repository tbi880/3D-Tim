import { useEffect, useRef, useState } from 'react';
import { PHASE } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';

const STICK_TRAVEL = 56;
/** LOCK kept down this long (ms) starts stepping through the hostiles, one more every LOCK_REPEAT_MS. */
const LOCK_HOLD_MS = 450;
const LOCK_REPEAT_MS = 650;

/**
 * On-screen controls for phones and tablets (shown only where the pointer is a finger):
 *
 *   left thumb  - steering stick, with a throttle gauge beside it
 *   any finger  - slid up or down anywhere on the open view: the throttle (read by
 *                 input/InputController.js on the view under these controls; the gauge and the
 *                 percentage that shows meanwhile only report it)
 *   right thumb - FIRE (hold), TORPEDO, BURN (hold), LOCK (tap: the hostile nearest the
 *                 crosshair, like R on a keyboard; held: steps through the others, like T)
 *   top left    - pause
 *
 * Phones keep only what a thumb pilot needs: the view is locked to chase, the power mode stays
 * balanced, and a comms line is revealed or skipped by tapping it (CommsPanel.jsx).
 *
 * The `data-tutorial` names are how the first-flight tutorial finds a button to light up
 * (config/tutorial.js).
 */
export default function TouchControls({ input, session }) {
    const t = useT();
    const phase = useGameStore((state) => state.phase);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    /** The throttle a finger sliding on the view is asking for right now, or null: then the gauge shows the ship's own. */
    const [swipeThrottle, setSwipeThrottle] = useState(null);
    const shipThrottle = useGameStore((state) => state.hud?.throttle);
    const origin = useRef(null);
    const lockTimer = useRef(null);

    const stopLockCycle = () => {
        clearTimeout(lockTimer.current);
        lockTimer.current = null;
    };
    // The buttons go away with the flight (pause, a cutscene): a finger still down must not keep cycling.
    useEffect(() => stopLockCycle, [phase]);
    useEffect(() => input.onThrottleSwipe(setSwipeThrottle), [input]);

    if (phase !== PHASE.PLAYING) return null;

    const moveStick = (event) => {
        if (!origin.current) return;
        let dx = event.clientX - origin.current.x;
        let dy = event.clientY - origin.current.y;
        const length = Math.hypot(dx, dy);
        if (length > STICK_TRAVEL) {
            dx *= STICK_TRAVEL / length;
            dy *= STICK_TRAVEL / length;
        }
        setKnob({ x: dx, y: dy });
        input.setTouchStick(dx / STICK_TRAVEL, -dy / STICK_TRAVEL);
    };
    const startStick = (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, y: event.clientY };
    };
    const endStick = () => {
        origin.current = null;
        setKnob({ x: 0, y: 0 });
        input.setTouchStick(0, 0);
    };

    /** Pointer handlers for a button that maps to a held control. */
    const hold = (name) => ({
        onPointerDown: (event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            input.setHeld(name, true);
        },
        onPointerUp: () => input.setHeld(name, false),
        onPointerCancel: () => input.setHeld(name, false),
    });
    const tap = (action) => ({ onPointerDown: () => session.handleAction(action) });
    /** LOCK: a tap takes the hostile nearest the crosshair; kept down, it goes on to the next ones. */
    const lock = {
        onPointerDown: (event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            stopLockCycle();
            session.handleAction('targetCrosshair');
            const cycle = () => {
                session.handleAction('cycleTarget');
                lockTimer.current = setTimeout(cycle, LOCK_REPEAT_MS);
            };
            lockTimer.current = setTimeout(cycle, LOCK_HOLD_MS);
        },
        onPointerUp: stopLockCycle,
        onPointerCancel: stopLockCycle,
    };

    return (
        <div className="eod-touch">
            {/* A gauge, not a control: a finger on it falls through to the view and swipes like anywhere else. */}
            <div className={`eod-touch-throttle ${swipeThrottle !== null ? 'eod-touch-throttle--swiping' : ''}`}>
                <div className="eod-touch-throttle-fill" style={{ height: `${(swipeThrottle ?? shipThrottle ?? 0) * 100}%` }} />
                <span>{t('hud.throttle')}</span>
            </div>
            {swipeThrottle !== null && (
                <div className="eod-touch-throttle-readout">{t('hud.throttle')} {Math.round(swipeThrottle * 100)}%</div>
            )}
            <div className="eod-touch-stick" onPointerDown={startStick} onPointerMove={moveStick} onPointerUp={endStick} onPointerCancel={endStick}>
                <div className="eod-touch-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="eod-touch-buttons">
                <button type="button" className="eod-touch-button" data-tutorial="lock" {...lock}>{t('hud.lock')}</button>
                <button type="button" className="eod-touch-button" data-tutorial="boost" {...hold('boost')}>{t('hud.boost')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--torpedo" data-tutorial="torpedo" {...hold('fireSecondary')}>{t('hud.torp')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--fire" data-tutorial="fire" {...hold('firePrimary')}>{t('hud.fire')}</button>
            </div>
            <button type="button" className="eod-touch-pause" aria-label={t('controls.pause')} {...tap('pause')}>II</button>
        </div>
    );
}
