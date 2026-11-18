import { ORBIT, createOrbit, recentreOrbit, stepOrbit } from './vrOrbit.js';

/**
 * Reads the VR controllers (WebXR "xr-standard" gamepads: Pico, Meta Quest Touch) once per
 * frame and turns them into the game's controls, in the same shape the keyboard and mouse
 * produce (see input/InputController.js `setXRControls`). Laid out the way a console
 * gamepad player expects: A confirms, the right stick's click locks on.
 *
 * In flight:
 *   right stick        pitch / yaw (like the mouse stick; "invert pitch" applies)
 *   right stick click  lock the hostile nearest the crosshair (R on a keyboard); kept down,
 *                      steps on through the others (T), as the LOCK button does on a phone
 *   left stick         up / down = throttle, left / right = roll
 *   left stick click   re-centre the seat
 *   right trigger      beam arrays (hold)        left trigger    torpedo
 *   left grip          afterburner (hold)
 *   right grip         chase view: held, the right stick swings the camera round the ship
 *                      instead of steering, and it stays where it is left; a quick squeeze
 *                      on its own swings it back behind the ship (xr/vrOrbit.js)
 *   A                  confirm: show the whole comms line, then skip it ("next" on a tutorial
 *                      card). A match has no comms lines: there a press opens the star map,
 *                      and held it docks at a station or lets go of it
 *   B                  cockpit / chase view; held: pause and open the menu
 *   X                  power mode                Y               the ship's ability (config/abilities.js)
 *
 * With a VR menu open, either stick moves the selection (up / down) and changes a value
 * (left / right); trigger, A or X picks, B or Y goes back.
 */

/** xr-standard button indices (https://www.w3.org/TR/webxr-gamepads-module-1/). */
const BUTTON = Object.freeze({ trigger: 0, squeeze: 1, stick: 3, lower: 4, upper: 5 });
const STICK_DEAD_ZONE = 0.15;
const PRESS = 0.55;
/** Menu stick: past this a flick counts, and the stick must come back under REARM first. */
const MENU_FLICK = 0.65;
const MENU_REARM = 0.35;
const MENU_REPEAT_SECONDS = 0.38;
/** Right stick kept clicked this long steps on to the next target, then once more every LOCK_REPEAT_SECONDS (as ui/TouchControls.jsx). */
export const LOCK_HOLD_SECONDS = 0.45;
export const LOCK_REPEAT_SECONDS = 0.65;
/** A kept down this long in a match docks (or lets go); let go sooner, it was a press (the star map). */
export const CONFIRM_HOLD_SECONDS = 0.8;
/** B kept down this long pauses; let go sooner, it switches the view. */
export const PAUSE_HOLD_SECONDS = 0.6;

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

/**
 * A button that means one thing pressed and another kept down. Only a press that went down
 * in flight counts: one that opened or closed a menu is not also read when it comes back up.
 * `step` returns what happened this frame: 'press' (it went down), 'tap' (it came up before
 * it was held), 'held' (kept down long enough; again every `repeatSeconds`, if given).
 */
class HoldButton {
    constructor(holdSeconds, repeatSeconds = null) {
        this.holdSeconds = holdSeconds;
        this.repeatSeconds = repeatSeconds;
        this.active = false;
        this.seconds = 0;
        this.held = false;
        this.repeatIn = 0;
    }

    step(wentDown, isDown, dt) {
        const events = [];
        if (wentDown) {
            this.active = true;
            this.seconds = 0;
            this.held = false;
            events.push('press');
        }
        if (!this.active) return events;
        if (!isDown) {
            this.active = false;
            if (!this.held) events.push('tap');
            return events;
        }
        this.seconds += dt;
        if (!this.held) {
            if (this.seconds >= this.holdSeconds) {
                this.held = true;
                this.repeatIn = this.repeatSeconds ?? 0;
                events.push('held');
            }
        } else if (this.repeatSeconds) {
            this.repeatIn -= dt;
            if (this.repeatIn <= 0) {
                this.repeatIn += this.repeatSeconds;
                events.push('held');
            }
        }
        return events;
    }

    cancel() {
        this.active = false;
    }
}

