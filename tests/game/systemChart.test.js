import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import {
    PLANET_LOOKS, chartGeometry, drawCachedBackdrop, isGatePlanet, lookOf, paintPlanet, paintSystemBackdrop,
} from '../../src/game/ui/systemChart.js';

/**
 * The star system side on, behind the star map (ui/systemChart.js): the sun at the left, an
 * orbit round it through each planet, nearer planets to the left. The page and the headset
 * draw it with the same code; here it is drawn on a pretend canvas that writes down what it
 * was asked to do.
 */

/** A 2D context that records its calls: `calls` is [name, ...args] in order. */
function recordingContext() {
    const calls = [];
    const gradient = () => ({ stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } });
    const methods = {
        createRadialGradient: (...args) => { calls.push(['createRadialGradient', ...args]); return gradient(); },
        createLinearGradient: (...args) => { calls.push(['createLinearGradient', ...args]); return gradient(); },
        measureText: (text) => ({ width: String(text).length * 7 }),
    };
    const ctx = new Proxy({}, {
        get(target, name) {
            if (name in methods) return methods[name];
            if (name in target) return target[name];
            return (...args) => calls.push([name, ...args]);
        },
        set(target, name, value) {
            target[name] = value;
            return true;
        },
    });
    return { ctx, calls };
}

/** A frame like the page's: six planets 140 px apart after a sun column. */
function pageFrame() {
    const planetXs = STAR_SYSTEM.planets.map((planet, index) => 120 + index * 140);
    return { x: 0, y: 0, width: 960, height: 260, eclipticY: 32, sunEdge: 45, planetXs, captionY: 252 };
}

test('every planet of the system has a look, and the outermost one carries the stargate', () => {
    for (const planet of STAR_SYSTEM.planets) {
        assert.ok(PLANET_LOOKS[planet.id], `${planet.id} has no look`);
        const { size, light, mid, dark } = lookOf(planet.id);
        assert.ok(size > 0 && size <= 1, `${planet.id} size ${size}`);
        for (const colour of [light, mid, dark]) assert.match(colour, /^#[0-9a-f]{6}$/i);
    }
    assert.deepEqual(STAR_SYSTEM.planets.filter((planet) => isGatePlanet(planet.id)).map((planet) => planet.id), [STAR_SYSTEM.planets.at(-1).id]);
    assert.ok(lookOf('nowhere').size > 0, 'a planet with no look of its own still gets one');
});

test('the sun sits off the left on the planets\' line, its rim where asked, and every orbit runs through its planet', () => {
    const frame = pageFrame();
    const { sun, orbits } = chartGeometry(frame);
    assert.equal(sun.y, frame.eclipticY);
    assert.ok(sun.x < frame.x, 'the centre is off the picture: only the rim shows');
    assert.ok(Math.abs(sun.x + sun.radius - frame.sunEdge) < 1e-9, 'the rim crosses the line at sunEdge');
    assert.equal(orbits.length, frame.planetXs.length);
    orbits.forEach((radius, index) => {
        assert.ok(Math.abs(sun.x + radius - frame.planetXs[index]) < 1e-9, `orbit ${index} runs through its planet`);
        if (index > 0) assert.ok(radius > orbits[index - 1], 'further right is further from the sun');
    });
});

test('the backdrop draws the sun, one orbit per planet growing outwards, and "Sun → outer orbits", inside its frame', () => {
    const { ctx, calls } = recordingContext();
    const frame = pageFrame();
    paintSystemBackdrop(ctx, frame, { sun: 'Sun', outer: 'Outer orbits' }, { font: 'sans-serif' });

    const clip = calls.findIndex(([name]) => name === 'clip');
    const rect = calls.findIndex(([name]) => name === 'rect');
    assert.ok(rect >= 0 && clip > rect, 'clipped to the frame before anything is drawn');
    assert.deepEqual(calls[rect].slice(1), [frame.x, frame.y, frame.width, frame.height]);
    assert.equal(calls.at(-1)[0], 'restore', 'leaves the context as it found it');

    const { sun } = chartGeometry(frame);
    const arcs = calls.filter(([name, x, y]) => name === 'arc' && x === sun.x && y === sun.y).map(([, , , radius]) => radius);
    assert.ok(arcs.includes(sun.radius), 'the sun is drawn');
    const orbits = arcs.filter((radius) => radius > sun.radius + 5);
    assert.equal(orbits.length, frame.planetXs.length, 'an orbit for each planet');
    assert.deepEqual(orbits, [...orbits].sort((a, b) => a - b), 'innermost first');

    const texts = calls.filter(([name]) => name === 'fillText');
    const sunText = texts.find(([, text]) => text === 'Sun');
    const outerText = texts.find(([, text]) => text === 'Outer orbits');
    assert.ok(sunText && outerText, 'both ends of the line are named');
    assert.ok(sunText[2] < outerText[2], 'the sun on the left, the outer orbits on the right');
    assert.ok(sunText[2] >= frame.x, 'the sun\'s name is on the picture, not cut off at its left');
    assert.ok(outerText[2] <= frame.x + frame.width);
    assert.equal(sunText[3], frame.captionY);
});

test('a planet is a lit ball; a swallowed one a dark husk; the stargate\'s wears a ring', () => {
    const look = lookOf('colossus');
    const lit = recordingContext();
    paintPlanet(lit.ctx, { x: 100, y: 40, radius: 15, look });
    assert.ok(lit.calls.some(([name]) => name === 'createRadialGradient'), 'shaded');
    assert.ok(lit.calls.filter(([name]) => name === 'lineTo').length >= 3, 'the gas giant has its bands');
    assert.ok(!lit.calls.some(([name]) => name === 'ellipse'), 'no gate ring on an ordinary planet');

    const gone = recordingContext();
    paintPlanet(gone.ctx, { x: 100, y: 40, radius: 15, look, swallowed: true });
    assert.ok(!gone.calls.some(([name]) => name === 'createRadialGradient'), 'no light on a swallowed planet');
    assert.ok(gone.calls.some(([name]) => name === 'stroke'), 'its rim');

    const gate = recordingContext();
    paintPlanet(gate.ctx, { x: 100, y: 40, radius: 10, look: lookOf('threshold'), gate: true });
    const ring = gate.calls.find(([name]) => name === 'ellipse');
    assert.ok(ring && ring[3] > 10, 'a ring wider than the planet');
});

test('without a page to keep a picture on (here), the cached backdrop is simply painted', () => {
    const { ctx, calls } = recordingContext();
    drawCachedBackdrop(ctx, pageFrame(), { sun: 'Sun', outer: 'Outer' }, { font: 'sans-serif', scale: 1.5 });
    assert.ok(calls.some(([name, text]) => name === 'fillText' && text === 'Sun'));
    assert.ok(!calls.some(([name]) => name === 'drawImage'));
});
