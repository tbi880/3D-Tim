import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import {
    MAP_HEIGHT, MARK_STYLES, RESPAWN_MARK, drawStarMap, focusFrame, mapColumns, respawnMarks,
} from '../../src/game/xr/vrStarMap.js';

/**
 * The star map on the VR menu panel (xr/vrStarMap.js), and on the menu of a pilot who is
 * down: the stations they may come back to are marked above their planets, and the planet of
 * the row the stick is on is framed as the row is. Drawn here on a pretend canvas that writes
 * down what it was asked to do, with the colours and font in force at the time.
 */

const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
/** The menu panel's content box (xr/VRMenu.js: 64 px margins on a 1024 px canvas). */
const X = 64;
const Y = 300;
const WIDTH = 896;

function recordingContext() {
    const calls = [];
    const state = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', textAlign: 'start', globalAlpha: 1, lineWidth: 1 };
    const stack = [];
    const gradient = () => ({ addColorStop() {} });
    const snapshot = () => ({ fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: state.font, textAlign: state.textAlign });
    const methods = {
        createRadialGradient: gradient,
        createLinearGradient: gradient,
        // Seven pixels a character, whatever the font.
        measureText: (text) => ({ width: [...String(text)].length * 7 }),
        save: () => stack.push({ ...state }),
        restore: () => Object.assign(state, stack.pop()),
    };
    const ctx = new Proxy(state, {
        get(target, name) {
            if (name in methods) return methods[name];
            if (name in target) return target[name];
            return (...args) => calls.push({ name, args, ...snapshot() });
        },
        set(target, name, value) {
            target[name] = value;
            return true;
        },
    });
    return { ctx, calls };
}

/** Words as keys, with the player's name for "You" (mp.lan.you). */
const keysT = (you = 'You') => (key) => (key === 'mp.lan.you' ? you : key);

function matchState({ here = 'haven', owners = {} } = {}) {
    return {
        you: { planet: here, faction: 'dawn' },
        planets: PLANETS.map((id) => ({
            id,
            status: PLANET_STATUS.SAFE,
            changesIn: null,
            known: Boolean(owners[id]),
            owner: owners[id] ?? null,
            forces: { dawn: 0, umbra: 0, pirate: 0 },
            docking: null,
            beacon: false,
            comrades: [],
        })),
    };
}

const texts = (calls) => calls.filter((call) => call.name === 'fillText');
const textOf = (calls, words) => texts(calls).filter((call) => call.args[0] === words);
/** The middle of a left-aligned line of the pretend width. */
const middleOf = (call) => (call.textAlign === 'left' ? call.args[1] + [...String(call.args[0])].length * 7 / 2 : call.args[1]);

function draw(match, options, t = keysT()) {
    const { ctx, calls } = recordingContext();
    const height = drawStarMap(ctx, X, Y, WIDTH, match, t, options);
    return { calls, height };
}

test('the stations of a pilot who is down are marked by what they may do there: the first is the default', () => {
    const marks = respawnMarks({ stations: ['rust', 'veil'], contested: ['haven'], falling: ['ember'] });
    assert.deepEqual(marks, {
        rust: RESPAWN_MARK.DEFAULT,
        veil: RESPAWN_MARK.OPEN,
        haven: RESPAWN_MARK.CONTESTED,
        ember: RESPAWN_MARK.FALLING,
    });
    assert.deepEqual(respawnMarks(null), {}, 'a pilot who flies has no marks');
    assert.deepEqual(respawnMarks({ stations: [], contested: [], falling: [] }), {});
    // Never two meanings for one station: one that can be chosen keeps that one.
    assert.equal(respawnMarks({ stations: ['veil'], contested: ['veil'], falling: ['veil'] }).veil, RESPAWN_MARK.DEFAULT);
    for (const mark of Object.values(RESPAWN_MARK)) assert.ok(MARK_STYLES[mark]?.key.startsWith('mp.respawn.map'), mark);
});

test('each mark sits above its own planet, in its colour, and no other planet carries one', () => {
    const marks = { rust: RESPAWN_MARK.DEFAULT, veil: RESPAWN_MARK.OPEN, colossus: RESPAWN_MARK.CONTESTED, ember: RESPAWN_MARK.FALLING };
    const { calls, height } = draw(matchState({ here: 'threshold' }), { marks });
    assert.equal(height, MAP_HEIGHT);
    const { cell, xs } = mapColumns(X, WIDTH, PLANETS.length);
    const centreY = Y + 62;
    for (const [planetId, mark] of Object.entries(marks)) {
        const style = MARK_STYLES[mark];
        const [label] = textOf(calls, style.key);
        assert.ok(label, `${planetId} is marked`);
        const cx = xs[PLANETS.indexOf(planetId)];
        assert.ok(Math.abs(middleOf(label) - cx) < cell / 2, `${planetId}'s mark is in its column`);
        assert.ok(label.args[2] < centreY - 31, 'above the planet and the ring of the side that holds it');
        // The default is a filled pill with dark words; the others are outlined, their words in the colour.
        assert.equal(label.fillStyle, style.solid ? '#04140c' : style.color);
    }
    // Only the default's pill is filled with its colour (the open one shares it, outlined).
    const filled = (color) => calls.filter((call) => call.name === 'fill' && call.fillStyle === color).length;
    assert.equal(filled(MARK_STYLES[RESPAWN_MARK.DEFAULT].color), 1);
    assert.equal(filled(MARK_STYLES[RESPAWN_MARK.CONTESTED].color) + filled(MARK_STYLES[RESPAWN_MARK.FALLING].color), 0);
    assert.equal(textOf(calls, 'mp.respawn.mapOpen').length, 1, 'one planet may be chosen besides the default');
    assert.equal(MARK_STYLES[RESPAWN_MARK.CONTESTED].color, '#ff4b6e');
    assert.equal(MARK_STYLES[RESPAWN_MARK.FALLING].color, '#ffb648');
    // The planet the player is at keeps its "▼ You" (no mark there).
    const [you] = textOf(calls, '▼ You');
    assert.ok(Math.abs(middleOf(you) - xs[PLANETS.indexOf('threshold')]) < 1);
});

