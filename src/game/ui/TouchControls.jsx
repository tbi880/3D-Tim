import { useRef, useState } from 'react';
import { PHASE } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';

const STICK_TRAVEL = 52;

/**
 * On-screen controls for phones and tablets: a steering stick on the left, action buttons
 * on the right. Throttle stays where the game sets it (W / S are keyboard-only), which
 * keeps the touch layout to what two thumbs can manage.
 */
export default function TouchControls({ input, session }) {
    const t = useT();
    const phase = useGameStore((state) => state.phase);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const origin = useRef(null);

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

    if (phase !== PHASE.PLAYING) return null;

    return (
        <div className="eod-touch">
            <div className="eod-touch-stick" onPointerDown={startStick} onPointerMove={moveStick} onPointerUp={endStick} onPointerCancel={endStick}>
                <div className="eod-touch-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
            </div>
            <div className="eod-touch-buttons">
                <button type="button" className="eod-touch-button" onPointerDown={() => session.handleAction('cycleTarget')}>{t('hud.lock')}</button>
                <button type="button" className="eod-touch-button" {...hold('boost')}>{t('hud.boost')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--torpedo" {...hold('fireSecondary')}>{t('hud.torp')}</button>
                <button type="button" className="eod-touch-button eod-touch-button--fire" {...hold('firePrimary')}>{t('hud.fire')}</button>
            </div>
            <button type="button" className="eod-touch-pause" onPointerDown={() => session.handleAction('pause')}>II</button>
            <button type="button" className="eod-touch-skip" onPointerDown={() => session.handleAction('skip')}>▸▸</button>
        </div>
    );
}
