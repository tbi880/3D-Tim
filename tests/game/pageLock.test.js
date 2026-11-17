import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOUBLE_TAP_MS, LOCK_CLASS, LOCKED_VIEWPORT, TAP_SLOP, canScrollBy, isTap, lockPage } from '../../src/game/input/pageLock.js';

/**
 * The page lock of the phone game (no double-tap zoom, no pinch, no page scrolling): the two
 * decisions it makes about a finger, and the lock itself against a stand-in document.
 */

/** A list 300 px tall showing 100 px of it, scrolled to `scrollTop`. */
const list = (scrollTop, extra = {}) => ({
    scrollsX: false, scrollsY: true, scrollTop, scrollLeft: 0, scrollHeight: 300, scrollWidth: 200, clientHeight: 100, clientWidth: 200, ...extra,
});

test('a list scrolls only while it has somewhere left to go', () => {
    // Finger down = content down = towards the top of the list.
    assert.equal(canScrollBy(list(0), 0, 20), false, 'at the top a pull down would drag the page');
    assert.equal(canScrollBy(list(0), 0, -20), true);
    assert.equal(canScrollBy(list(120), 0, 20), true);
    assert.equal(canScrollBy(list(120), 0, -20), true);
    assert.equal(canScrollBy(list(200), 0, -20), false, 'at the bottom a push up would drag the page');
    assert.equal(canScrollBy(list(200), 0, 20), true);
    assert.equal(canScrollBy(list(199.6), 0, -20), false, 'a fraction of a pixel short of the end is the end');
});

test('a box that does not scroll, or has nothing to scroll, never takes the drag', () => {
    assert.equal(canScrollBy(list(0, { scrollsY: false }), 0, -20), false);
    assert.equal(canScrollBy(list(0, { scrollHeight: 100 }), 0, -20), false);
    assert.equal(canScrollBy(list(50), 30, 4), false, 'a sideways drag on an up-and-down list');
});

test('a sideways list takes sideways drags only', () => {
    const row = { scrollsX: true, scrollsY: false, scrollTop: 0, scrollLeft: 0, scrollHeight: 80, scrollWidth: 600, clientHeight: 80, clientWidth: 200 };
    assert.equal(canScrollBy(row, -30, 4), true);
    assert.equal(canScrollBy(row, 30, 4), false, 'already at its left end');
    assert.equal(canScrollBy({ ...row, scrollLeft: 400 }, -30, 4), false, 'already at its right end');
    assert.equal(canScrollBy(row, 4, -30), false);
});

test('a tap is a finger that came up where it went down', () => {
    assert.equal(isTap({ x: 10, y: 10 }, { x: 14, y: 13 }), true);
    assert.equal(isTap({ x: 10, y: 10 }, { x: 10, y: 10 + TAP_SLOP + 1 }), false);
    assert.equal(isTap(undefined, { x: 10, y: 10 }), false, 'a finger nobody saw going down');
});

/* ---- The lock itself, against a stand-in for the document ---------------------------------- */

function fakeElement(selectors = [], parentElement = null) {
    const clicks = [];
    return {
        nodeType: 1,
        parentElement,
        clicks,
        closest(selector) {
            const wanted = selector.split(',').map((part) => part.trim());
            for (let node = this; node; node = node.parentElement) if (node.selectors.some((own) => wanted.includes(own))) return node;
            return null;
        },
        selectors,
        click() { clicks.push('click'); },
        // Nothing here scrolls.
        scrollTop: 0, scrollLeft: 0, scrollHeight: 50, scrollWidth: 50, clientHeight: 50, clientWidth: 50,
    };
}

function fakePage() {
    const listeners = new Map();
    const classes = new Set();
    const viewport = { content: 'width=device-width, initial-scale=1.0', getAttribute() { return this.content; }, setAttribute(_, value) { this.content = value; } };
    const body = fakeElement();
    globalThis.document = {
        documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
        body,
        activeElement: null,
        querySelector: () => viewport,
        addEventListener: (type, handler) => listeners.set(type, handler),
        removeEventListener: (type) => listeners.delete(type),
    };
    globalThis.window = { scrollTo() {} };
    globalThis.getComputedStyle = () => ({ overflowX: 'visible', overflowY: 'visible' });
    globalThis.MouseEvent = class {};
    const send = (type, target, { at = 0, x = 100, y = 100, fingers = 1, id = 1 } = {}) => {
        const touch = { identifier: id, clientX: x, clientY: y };
        const event = {
            type, target, timeStamp: at, cancelable: true, isTrusted: true, defaultPrevented: false,
            changedTouches: [touch],
            touches: type === 'touchend' ? Array(fingers - 1).fill(touch) : Array(fingers).fill(touch),
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
        };
        listeners.get(type)?.(event);
        return event;
    };
    const tap = (target, at, options = {}) => {
        const down = send('touchstart', target, { at, ...options });
        const up = send('touchend', target, { at: at + 40, ...options });
        return { down, up };
    };
    return { listeners, classes, viewport, body, send, tap };
}

