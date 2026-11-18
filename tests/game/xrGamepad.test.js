import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CONFIRM_HOLD_SECONDS, LOCK_HOLD_SECONDS, LOCK_REPEAT_SECONDS, PAUSE_HOLD_SECONDS, XRGamepadInput,
} from '../../src/game/xr/XRGamepadInput.js';
import { ORBIT, createOrbit } from '../../src/game/xr/vrOrbit.js';

/** The VR controllers, fed by hand: `press('right', A)` keeps A down until `release`. */
function controllers({ menuOpen = false, chase = false } = {}) {
    const pad = () => ({ buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
    const pads = { left: pad(), right: pad() };
    const session = { inputSources: [{ handedness: 'left', gamepad: pads.left }, { handedness: 'right', gamepad: pads.right }] };
    const flight = [];
    const menu = [];
    const state = { menuOpen, chase };
    const orbit = createOrbit();
    let held = null;
    const input = new XRGamepadInput({
        input: { setXRControls(controls) { held = controls && { ...controls }; } },
        onFlightAction: (action) => flight.push(action),
        onMenuAction: (action) => menu.push(action),
        isMenuOpen: () => state.menuOpen,
        getInvertY: () => false,
        canOrbit: () => state.chase,
        orbit,
    });
    const run = (seconds) => { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 72) input.update(session, 1 / 72); };
    const set = (hand, index, down) => { pads[hand].buttons[index] = { pressed: down, value: down ? 1 : 0 }; };
    return {
        flight, menu, state, run, pads, orbit,
        held: () => held,
        press: (hand, index) => set(hand, index, true),
        release: (hand, index) => set(hand, index, false),
        /** Down and up again, quickly. */
        tap(hand, index) {
            set(hand, index, true);
            run(0.1);
            set(hand, index, false);
            run(0.05);
        },
    };
}

const TRIGGER = 0;
const GRIP = 1;
const STICK = 3;
const A = 4;
const B = 5;
const X = 4;
const Y = 5;

test('clicking the right stick locks the hostile nearest the crosshair; kept down, it steps on through the others', () => {
    const pads = controllers();
    pads.tap('right', STICK);
    assert.deepEqual(pads.flight, ['targetCrosshair'], 'a click is R on a keyboard');

    pads.flight.length = 0;
    pads.press('right', STICK);
    pads.run(LOCK_HOLD_SECONDS - 0.1);
    assert.deepEqual(pads.flight, ['targetCrosshair'], 'not held yet');
    pads.run(0.15);
    assert.deepEqual(pads.flight, ['targetCrosshair', 'cycleTarget'], 'held: on to the next one, as T');
    pads.run(LOCK_REPEAT_SECONDS * 2 + 0.05);
    assert.deepEqual(pads.flight, ['targetCrosshair', 'cycleTarget', 'cycleTarget', 'cycleTarget'], 'and one more every so often');
    pads.release('right', STICK);
    pads.run(LOCK_REPEAT_SECONDS * 2);
    assert.equal(pads.flight.length, 4, 'let go, it stops');
});

test('A confirms on the press; let go soon it was a tap, kept down it is held - once', () => {
    const pads = controllers();
    pads.tap('right', A);
    assert.deepEqual(pads.flight, ['confirm', 'confirmTap']);

    pads.flight.length = 0;
    pads.press('right', A);
    pads.run(CONFIRM_HOLD_SECONDS - 0.2);
    assert.deepEqual(pads.flight, ['confirm']);
    pads.run(0.3);
    assert.deepEqual(pads.flight, ['confirm', 'confirmHeld']);
    pads.run(3);
    assert.deepEqual(pads.flight, ['confirm', 'confirmHeld'], 'holding on does not dock and undock in turns');
    pads.release('right', A);
    pads.run(0.1);
    assert.deepEqual(pads.flight, ['confirm', 'confirmHeld'], 'and letting go after a hold is no tap');
});

test('B switches the view when let go; kept down, it pauses instead', () => {
    const pads = controllers();
    pads.tap('right', B);
    assert.deepEqual(pads.flight, ['view']);

    pads.flight.length = 0;
    pads.press('right', B);
    pads.run(PAUSE_HOLD_SECONDS + 0.05);
    assert.deepEqual(pads.flight, ['pause'], 'no view switch on the way to the pause');
    // The pause has opened the menu: letting go there does nothing, and B in the menu is "back".
    pads.state.menuOpen = true;
    pads.release('right', B);
    pads.run(0.1);
    assert.deepEqual(pads.flight, ['pause']);
    assert.deepEqual(pads.menu, []);
    pads.tap('right', B);
    assert.deepEqual(pads.menu, ['back']);
});

test('a press that closes a menu is not read again in flight when it comes back up', () => {
    const pads = controllers({ menuOpen: true });
    pads.press('right', B);
    pads.run(0.05);
    assert.deepEqual(pads.menu, ['back']);
    pads.state.menuOpen = false;
    pads.run(PAUSE_HOLD_SECONDS * 2);
    pads.release('right', B);
    pads.run(0.1);
    assert.deepEqual(pads.flight, [], 'neither a pause nor a view switch');

    pads.state.menuOpen = true;
    pads.press('right', A);
    pads.run(0.05);
    pads.state.menuOpen = false;
    pads.run(CONFIRM_HOLD_SECONDS * 2);
    pads.release('right', A);
    pads.run(0.1);
    assert.deepEqual(pads.flight, [], 'A that picked a row neither docks nor opens the map');
});

test('a hold cut short by a menu opening counts for nothing', () => {
    const pads = controllers();
    pads.press('right', A);
    pads.run(CONFIRM_HOLD_SECONDS / 2);
    pads.state.menuOpen = true;
    pads.run(CONFIRM_HOLD_SECONDS);
    pads.state.menuOpen = false;
    pads.run(CONFIRM_HOLD_SECONDS);
    pads.release('right', A);
    pads.run(0.1);
    assert.deepEqual(pads.flight, ['confirm']);
});

test('the triggers fire, the left grip is the afterburner, and in the cockpit the right grip does nothing', () => {
    const pads = controllers();
    pads.press('right', TRIGGER);
    pads.press('left', TRIGGER);
    pads.press('left', GRIP);
    pads.press('right', GRIP);
    pads.run(1);
    assert.deepEqual(pads.flight, []);
    const held = pads.held();
    assert.equal(held.firePrimary, true, 'right trigger: beams');
    assert.equal(held.fireSecondary, true, 'left trigger: torpedo');
    assert.equal(held.boost, true);

    pads.pads.right.axes = [0, 0, 1, 0];
    pads.run(0.5);
    assert.equal(pads.held().yaw, 1, 'the stick still steers');
    assert.deepEqual(pads.orbit, createOrbit(), 'and the camera stays put');
});

test('chase view: the right grip held turns the right stick into the camera, which stays where it is left', () => {
    const pads = controllers({ chase: true });
    pads.press('right', GRIP);
    pads.pads.right.axes = [0, 0, 1, -1];
    pads.run(0.5);
    assert.equal(pads.held().yaw, 0, 'the ship is not steered');
    assert.equal(pads.held().pitch, 0);
    assert.ok(pads.orbit.yaw < -0.5, 'stick right: the view turns right');
    assert.ok(pads.orbit.pitch > 0.5, 'stick forward: the view tilts up');

    pads.release('right', GRIP);
    pads.run(1);
    const left = { ...pads.orbit };
    assert.equal(pads.held().yaw, 1, 'let go, the stick steers again');
    assert.equal(pads.held().pitch, 1);
    pads.pads.right.axes = [0, 0, 0, 0];
    pads.run(2);
    assert.deepEqual(pads.orbit, left, 'and the camera stays where it was left');

    pads.pads.right.axes = [0, 0, 0, 1];
    pads.press('right', GRIP);
    pads.run(5);
    assert.equal(pads.orbit.pitch, -ORBIT.maxPitch, 'over or under the ship, never past it');
    assert.deepEqual(pads.flight, [], 'the grip is no flight action');
});

test('chase view: a quick squeeze of the right grip on its own swings the camera back behind the ship', () => {
    const pads = controllers({ chase: true });
    pads.press('right', GRIP);
    pads.pads.right.axes = [0, 0, -1, 0];
    pads.run(1);
    pads.release('right', GRIP);
    pads.pads.right.axes = [0, 0, 0, 0];
    pads.run(0.1);
    assert.ok(pads.orbit.yaw > 1, 'turned round');
    assert.equal(pads.orbit.returning, false, 'a long hold that moved the camera is no squeeze');

    pads.tap('right', GRIP);
    assert.equal(pads.orbit.returning, true);
    pads.run(2);
    assert.deepEqual(pads.orbit, createOrbit(), 'back behind the ship');

    // A squeeze held too long, or one that moved the camera, leaves it where it is.
    pads.press('right', GRIP);
    pads.pads.right.axes = [0, 0, 1, 0];
    pads.run(0.2);
    pads.release('right', GRIP);
    pads.pads.right.axes = [0, 0, 0, 0];
    pads.run(1);
    const turned = pads.orbit.yaw;
    assert.ok(turned < 0);
    pads.press('right', GRIP);
    pads.run(ORBIT.tapSeconds + 0.1);
    pads.release('right', GRIP);
    pads.run(1);
    assert.equal(pads.orbit.yaw, turned);
});

test('the sticks: right steers, left is throttle and roll; left click re-centres, in flight or in a menu', () => {
    const pads = controllers();
    pads.pads.right.axes = [0, 0, 1, -1];
    pads.pads.left.axes = [0, 0, -1, -1];
    pads.run(0.1);
    const held = pads.held();
    assert.equal(held.yaw, 1);
    assert.equal(held.pitch, 1, 'stick forward: nose up');
    assert.equal(held.roll, -1);
    assert.equal(held.throttle, 1, 'stick forward: more throttle');

    pads.tap('left', STICK);
    assert.deepEqual(pads.flight, ['recenter']);
    pads.state.menuOpen = true;
    pads.tap('left', STICK);
    assert.deepEqual(pads.flight, ['recenter', 'recenter']);
});

test('X steps the power mode and Y is the ship\'s ability: once per press, and not while a menu is open', () => {
    const pads = controllers();
    pads.press('left', Y);
    pads.run(1);
    assert.deepEqual(pads.flight, ['ability'], 'held down, it is still one press');
    pads.release('left', Y);
    pads.run(0.1);
    pads.press('left', Y);
    pads.run(0.1);
    assert.deepEqual(pads.flight, ['ability', 'ability'], 'the second press sets a warhead off');
    pads.release('left', Y);
    pads.tap('left', X);
    assert.deepEqual(pads.flight, ['ability', 'ability', 'power:cycle']);

    pads.state.menuOpen = true;
    pads.run(0.1);
    pads.tap('left', Y);
    pads.tap('left', X);
    assert.deepEqual(pads.flight, ['ability', 'ability', 'power:cycle'], 'in a menu Y means "back", X picks');
    assert.deepEqual(pads.menu, ['back', 'select']);
});

test('in a menu the triggers and A pick, B and Y go back, and the right stick click does nothing', () => {
    const pads = controllers({ menuOpen: true });
    pads.tap('right', TRIGGER);
    pads.tap('left', TRIGGER);
    pads.tap('right', A);
    pads.tap('right', B);
    pads.tap('right', STICK);
    assert.deepEqual(pads.menu, ['select', 'select', 'select', 'back']);
    assert.deepEqual(pads.flight, []);
});
