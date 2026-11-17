import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputController } from '../../src/game/input/InputController.js';
import { THROTTLE_SWIPE, ThrottleSwipe, swipeSpan } from '../../src/game/input/throttleSwipe.js';

/**
 * The phone throttle: one finger slid up or down anywhere on the view. First the swipe itself
 * (fed bare positions), then the input controller with stand-in pointer events.
 */

const HEIGHT = 400; // a phone on its side: half of it, 200 px, is idle to full
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} (${actual} vs ${expected})`);

test('idle to full is half the screen height, within sensible limits', () => {
    assert.equal(swipeSpan(400), 200);
    assert.equal(swipeSpan(200), THROTTLE_SWIPE.minSpanPx, 'a very small screen still gets a usable travel');
    assert.equal(swipeSpan(1024), THROTTLE_SWIPE.maxSpanPx, 'a tablet does not ask for a swipe across the whole screen');
    assert.equal(swipeSpan(undefined), THROTTLE_SWIPE.minSpanPx);
});

test('a swipe is relative: it starts from the ship\'s throttle wherever the finger lands', () => {
    for (const startY of [60, 200, 340]) {
        const swipe = new ThrottleSwipe();
        swipe.begin(1, startY);
        assert.equal(swipe.move(1, startY - 5, () => 0.4, HEIGHT), null, 'inside the slop nothing is set');
        near(swipe.move(1, startY - THROTTLE_SWIPE.slop, () => 0.4, HEIGHT), 0.4, 'the swipe starts at the ship\'s throttle, with no jump');
        near(swipe.move(1, startY - THROTTLE_SWIPE.slop - 50, () => 0.4, HEIGHT), 0.65, 'up 50 px of 200 = +25%');
        near(swipe.move(1, startY - THROTTLE_SWIPE.slop + 40, () => 0.4, HEIGHT), 0.2, 'down 40 px = -20%');
    }
});

test('the starting throttle is asked for once, when the swipe begins', () => {
    const swipe = new ThrottleSwipe();
    let asked = 0;
    const base = () => { asked += 1; return 0.5; };
    swipe.begin(1, 200);
    swipe.move(1, 198, base, HEIGHT);
    assert.equal(asked, 0);
    swipe.move(1, 180, base, HEIGHT);
    swipe.move(1, 160, base, HEIGHT);
    assert.equal(asked, 1);
});

test('past full or idle the finger does not have to come all the way back', () => {
    const swipe = new ThrottleSwipe();
    swipe.begin(1, 300);
    swipe.move(1, 290, () => 0.8, HEIGHT);
    assert.equal(swipe.move(1, 100, () => 0.8, HEIGHT), 1, 'far past full is full');
    near(swipe.move(1, 120, () => 0.8, HEIGHT), 0.9, 'turning back 20 px takes 10% off at once');
    assert.equal(swipe.move(1, 395, () => 0.8, HEIGHT), 0, 'far past idle is idle');
    near(swipe.move(1, 375, () => 0.8, HEIGHT), 0.1);
});

test('a tap or a sideways drag sets nothing; a second finger is ignored', () => {
    const swipe = new ThrottleSwipe();
    assert.equal(swipe.begin(1, 200), true);
    assert.equal(swipe.move(1, 204, () => 0.3, HEIGHT), null, 'a finger that barely moves');
    assert.equal(swipe.swiping, false);
    assert.equal(swipe.begin(2, 100), false, 'the throttle already has its finger');
    assert.equal(swipe.move(2, 20, () => 0.3, HEIGHT), null);
    assert.equal(swipe.end(2), false);
    assert.equal(swipe.active, true);
    assert.equal(swipe.end(1), true);
    assert.equal(swipe.active, false);
    assert.equal(swipe.begin(2, 100), true, 'free again once the first finger has lifted');
});

// ---- Through the input controller ------------------------------------------------------------

const touch = (pointerId, clientY, clientX = 300) => ({ pointerType: 'touch', pointerId, clientX, clientY, button: 0 });

function controller(ship = { throttle: 0 }) {
    globalThis.window = { innerWidth: 800, innerHeight: HEIGHT };
    const input = new InputController({ onAction: () => {}, getInvertY: () => false, getThrottle: () => ship?.throttle ?? null });
    const told = [];
    input.onThrottleSwipe((value) => told.push(value));
    return { input, told };
}

test('a finger slid up the view sets the throttle, and lifting it leaves it there', () => {
    const { input, told } = controller({ throttle: 0.25 });
    assert.equal(input.getControls().throttleTarget, null, 'nothing set before the first swipe');
    input.handlePointerDown(touch(7, 250));
    assert.equal(input.getControls().throttleTarget, null, 'a finger coming down is not a swipe yet');
    input.handlePointerMove(touch(7, 240));
    input.handlePointerMove(touch(7, 140));
    near(input.getControls().throttleTarget, 0.75, 'a quarter throttle plus 100 px of 200');
    assert.equal(told.length, 2);
    near(told.at(-1), 0.75);
    input.handlePointerUp(touch(7, 140));
    near(input.getControls().throttleTarget, 0.75, 'the throttle stays where the finger left it');
    assert.equal(told.at(-1), null, 'the gauge is told the finger is gone');

    // The next swipe goes on from what was set, wherever it starts.
    input.handlePointerDown(touch(8, 80));
    input.handlePointerMove(touch(8, 90));
    input.handlePointerMove(touch(8, 130));
    near(input.getControls().throttleTarget, 0.55);
    input.handlePointerUp(touch(8, 130));
});

test('a swipe does not steer or fire, and a tap changes nothing', () => {
    const { input, told } = controller({ throttle: 0.5 });
    input.handlePointerDown(touch(1, 200));
    input.handlePointerMove(touch(1, 60, 700));
    const controls = input.getControls();
    assert.equal(controls.yaw, 0);
    assert.equal(controls.pitch, 0);
    assert.equal(controls.firePrimary, false);
    assert.equal(controls.fireSecondary, false);
    input.handlePointerUp(touch(1, 60));

    const before = input.getControls().throttleTarget;
    const calls = told.length;
    input.handlePointerDown(touch(2, 200));
    input.handlePointerMove(touch(2, 203));
    input.handlePointerUp(touch(2, 203));
    assert.equal(input.getControls().throttleTarget, before);
    assert.equal(told.length, calls, 'a tap tells the gauge nothing');
});

test('the stick and a held button go on working while another finger swipes', () => {
    const { input } = controller({ throttle: 0 });
    input.setTouchStick(0.5, -0.5); // left thumb on the stick (its own element, its own pointer)
    input.setHeld('firePrimary', true); // right thumb on FIRE
    input.handlePointerDown(touch(3, 300));
    input.handlePointerMove(touch(3, 290));
    input.handlePointerMove(touch(3, 190));
    // Moves of the other two fingers arrive at the window too; they are not the throttle finger.
    input.handlePointerMove(touch(1, 10));
    input.handlePointerMove(touch(2, 390));
    const controls = input.getControls();
    assert.equal(controls.yaw, 0.5);
    assert.equal(controls.pitch, -0.5);
    assert.equal(controls.firePrimary, true);
    near(controls.throttleTarget, 0.5);
    // One of them lifting does not end the swipe.
    input.handlePointerUp(touch(1, 10));
    input.handlePointerMove(touch(3, 80));
    assert.equal(input.getControls().throttleTarget, 1);
});

test('no ship to fly, no swipe (a menu, a cutscene)', () => {
    const { input, told } = controller(null);
    input.handlePointerDown(touch(1, 300));
    input.handlePointerMove(touch(1, 100));
    input.handlePointerUp(touch(1, 100));
    assert.equal(input.getControls().throttleTarget, null);
    assert.deepEqual(told, []);
});

test('a cancelled touch or a lost window ends the swipe and keeps the throttle', () => {
    const { input, told } = controller({ throttle: 0 });
    input.handlePointerDown(touch(1, 300));
    input.handlePointerMove(touch(1, 200));
    input.releaseAll(); // window blur
    assert.equal(told.at(-1), null);
    input.handlePointerMove(touch(1, 100)); // a late move of the finger that was dropped
    near(input.getControls().throttleTarget, 0.45);
    assert.equal(input.throttleSwipe.active, false);
});

test('the keyboard takes the throttle back, and the next swipe starts from the ship again', () => {
    const ship = { throttle: 0 };
    const { input } = controller(ship);
    input.handlePointerDown(touch(1, 300));
    input.handlePointerMove(touch(1, 290));
    input.handlePointerMove(touch(1, 190));
    input.handlePointerUp(touch(1, 190));
    near(input.getControls().throttleTarget, 0.5);
    input.setHeld('throttleUp', true); // W
    assert.equal(input.getControls().throttleTarget, null);
    input.setHeld('throttleUp', false);
    ship.throttle = 0.9; // where W took it
    input.handlePointerDown(touch(2, 100));
    input.handlePointerMove(touch(2, 110));
    input.handlePointerMove(touch(2, 130));
    near(input.getControls().throttleTarget, 0.8);
});

test('a mouse still steers and fires as before, and never swipes', () => {
    const { input } = controller({ throttle: 0.5 });
    const mouse = (extra) => ({ pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 200, button: 0, ...extra });
    input.handlePointerDown(mouse());
    input.handlePointerMove(mouse({ clientY: 60 }));
    const controls = input.getControls();
    assert.equal(controls.firePrimary, true);
    assert.ok(controls.pitch > 0.5);
    assert.equal(controls.throttleTarget, null);
    input.handlePointerUp(mouse());
    assert.equal(input.getControls().firePrimary, false);
});