test('locking swaps the viewport and marks the page; unlocking gives both back', () => {
    const page = fakePage();
    const unlock = lockPage();
    assert.equal(page.viewport.content, LOCKED_VIEWPORT);
    assert.match(page.viewport.content, /maximum-scale=1/);
    assert.match(page.viewport.content, /user-scalable=no/);
    assert.ok(page.classes.has(LOCK_CLASS));
    assert.ok(page.listeners.size > 0);
    unlock();
    assert.equal(page.viewport.content, 'width=device-width, initial-scale=1.0');
    assert.equal(page.classes.has(LOCK_CLASS), false);
    assert.equal(page.listeners.size, 0);
});

test('every touch on a flight control is cancelled, so no double tap can zoom there', () => {
    const page = fakePage();
    const unlock = lockPage();
    const controls = fakeElement(['.eod-touch'], page.body);
    const torpedo = fakeElement(['.eod-touch-button'], controls);
    const first = page.tap(torpedo, 1000);
    const second = page.tap(torpedo, 1150);
    assert.equal(first.down.defaultPrevented, true);
    assert.equal(second.down.defaultPrevented, true);
    assert.deepEqual(torpedo.clicks, [], 'the controls are pointer-driven: no click is made for them');
    const view = fakeElement(['.eod-input-surface'], page.body);
    assert.equal(page.tap(view, 3000).down.defaultPrevented, true);
    unlock();
});

test('a quick second tap on a menu button is cancelled and still clicks', () => {
    const page = fakePage();
    const unlock = lockPage();
    const button = fakeElement(['.eod-button'], fakeElement(['.eod-screen'], page.body));
    const first = page.tap(button, 1000);
    assert.equal(first.down.defaultPrevented, false);
    assert.equal(first.up.defaultPrevented, false, 'a single tap is the browser\'s to turn into a click');
    const second = page.tap(button, 1000 + DOUBLE_TAP_MS - 100);
    assert.equal(second.up.defaultPrevented, true, 'the second tap of a double tap must not reach the browser');
    assert.deepEqual(button.clicks, ['click']);
    // Should the browser send its own click for that tap anyway, it is not counted twice.
    const stray = page.send('click', button, { at: second.up.timeStamp + 20 });
    assert.equal(stray.stopped, true);
    // A tap long after is a single tap again.
    const later = page.tap(button, 5000);
    assert.equal(later.up.defaultPrevented, false);
    assert.deepEqual(button.clicks, ['click']);
    unlock();
});

test('the end of a drag right after a tap is cancelled without a click', () => {
    const page = fakePage();
    const unlock = lockPage();
    const button = fakeElement(['.eod-button'], page.body);
    page.tap(button, 1000);
    page.send('touchstart', button, { at: 1100, x: 100, y: 100 });
    const up = page.send('touchend', button, { at: 1200, x: 100, y: 180 });
    assert.equal(up.defaultPrevented, true);
    assert.deepEqual(button.clicks, []);
    unlock();
});

test('a drag that no list can take, and any pinch, is cancelled', () => {
    const page = fakePage();
    const unlock = lockPage();
    const panel = fakeElement(['.eod-panel'], page.body);
    page.send('touchstart', panel, { at: 1000, y: 100 });
    assert.equal(page.send('touchmove', panel, { at: 1016, y: 130 }).defaultPrevented, true, 'this would have dragged the page');
    assert.equal(page.send('touchmove', panel, { at: 1032, fingers: 2 }).defaultPrevented, true, 'two fingers: a pinch');
    assert.equal(page.send('gesturestart', panel).defaultPrevented, true);
    unlock();
});

test('a drag inside a list with room to scroll is left to the browser', () => {
    const page = fakePage();
    const unlock = lockPage();
    const screen = Object.assign(fakeElement(['.eod-screen'], page.body), { scrollHeight: 400, clientHeight: 100, scrollTop: 0 });
    const row = fakeElement(['.eod-setting'], screen);
    globalThis.getComputedStyle = (element) => (element === screen ? { overflowX: 'hidden', overflowY: 'auto' } : { overflowX: 'visible', overflowY: 'visible' });
    page.send('touchstart', row, { at: 1000, y: 100 });
    assert.equal(page.send('touchmove', row, { at: 1016, y: 70 }).defaultPrevented, false, 'finger up: the list scrolls down');
    page.send('touchstart', row, { at: 2000, y: 100 });
    assert.equal(page.send('touchmove', row, { at: 2016, y: 130 }).defaultPrevented, true, 'already at the top: nothing to scroll but the page');
    unlock();
});

test('text fields keep their taps and drags', () => {
    const page = fakePage();
    const unlock = lockPage();
    const field = fakeElement(['input'], fakeElement(['.eod-lan'], page.body));
    page.tap(field, 1000);
    const second = page.tap(field, 1100);
    assert.equal(second.up.defaultPrevented, false);
    assert.deepEqual(field.clicks, []);
    page.send('touchstart', field, { at: 2000 });
    assert.equal(page.send('touchmove', field, { at: 2016, y: 140 }).defaultPrevented, false);
    unlock();
});
