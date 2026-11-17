import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRIP_HOLD_SECONDS, XRGamepadInput } from '../../src/game/xr/XRGamepadInput.js';

/** The VR controllers, fed by hand: `press('right', 1)` squeezes the right grip until `release`. */
function controllers({ menuOpen = false } = {}) {
    const pad = () => ({ buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
    const pads = { left: pad(), right: pad() };
    const session = { inputSources: [{ handedness: 'left', gamepad: pads.left }, { handedness: 'right', gamepad: pads.right }] };
    const flight = [];
    const state = { menuOpen };
    const input = new XRGamepadInput({
        input: { setXRControls() {} },
        onFlightAction: (action) => flight.push(action),
        onMenuAction: () => {},
        isMenuOpen: () => state.menuOpen,
        getInvertY: () => false,
    });
    const run = (seconds) => { for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 1 / 72) input.update(session, 1 / 72); };
    const set = (hand, index, down) => { pads[hand].buttons[index] = { pressed: down, value: down ? 1 : 0 }; };
    return { flight, state, run, press: (hand, index) => set(hand, index, true), release: (hand, index) => set(hand, index, false) };
}

const GRIP = 1;

test('a squeeze of the right grip locks what the pilot looks at; kept squeezed, it docks - once', () => {
    const pads = controllers();
    pads.press('right', GRIP);
    pads.run(GRIP_HOLD_SECONDS - 0.2);
    assert.deepEqual(pads.flight, ['gazeTarget'], 'a press is only a press');

    pads.run(0.3);
    assert.deepEqual(pads.flight, ['gazeTarget', 'gripHeld']);
    pads.run(3);
    assert.deepEqual(pads.flight, ['gazeTarget', 'gripHeld'], 'holding on does not dock and undock in turns');

    pads.release('right', GRIP);
    pads.run(0.1);
    pads.press('right', GRIP);
    pads.run(GRIP_HOLD_SECONDS + 0.1);
    assert.deepEqual(pads.flight, ['gazeTarget', 'gripHeld', 'gazeTarget', 'gripHeld'], 'a second hold is a second ask (to let go)');
});

test('a short squeeze never docks, however many there are', () => {
    const pads = controllers();
    for (let squeeze = 0; squeeze < 5; squeeze++) {
        pads.press('right', GRIP);
        pads.run(GRIP_HOLD_SECONDS / 2);
        pads.release('right', GRIP);
        pads.run(0.05);
    }
    assert.equal(pads.flight.includes('gripHeld'), false);
});

test('the left grip is the afterburner and docks nothing; nor does a grip held while a menu is open', () => {
    const pads = controllers();
    pads.press('left', GRIP);
    pads.run(GRIP_HOLD_SECONDS * 2);
    assert.deepEqual(pads.flight, []);

    pads.state.menuOpen = true;
    pads.press('right', GRIP);
    pads.run(GRIP_HOLD_SECONDS * 2);
    assert.deepEqual(pads.flight, [], 'the menu has the controllers');
    pads.state.menuOpen = false;
    pads.run(GRIP_HOLD_SECONDS / 2);
    assert.equal(pads.flight.includes('gripHeld'), false, 'and the time under the menu does not count');
});

test('Y is the ship\'s ability: once per press, and not while a menu is open', () => {
    const Y = 5;
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
    pads.state.menuOpen = true;
    pads.run(0.1);
    pads.press('left', Y);
    pads.run(0.5);
    assert.deepEqual(pads.flight, ['ability', 'ability'], 'in a menu Y means "back"');
});