export class XRGamepadInput {
    /**
     * @param {object} params
     * @param {import('../input/InputController.js').InputController} params.input
     * @param {(event: string) => void} params.onFlightAction 'targetCrosshair' | 'cycleTarget' | 'confirm' | 'confirmTap' |
     *   'confirmHeld' | 'view' | 'pause' | 'power:cycle' | 'ability' | 'recenter'
     * @param {(event: string) => void} params.onMenuAction 'up' | 'down' | 'left' | 'right' | 'select' | 'back'
     * @param {() => boolean} params.isMenuOpen
     * @param {() => boolean} params.getInvertY
     * @param {() => boolean} [params.canOrbit] true when the camera may be swung round the ship (the chase view)
     * @param {{ yaw: number, pitch: number, returning: boolean }} [params.orbit] the orbit it moves (xr/vrOrbit.js)
     */
    constructor({ input, onFlightAction, onMenuAction, isMenuOpen, getInvertY, canOrbit = () => false, orbit = createOrbit() }) {
        this.input = input;
        this.onFlightAction = onFlightAction;
        this.onMenuAction = onMenuAction;
        this.isMenuOpen = isMenuOpen;
        this.getInvertY = getInvertY;
        this.canOrbit = canOrbit;
        this.orbit = orbit;
        /** Whether the stick has moved the camera during this squeeze of the right grip (then it is no squeeze to swing back). */
        this.orbitMoved = false;
        /** Button states from the previous frame, keyed by `${hand}:${index}`. */
        this.previous = new Map();
        this.menuStick = { armed: true, direction: null, repeat: 0 };
        /** The buttons that mean something else when kept down (right stick click, A, B). */
        this.holds = {
            lock: new HoldButton(LOCK_HOLD_SECONDS, LOCK_REPEAT_SECONDS),
            confirm: new HoldButton(CONFIRM_HOLD_SECONDS),
            view: new HoldButton(PAUSE_HOLD_SECONDS),
            orbit: new HoldButton(ORBIT.tapSeconds),
        };
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
            for (const hold of Object.values(this.holds)) hold.cancel();
            stepOrbit(this.orbit, null, dt);
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

        if (edges.leftStick) this.onFlightAction('recenter');

        if (menuOpen) {
            this.release();
            for (const hold of Object.values(this.holds)) hold.cancel();
            // A swing back behind the ship goes on under the menu.
            stepOrbit(this.orbit, null, dt);
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
        // Right grip held in the chase view: the right stick moves the camera, not the ship.
        const orbiting = pressed(right, BUTTON.squeeze) && this.canOrbit();
        // Stick forward reports a negative y; forward = nose up (or, swinging the camera, look up), like moving the mouse up.
        const look = { x: deadZone(steer.x), y: -deadZone(steer.y) * invert };
        controls.yaw = orbiting ? 0 : look.x;
        controls.pitch = orbiting ? 0 : look.y;
        controls.roll = deadZone(thrust.x);
        controls.throttle = -deadZone(thrust.y);
        controls.boost = pressed(left, BUTTON.squeeze);
        controls.firePrimary = pressed(right, BUTTON.trigger);
        controls.fireSecondary = pressed(left, BUTTON.trigger);
        this.input.setXRControls(controls);

        const { lock, confirm, view, orbit } = this.holds;
        for (const event of orbit.step(edges.rightSqueeze && this.canOrbit(), orbiting, dt)) {
            if (event === 'press') this.orbitMoved = false;
            else if (event === 'tap' && !this.orbitMoved) recentreOrbit(this.orbit);
        }
        if (orbiting && (look.x !== 0 || look.y !== 0)) this.orbitMoved = true;
        stepOrbit(this.orbit, orbiting ? look : null, dt);

        for (const event of lock.step(edges.rightStick, pressed(right, BUTTON.stick), dt)) {
            if (event === 'press') this.onFlightAction('targetCrosshair');
            else if (event === 'held') this.onFlightAction('cycleTarget');
        }
        for (const event of confirm.step(edges.a, pressed(right, BUTTON.lower), dt)) {
            if (event === 'press') this.onFlightAction('confirm');
            else if (event === 'tap') this.onFlightAction('confirmTap');
            else this.onFlightAction('confirmHeld');
        }
        if (edges.x) this.onFlightAction('power:cycle');
        if (edges.y) this.onFlightAction('ability');
        // Last: a pause opens the menu, which has the controllers from the next frame.
        for (const event of view.step(edges.b, pressed(right, BUTTON.upper), dt)) {
            if (event === 'tap') this.onFlightAction('view');
            else if (event === 'held') this.onFlightAction('pause');
        }
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
