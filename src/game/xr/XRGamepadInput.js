/**
 * Reads the VR controllers (WebXR "xr-standard" gamepads, e.g. Meta Quest Touch) once per
 * frame and turns them into the game's controls, in the same shape the keyboard and mouse
 * produce (see input/InputController.js `setXRControls`).
 *
 * In flight:
 *   right stick        pitch / yaw (like the mouse stick; "invert pitch" applies)
 *   left stick         up / down = throttle, left / right = roll
 *   right trigger      beam arrays (hold)        left trigger    torpedo
 *   left grip          afterburner (hold)        right grip      lock the target you look at;
 *                                                                held: dock at a station / let go (multiplayer)
 *   A                  next target               B               skip comms line
 *   X                  power mode                Y               cockpit / chase view
 *   left stick click   re-centre the seat        right stick click  pause
 *
 * With a VR menu open, either stick moves the selection (up / down) and changes a value
 * (left / right); trigger or A picks, B goes back.
 */

/** xr-standard button indices (https://www.w3.org/TR/webxr-gamepads-module-1/). */
const BUTTON = Object.freeze({ trigger: 0, squeeze: 1, stick: 3, lower: 4, upper: 5 });
const STICK_DEAD_ZONE = 0.15;
const PRESS = 0.55;
/** Menu stick: past this a flick counts, and the stick must come back under REARM first. */
const MENU_FLICK = 0.65;
const MENU_REARM = 0.35;
const MENU_REPEAT_SECONDS = 0.38;
/** Seconds the right grip must stay squeezed to count as held (docking), not as a press. */
export const GRIP_HOLD_SECONDS = 0.8;

