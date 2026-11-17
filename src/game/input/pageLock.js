/**
 * Holds the page still while the game is open on a phone or tablet.
 *
 * A browser reads a touch as a gesture on the page before anything else: two quick taps zoom
 * in, two fingers pinch, a drag scrolls the document or stretches it past its edge (the rubber
 * band, pull-to-refresh). None of that belongs under a game played with two thumbs, and CSS
 * alone does not stop it everywhere: Safari on an iPhone ignores `user-scalable=no`, and a
 * double tap on a button can still zoom whatever its `touch-action` says. So while the game is
 * mounted:
 *
 *   - the viewport is told not to scale (Android browsers and a home-screen app obey);
 *   - <html> carries the class `eod-page-locked` (hud.css: nothing outside the game scrolls or
 *     bounces);
 *   - a touch on the flight controls or the 3D view is cancelled outright. They are read through
 *     pointer events, which a cancelled touch still delivers, so they lose nothing;
 *   - anywhere else, a tap right after another one is cancelled - that is the double tap - and
 *     handed on as the click it was meant to be; a pinch is cancelled; a drag is cancelled unless
 *     it starts in a list that can still scroll that way (the menus, the lobby, the star map).
 *
 * Text fields are left alone: a finger there places the caret and brings up the keyboard.
 */

export const LOCK_CLASS = 'eod-page-locked';
export const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no';
/** Two taps closer together than this (ms) are what a browser takes for a double tap. */
export const DOUBLE_TAP_MS = 350;
/** A finger that travelled further than this (px) was dragging, not tapping. */
export const TAP_SLOP = 12;

/** Played through pointer events only: nothing the browser would do with a touch there is wanted. */
const CONTROLS = '.eod-touch, .eod-input-surface';
const FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Whether a scrolling box has anywhere left to go when a finger drags by (dx, dy). The content
 * follows the finger, so a drag down needs content above the box and a drag up content below.
 *
 * @param {{ scrollsX: boolean, scrollsY: boolean, scrollTop: number, scrollLeft: number,
 *   scrollHeight: number, scrollWidth: number, clientHeight: number, clientWidth: number }} box
 */
export function canScrollBy(box, dx, dy) {
    if (Math.abs(dy) >= Math.abs(dx)) {
        if (!box.scrollsY) return false;
        return dy > 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1;
    }
    if (!box.scrollsX) return false;
    return dx > 0 ? box.scrollLeft > 0 : box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
}

/** True when the finger came up where it went down: a tap, not the end of a drag. */
export function isTap(start, end) {
    return Boolean(start) && Math.hypot(end.x - start.x, end.y - start.y) <= TAP_SLOP;
}

function measure(element) {
    const style = getComputedStyle(element);
    const scrolls = (overflow) => overflow === 'auto' || overflow === 'scroll';
    return {
        scrollsX: scrolls(style.overflowX),
        scrollsY: scrolls(style.overflowY),
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
    };
}

/** The list (if any) around `element` that a drag by (dx, dy) would scroll; the page itself never counts. */
function scrollerFor(element, dx, dy) {
    for (let node = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        if (canScrollBy(measure(node), dx, dy)) return node;
    }
    return null;
}

/** Old Safari reports the text node under the finger; everything here wants the element. */
const elementOf = (target) => (target && target.nodeType === 1 ? target : target?.parentElement ?? null);
const within = (element, selector) => Boolean(element?.closest?.(selector));
const cancel = (event) => { if (event.cancelable) event.preventDefault(); };

/**
 * Locks the page. Call the returned function to give it back to the site (viewport, scrolling
 * and gestures as they were).
 */