test('"▼ You" and a mark share the line above a planet when both fit in its column, else the mark is drawn alone', () => {
    const { xs, cell } = mapColumns(X, WIDTH, PLANETS.length);
    const cx = xs[PLANETS.indexOf('haven')];
    const match = matchState({ here: 'haven' });

    // Short words (Chinese): side by side, both in the column, "You" first.
    const short = draw(match, { marks: { haven: RESPAWN_MARK.CONTESTED } }, (key) => ({ 'mp.lan.you': '你', 'mp.respawn.mapContested': '被占领中' }[key] ?? key)).calls;
    const [you] = textOf(short, '▼ 你');
    const [mark] = textOf(short, '被占领中');
    assert.ok(you && mark, 'both drawn');
    assert.ok(you.args[1] < mark.args[1], '"You" on the left');
    assert.ok(you.args[1] > cx - cell / 2 && mark.args[1] + 4 * 7 < cx + cell / 2, 'inside the column');

    // Long words: the mark alone, centred.
    const long = draw(match, { marks: { haven: RESPAWN_MARK.CONTESTED } }, (key) => ({ 'mp.respawn.mapContested': 'Being taken by the other side' }[key] ?? keysT()(key))).calls;
    assert.equal(textOf(long, '▼ You').length, 0);
    assert.ok(Math.abs(middleOf(textOf(long, 'Being taken by the other side')[0]) - cx) < 1);
});

test('the selected row\'s planet is framed in the row\'s colour, behind its words; nothing is framed for a row about no planet', () => {
    const { cell, xs } = mapColumns(X, WIDTH, PLANETS.length);
    for (const [index, planetId] of PLANETS.entries()) {
        const { calls } = draw(matchState(), { marks: { [planetId]: RESPAWN_MARK.OPEN }, focus: planetId });
        const strokes = calls.filter((call) => call.name === 'stroke' && call.strokeStyle === '#59d0ff');
        assert.equal(strokes.length, 1, `${planetId}: one frame`);
        const frame = focusFrame(xs[index], Y, cell);
        // The frame's outline starts at its top-left corner (canvasPanel.js roundRect).
        const start = calls.filter((call) => call.name === 'moveTo').find((call) => call.args[1] === frame.y);
        assert.ok(start, 'the frame was outlined');
        assert.ok(frame.x > xs[index] - cell / 2 && frame.x + frame.width < xs[index] + cell / 2, 'inside its own column only');
        assert.ok(frame.x >= X && frame.x + frame.width <= X + WIDTH, 'inside the panel');
        assert.ok(frame.y >= Y && frame.y + frame.height <= Y + MAP_HEIGHT - 22, 'clear of the "Sun → outer orbits" line');
        // Drawn before the planet's name, so the name is over it.
        const frameAt = calls.indexOf(strokes[0]);
        const nameAt = calls.findIndex((call) => call.name === 'fillText' && call.args[0] === `mp.planet.${planetId}`);
        assert.ok(frameAt < nameAt);
        assert.equal(calls[nameAt].fillStyle, '#ffffff', 'the framed planet\'s name is bright');
    }
    for (const focus of [null, 'nowhere']) {
        const { calls } = draw(matchState(), { focus });
        assert.equal(calls.filter((call) => call.name === 'stroke' && call.strokeStyle === '#59d0ff').length, 0, `no frame for ${focus}`);
    }
});

test('without marks or a selection it is the star map as before: "▼ You" over the player\'s planet, every planet named', () => {
    const { calls } = draw(matchState({ here: 'veil', owners: { veil: 'dawn' } }));
    const { xs } = mapColumns(X, WIDTH, PLANETS.length);
    const [you] = textOf(calls, '▼ You');
    assert.ok(Math.abs(middleOf(you) - xs[PLANETS.indexOf('veil')]) < 1);
    for (const planetId of PLANETS) assert.equal(textOf(calls, `mp.planet.${planetId}`).length, 1, planetId);
    for (const style of Object.values(MARK_STYLES)) assert.equal(textOf(calls, style.key).length, 0);
    // The side holding veil's station: a ring in its colour; unknown planets show a question mark.
    assert.ok(calls.some((call) => call.name === 'stroke' && call.strokeStyle === '#59d0ff'), 'the holder\'s ring');
    assert.equal(textOf(calls, '?').length, PLANETS.length - 1);
});