function deadZone(value) {
    const magnitude = Math.abs(value);
    if (magnitude < STICK_DEAD_ZONE) return 0;
    return Math.sign(value) * Math.min(1, (magnitude - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
}

function pressed(gamepad, index) {
    const button = gamepad?.buttons[index];
    return Boolean(button && (button.pressed || button.value > PRESS));
}

/** Thumbstick axes: xr-standard puts them at 2 / 3 (0 / 1 belong to a touchpad, if any). */
function stick(gamepad) {
    if (!gamepad) return { x: 0, y: 0 };
    const { axes } = gamepad;
    if (axes.length >= 4) return { x: axes[2], y: axes[3] };
    return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
}

export class XRGamepadInput {
    /**
     * @param {object} params
     * @param {import('../input/InputController.js').InputController} params.input
     * @param {(event: string) => void} params.onFlightAction 'cycleTarget' | 'skip' | 'power:cycle' | 'toggleView' | 'gazeTarget' | 'gripHeld' | 'recenter' | 'pause'
     * @param {(event: string) => void} params.onMenuAction 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'pause'
     * @param {() => boolean} params.isMenuOpen
     * @param {() => boolean} params.getInvertY
     */
    constructor({ input, onFlightAction, onMenuAction, isMenuOpen, getInvertY }) {
        this.input = input;
        this.onFlightAction = onFlightAction;
        this.onMenuAction = onMenuAction;
        this.isMenuOpen = isMenuOpen;
        this.getInvertY = getInvertY;
        /** Button states from the previous frame, keyed by `${hand}:${index}`. */
        this.previous = new Map();
        this.menuStick = { armed: true, direction: null, repeat: 0 };
        /** Seconds the right grip has been squeezed in flight, and whether that squeeze has already counted as held. */
        this.gripHold = { seconds: 0, fired: false };
        this.controls = { yaw: 0, pitch: 0, roll: 0, throttle: 0, boost: false, firePrimary: false, fireSecondary: false };
        this.gamepads = { left: null, right: null };
    }

    /** True on the frame the button went down. */
    edge(hand, index) {
        const key = `${hand}:${index}`;
        const now = pressed(this.gamepads[hand], index);
        const before = this.previous.get(key) ?? false;
        this.previous.set(key, now);
        return now && !before;
    }

    /** @param {XRSession | null} session  @param {number} dt */
    update(session, dt) {
        this.gamepads.left = null;
        this.gamepads.right = null;
        if (session) {
            for (const source of session.inputSources) {
                if (source.gamepad && (source.handedness === 'left' || source.handedness === 'right')) {
                    this.gamepads[source.handedness] = source.gamepad;
                }
            }
        }
        const { left, right } = this.gamepads;
        if (!left && !right) {
            this.release();
            return;
        }

        const menuOpen = this.isMenuOpen();
        // Edges are tracked every frame either way, so a press that opens a menu is not also
        // read as a press inside it.
        const edges = {
            leftTrigger: this.edge('left', BUTTON.trigger),
            rightTrigger: this.edge('right', BUTTON.trigger),
            rightSqueeze: this.edge('right', BUTTON.squeeze),
            leftStick: this.edge('left', BUTTON.stick),
            rightStick: this.edge('right', BUTTON.stick),
            a: this.edge('right', BUTTON.lower),
            b: this.edge('right', BUTTON.upper),
            x: this.edge('left', BUTTON.lower),
            y: this.edge('left', BUTTON.upper),
        };

        if (edges.rightStick) {
            (menuOpen ? this.onMenuAction : this.onFlightAction)('pause');
            this.release();
            return;
        }
        if (edges.leftStick) this.onFlightAction('recenter');

        if (menuOpen) {
            this.release();
            this.gripHold.seconds = 0;
            this.updateMenu(stick(left), stick(right), dt);
            if (edges.rightTrigger || edges.leftTrigger || edges.a || edges.x) this.onMenuAction('select');
            else if (edges.b || edges.y) this.onMenuAction('back');
            return;
        }
        this.menuStick.armed = false;

        const steer = stick(right);
        const thrust = stick(left);
        const invert = this.getInvertY() ? -1 : 1;
        const controls = this.controls;
        controls.yaw = deadZone(steer.x);
        // Stick forward reports a negative y; forward = nose up, like moving the mouse up.
        controls.pitch = -deadZone(steer.y) * invert;
        controls.roll = deadZone(thrust.x);
        controls.throttle = -deadZone(thrust.y);
        controls.boost = pressed(left, BUTTON.squeeze);
        controls.firePrimary = pressed(right, BUTTON.trigger);
        controls.fireSecondary = pressed(left, BUTTON.trigger);
        this.input.setXRControls(controls);

        if (edges.rightSqueeze) this.onFlightAction('gazeTarget');
        this.updateGripHold(pressed(right, BUTTON.squeeze), dt);
        if (edges.a) this.onFlightAction('cycleTarget');
        if (edges.b) this.onFlightAction('skip');
        if (edges.x) this.onFlightAction('power:cycle');
        if (edges.y) this.onFlightAction('toggleView');
    }

    /** A right grip kept squeezed for GRIP_HOLD_SECONDS is 'gripHeld', once per squeeze. */
    updateGripHold(squeezed, dt) {
        const hold = this.gripHold;
        if (!squeezed) {
            hold.seconds = 0;
            hold.fired = false;
            return;
        }
        hold.seconds += dt;
        if (hold.fired || hold.seconds < GRIP_HOLD_SECONDS) return;
        hold.fired = true;
        this.onFlightAction('gripHeld');
    }

    /** One menu step per flick of either stick; holding it repeats slowly. */
    updateMenu(leftStick, rightStick, dt) {
        const pick = Math.max(Math.abs(leftStick.x), Math.abs(leftStick.y)) > Math.max(Math.abs(rightStick.x), Math.abs(rightStick.y))
            ? leftStick : rightStick;
        const state = this.menuStick;
        const magnitude = Math.max(Math.abs(pick.x), Math.abs(pick.y));
        if (magnitude < MENU_REARM) {
            state.armed = true;
            state.direction = null;
            return;
        }
        if (magnitude < MENU_FLICK) return;
        const direction = Math.abs(pick.y) >= Math.abs(pick.x) ? (pick.y < 0 ? 'up' : 'down') : (pick.x < 0 ? 'left' : 'right');
        if (state.armed || direction !== state.direction) {
            state.armed = false;
            state.direction = direction;
            state.repeat = MENU_REPEAT_SECONDS;
            this.onMenuAction(direction);
            return;
        }
        state.repeat -= dt;
        if (state.repeat <= 0) {
            state.repeat = MENU_REPEAT_SECONDS * 0.5;
            this.onMenuAction(direction);
        }
    }

    release() {
        const controls = this.controls;
        controls.yaw = 0;
        controls.pitch = 0;
        controls.roll = 0;
        controls.throttle = 0;
        controls.boost = false;
        controls.firePrimary = false;
        controls.fireSecondary = false;
        this.input.setXRControls(null);
    }

    /** A short rumble on both controllers (hits, collisions). */
    pulse(intensity, milliseconds) {
        for (const gamepad of [this.gamepads.left, this.gamepads.right]) {
            const actuator = gamepad?.hapticActuators?.[0];
            if (actuator?.pulse) actuator.pulse(Math.min(1, intensity), milliseconds).catch?.(() => {});
        }
    }
}