export function lockPage() {
    const html = document.documentElement;
    const viewport = document.querySelector('meta[name="viewport"]');
    const siteViewport = viewport?.getAttribute('content') ?? null;
    viewport?.setAttribute('content', LOCKED_VIEWPORT);
    html.classList.add(LOCK_CLASS);
    window.scrollTo(0, 0);

    /** Where each finger now on the glass went down, by touch identifier. */
    const starts = new Map();
    let lastTapAt = -Infinity;
    /** A click made here stands in for the browser's own; should that one arrive after all, it is dropped. */
    let handedOn = { target: null, until: 0 };

    const onTouchStart = (event) => {
        // A control that goes away under the finger (pause) never reports the finger lifting.
        if (event.touches.length === event.changedTouches.length) starts.clear();
        for (const touch of event.changedTouches) starts.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        if (within(elementOf(event.target), CONTROLS)) cancel(event);
    };

    const onTouchMove = (event) => {
        // Not cancelable: the browser is already scrolling a list, and finishes that on its own.
        if (!event.cancelable) return;
        if (event.touches.length > 1) {
            event.preventDefault(); // two fingers: a pinch
            return;
        }
        const element = elementOf(event.target);
        if (within(element, FIELDS)) return;
        const touch = event.changedTouches[0];
        const start = touch && starts.get(touch.identifier);
        const dx = start ? touch.clientX - start.x : 0;
        const dy = start ? touch.clientY - start.y : 0;
        if (!scrollerFor(element, dx, dy)) event.preventDefault();
    };

    const onTouchEnd = (event) => {
        const touch = event.changedTouches[0];
        const start = touch && starts.get(touch.identifier);
        for (const lifted of event.changedTouches) starts.delete(lifted.identifier);
        const element = elementOf(event.target);
        if (!element || within(element, FIELDS) || within(element, CONTROLS)) return;
        const quick = event.timeStamp - lastTapAt <= DOUBLE_TAP_MS;
        lastTapAt = event.timeStamp;
        if (!quick || !event.cancelable) return;
        event.preventDefault();
        // A cancelled touch makes no click, and a menu button tapped twice in a hurry should still
        // get both: make the click here.
        if (!touch || !isTap(start, { x: touch.clientX, y: touch.clientY })) return;
        handedOn = { target: element, until: event.timeStamp + DOUBLE_TAP_MS };
        if (typeof element.click === 'function') element.click();
        else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: touch.clientX, clientY: touch.clientY }));
    };

    const onClick = (event) => {
        if (!event.isTrusted || event.target !== handedOn.target || event.timeStamp > handedOn.until) return;
        event.preventDefault();
        event.stopPropagation();
    };

    const onDoubleClick = (event) => {
        if (!within(elementOf(event.target), FIELDS)) cancel(event);
    };

    // The keyboard pushes the page up to show a text field; when it closes the page goes back.
    const onFocusOut = (event) => {
        if (!within(elementOf(event.target), FIELDS)) return;
        setTimeout(() => {
            if (!within(document.activeElement, FIELDS)) window.scrollTo(0, 0);
        }, 60);
    };

    const listeners = [
        ['touchstart', onTouchStart],
        ['touchmove', onTouchMove],
        ['touchend', onTouchEnd],
        ['touchcancel', (event) => { for (const touch of event.changedTouches) starts.delete(touch.identifier); }],
        ['click', onClick],
        ['dblclick', onDoubleClick],
        // Safari's own pinch events (iPhone, iPad, and a trackpad on a Mac).
        ['gesturestart', cancel],
        ['gesturechange', cancel],
        ['gestureend', cancel],
        ['focusout', onFocusOut],
    ];
    // In the capture phase, so nothing in the game can keep an event from getting here; and not
    // passive, or preventDefault would be ignored.
    const options = { capture: true, passive: false };
    for (const [type, handler] of listeners) document.addEventListener(type, handler, options);

    return () => {
        for (const [type, handler] of listeners) document.removeEventListener(type, handler, options);
        html.classList.remove(LOCK_CLASS);
        if (viewport && siteViewport !== null) viewport.setAttribute('content', siteViewport);
    };
}
