import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DynamicResolution } from '../../src/game/xr/DynamicResolution.js';

/** The headset's resolution following its frame rate (xr/DynamicResolution.js). */

/** Feeds `seconds` of frames `fps` apart; returns the scale at the end. */
function run(resolution, fps, seconds, displayRate) {
    let scale = resolution.scale;
    for (let frame = 0; frame < seconds * fps; frame++) scale = resolution.update(1 / fps, displayRate);
    return scale;
}

test('frames on time leave the resolution alone', () => {
    const resolution = new DynamicResolution();
    assert.equal(run(resolution, 72, 30, 72), 1);
    assert.equal(resolution.fps > 71 && resolution.fps < 73, true);
});

// 64 Hz and 32 fps below: their frame times are exact in binary, so every half-second window
// holds a whole number of frames and the steps can be counted.

test('late frames lower the resolution step by step, down to the floor', () => {
    const resolution = new DynamicResolution({ min: 0.65 });
    // Half the display's rate: every frame is late.
    assert.equal(run(resolution, 32, 0.5, 64), 0.9);
    assert.equal(run(resolution, 32, 0.5, 64), 0.8);
    assert.equal(run(resolution, 32, 20, 64), 0.65);
});

test('it tries a step sharper after a calm spell, and waits longer after a try that fails', () => {
    const resolution = new DynamicResolution();
    assert.equal(run(resolution, 32, 1, 64), 0.8);
    // Four calm seconds: one step back up.
    assert.equal(run(resolution, 64, 4, 64), 0.85);
    // It did not hold: back down, and now four calm seconds are not enough for another try.
    assert.equal(run(resolution, 32, 0.5, 64), 0.75);
    assert.equal(run(resolution, 64, 4, 64), 0.75);
    assert.equal(run(resolution, 64, 4, 64), 0.8);
});

test('a pause is not a slow frame', () => {
    const resolution = new DynamicResolution();
    for (let frame = 0; frame < 200; frame++) resolution.update(frame % 20 === 0 ? 2 : 1 / 72, 72);
    assert.equal(resolution.scale, 1);
});

test('the display rate is recognised from the frames when the session does not tell it', () => {
    // A 60 Hz display (the desktop emulator) running on time is not "late for 72".
    const sixty = new DynamicResolution();
    assert.equal(run(sixty, 60, 10), 1);
    // A 90 Hz headset that has shown it can do 90, then drops to 45.
    const ninety = new DynamicResolution();
    run(ninety, 90, 3);
    assert.equal(run(ninety, 45, 2) < 1, true);
    // Never on the beat of any display: assumed to be a 72 Hz headset struggling.
    const struggling = new DynamicResolution();
    assert.equal(run(struggling, 25, 5) < 1, true);
});
