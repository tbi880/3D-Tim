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
 *   left thumb  - steering stick
 *   any finger  - slid up or down anywhere on the open view: the throttle (read by
 *                 input/InputController.js on the view under these controls; shown as a bar and
 *                 a percentage in the status panel top left, GameHud.jsx)
 *   right thumb - four buttons in a diamond, like a gamepad's: FIRE (hold) below, TORPEDO to
 *                 the left, BURN (hold) to the right, LOCK above (tap: the hostile nearest the
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
    const origin = useRef(null);
    const lockTimer = useRef(null);

    const stopLockCycle = () => {
        clearTimeout(lockTimer.current);
        lockTimer.current = null;
    };
    // The buttons go away with the flight (pause, a cutscene): a finger still down must not keep cycling.
    useEffect(() => stopLockCycle, [phase]);
    // What a sliding finger asks for goes to the store: the throttle bar in the status panel shows
    // it at once, ahead of the ship easing towards it.
    useEffect(() => {
        const stop = input.onThrottleSwipe((value) => useGameStore.setState({ throttleSwipe: value }));
        return () => {
            stop();
            useGameStore.setState({ throttleSwipe: null });
        };
    }, [input]);

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
            <div className="eod-touch-stick" onPointerDown={startStick} onPointerMove={moveStick} onPointerUp={endStick} onPointerCancel={endStick}>
                <div className="eod-touch-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="eod-touch-buttons">
                {/* A diamond, like a gamepad's face buttons (hud.css places them by these names). */}
                <button type="button" className="eod-touch-button eod-touch-button--top" data-tutorial="lock" {...lock}>{t('hud.lock')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--left eod-touch-button--torpedo" data-tutorial="torpedo" {...hold('fireSecondary')}>{t('hud.torp')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--right" data-tutorial="boost" {...hold('boost')}>{t('hud.boost')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--bottom eod-touch-button--fire" data-tutorial="fire" {...hold('firePrimary')}>{t('hud.fire')}</button>
            </div>
            <button type="button" className="eod-touch-pause" aria-label={t('controls.pause')} {...tap('pause')}>II</button>
        </div>
    );
}
