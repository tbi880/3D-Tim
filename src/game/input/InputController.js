/**
 * Turns keyboard, mouse and touch input into the two things the game understands:
 *  - held `controls` (stick deflection, throttle, triggers), read once per frame;
 *  - one-shot `actions` ('cycleTarget', 'pause'...), delivered through `onAction`.
 *
 * Steering uses the pointer position relative to the middle of the screen as a virtual
 * joystick, so no pointer lock is needed and the site's own overlay stays clickable.
 */

/** Pointer distance from the centre (as a fraction of the shorter screen side) for full deflection. */
const STICK_RADIUS = 0.36;
const STICK_DEAD_ZONE = 0.07;

const HELD_KEYS = Object.freeze({
    KeyW: 'throttleUp',
    KeyS: 'throttleDown',
    KeyA: 'rollLeft',
    KeyD: 'rollRight',
    ArrowLeft: 'yawLeft',
    ArrowRight: 'yawRight',
    ArrowUp: 'pitchUp',
    ArrowDown: 'pitchDown',
    ShiftLeft: 'boost',
    ShiftRight: 'boost',
    KeyF: 'firePrimary',
    Space: 'fireSecondary',
});

const ACTION_KEYS = Object.freeze({
    KeyT: 'cycleTarget',
    Tab: 'cycleTarget',
    KeyR: 'targetCrosshair',
    Digit1: 'power:balanced',
    Digit2: 'power:attack',
    Digit3: 'power:defense',
    Escape: 'pause',
    KeyP: 'pause',
    Enter: 'skip',
    NumpadEnter: 'skip',
    KeyM: 'toggleMute',
    KeyV: 'toggleView',
    KeyC: 'toggleView',
    // Multiplayer only (the game mode's presenter handles them; they do nothing in the campaign).
    KeyG: 'match:map',
    KeyU: 'match:refit',
    KeyB: 'match:summon',
});

export class InputController {
    /**
     * @param {object} params
     * @param {(action: string) => void} params.onAction
     * @param {() => boolean} params.getInvertY
     */
    constructor({ onAction, getInvertY }) {
        this.onAction = onAction;
        this.getInvertY = getInvertY;
        this.held = new Set();
        /** Virtual stick from the mouse, -1..1 on each axis (y + = pointer above centre). */
        this.pointerStick = { x: 0, y: 0 };
        /** Virtual stick from the on-screen touch joystick. */
        this.touchStick = { x: 0, y: 0 };
        this.pointerButtons = { primary: false, secondary: false };
        /** Absolute throttle (0..1) from the touch slider, or null when the keyboard is in charge. */
        this.throttleTarget = null;
        /** Controls from the VR controllers (xr/XRGamepadInput.js), or null outside VR. */
        this.xrControls = null;
        this.controls = { yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false };
        this.surface = null;
        this.listeners = [];
    }

    /** @param {HTMLElement} surface element that receives fire clicks (covers the 3D view) */
    attach(surface) {
        this.surface = surface;
        const listen = (target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            this.listeners.push(() => target.removeEventListener(type, handler, options));
        };
        listen(window, 'keydown', this.handleKeyDown);
        listen(window, 'keyup', this.handleKeyUp);
        listen(window, 'blur', this.releaseAll);
        listen(window, 'pointermove', this.handlePointerMove);
        listen(surface, 'pointerdown', this.handlePointerDown);
        listen(window, 'pointerup', this.handlePointerUp);
        listen(surface, 'contextmenu', (event) => event.preventDefault());
    }

    detach() {
        for (const remove of this.listeners) remove();
        this.listeners = [];
        this.releaseAll();
    }

    releaseAll = () => {
        this.held.clear();
        this.pointerButtons.primary = false;
        this.pointerButtons.secondary = false;
        this.pointerStick.x = 0;
        this.pointerStick.y = 0;
        this.touchStick.x = 0;
        this.touchStick.y = 0;
    };

    handleKeyDown = (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        const held = HELD_KEYS[event.code];
        const action = ACTION_KEYS[event.code];
        if (!held && !action) return;
        event.preventDefault();
        if (held) this.held.add(held);
        if (action && !event.repeat) this.onAction(action);
    };

    handleKeyUp = (event) => {
        const held = HELD_KEYS[event.code];
        if (held) this.held.delete(held);
    };

    handlePointerMove = (event) => {
        if (event.pointerType === 'touch') return;
        const radius = Math.min(window.innerWidth, window.innerHeight) * STICK_RADIUS;
        let x = (event.clientX - window.innerWidth / 2) / radius;
        let y = (window.innerHeight / 2 - event.clientY) / radius;
        const length = Math.hypot(x, y);
        if (length < STICK_DEAD_ZONE) {
            x = 0;
            y = 0;
        } else {
            // Rescale so deflection starts at zero just outside the dead zone and tops out at 1.
            const scaled = Math.min(1, (length - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE)) / length;
            x *= scaled;
            y *= scaled;
        }
        this.pointerStick.x = x;
        this.pointerStick.y = y;
    };

    handlePointerDown = (event) => {
        if (event.pointerType === 'touch') return;
        if (event.button === 0) this.pointerButtons.primary = true;
        if (event.button === 2) this.pointerButtons.secondary = true;
    };

    handlePointerUp = (event) => {
        if (event.pointerType === 'touch') return;
        if (event.button === 0) this.pointerButtons.primary = false;
        if (event.button === 2) this.pointerButtons.secondary = false;
    };

    // ---- Touch UI hooks (ui/TouchControls.jsx) ------------------------------------------

    setTouchStick(x, y) {
        this.touchStick.x = x;
        this.touchStick.y = y;
    }

    setThrottleTarget(value) {
        this.throttleTarget = value;
    }

    /** VR controllers: their stick / trigger state this frame (already dead-zoned and inverted), or null. */
    setXRControls(xrControls) {
        this.xrControls = xrControls;
    }

    setHeld(name, isHeld) {
        if (isHeld) this.held.add(name);
        else this.held.delete(name);
    }

    // ---- Per-frame read -------------------------------------------------------------------

    /** @returns the current held-control state (the same object is reused every frame). */
    getControls() {
        const { held, controls } = this;
        const axis = (negative, positive) => (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);
        const clampUnit = (value) => Math.max(-1, Math.min(1, value));
        const invert = this.getInvertY() ? -1 : 1;

        // In VR the mouse is not where the player is looking: its stick is ignored there.
        const xr = this.xrControls;
        const pointer = xr ? 0 : 1;
        controls.yaw = clampUnit(this.pointerStick.x * pointer + this.touchStick.x + axis('yawLeft', 'yawRight') + (xr?.yaw ?? 0));
        controls.pitch = clampUnit((this.pointerStick.y * pointer + this.touchStick.y) * invert + axis('pitchDown', 'pitchUp') + (xr?.pitch ?? 0));
        controls.roll = clampUnit(axis('rollLeft', 'rollRight') + (xr?.roll ?? 0));
        controls.throttle = clampUnit(axis('throttleDown', 'throttleUp') + (xr?.throttle ?? 0));
        // Touching W / S (or the VR throttle stick) hands the throttle back to the keyboard.
        if (controls.throttle !== 0) this.throttleTarget = null;
        controls.throttleTarget = this.throttleTarget;
        controls.boost = held.has('boost') || Boolean(xr?.boost);
        controls.firePrimary = this.pointerButtons.primary || held.has('firePrimary') || Boolean(xr?.firePrimary);
        controls.fireSecondary = this.pointerButtons.secondary || held.has('fireSecondary') || Boolean(xr?.fireSecondary);
        return controls;
    }
}
