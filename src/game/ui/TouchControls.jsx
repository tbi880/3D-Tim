import { useRef, useState } from 'react';
import { PHASE } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';

const STICK_TRAVEL = 56;

/**
 * On-screen controls for phones and tablets (shown only where the pointer is a finger):
 *
 *   left thumb  - steering stick, with a throttle slider beside it
 *   right thumb - FIRE (hold), TORPEDO, BURN (hold), LOCK (next target)
 *   top left    - pause
 *
 * Phones keep only what a thumb pilot needs: the view is locked to chase, the power mode stays
 * balanced, and a comms line is revealed or skipped by tapping it (CommsPanel.jsx).
 *
 * With the "auto-fire" setting on (the default on touch devices) the beams fire by
 * themselves whenever a hostile is inside the ring, so flying only needs one thumb.
 *
 * The `data-tutorial` names are how the first-flight tutorial finds a button to light up
 * (config/tutorial.js).
 */
export default function TouchControls({ input, session }) {
    const t = useT();
    const phase = useGameStore((state) => state.phase);
    const autoFire = useGameStore((state) => state.settings.autoFire);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const [throttle, setThrottle] = useState(0.5);
    /** True while a finger is on the throttle bar; otherwise the bar shows the ship's own throttle. */
    const [settingThrottle, setSettingThrottle] = useState(false);
    const shipThrottle = useGameStore((state) => state.hud?.throttle);
    const origin = useRef(null);

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

    /** The slider's height maps straight onto 0..100% throttle. */
    const dragThrottle = (event) => {
        if (event.type === 'pointerdown') {
            event.currentTarget.setPointerCapture(event.pointerId);
            setSettingThrottle(true);
        } else if (event.buttons === 0 && event.pointerType !== 'touch') return;
        const rect = event.currentTarget.getBoundingClientRect();
        const value = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
        setThrottle(value);
        input.setThrottleTarget(value);
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

    return (
        <div className="eod-touch">
            <div
                className="eod-touch-throttle"
                onPointerDown={dragThrottle}
                onPointerMove={dragThrottle}
                onPointerUp={() => setSettingThrottle(false)}
                onPointerCancel={() => setSettingThrottle(false)}
            >
                <div className="eod-touch-throttle-fill" style={{ height: `${(settingThrottle ? throttle : shipThrottle ?? throttle) * 100}%` }} />
                <span>{t('hud.throttle')}</span>
            </div>
            <div className="eod-touch-stick" onPointerDown={startStick} onPointerMove={moveStick} onPointerUp={endStick} onPointerCancel={endStick}>
                <div className="eod-touch-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="eod-touch-buttons">
                <button type="button" className="eod-touch-button" data-tutorial="lock" {...tap('cycleTarget')}>{t('hud.lock')}</button>
                <button type="button" className="eod-touch-button" data-tutorial="boost" {...hold('boost')}>{t('hud.boost')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--torpedo" data-tutorial="torpedo" {...hold('fireSecondary')}>{t('hud.torp')}</button>
                <button type="button" className={`eod-touch-button eod-touch-button--fire ${autoFire ? 'eod-touch-button--auto' : ''}`} data-tutorial="fire" {...hold('firePrimary')}>
                    {t('hud.fire')}{autoFire && <small>AUTO</small>}
                </button>
            </div>
            <button type="button" className="eod-touch-pause" aria-label={t('controls.pause')} {...tap('pause')}>II</button>
        </div>
    );
}
