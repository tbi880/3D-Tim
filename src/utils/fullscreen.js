import { isHeadsetBrowser } from './headsetBrowser.js';

/**
 * Cross-browser fullscreen helpers. Browsers only allow entering fullscreen from a user
 * gesture (a click, tap or key press), so call `enterFullscreen` from such a handler.
 *
 * Never in a VR headset's own browser: the Pico's browser shows a fullscreen page in its
 * cinema-like "immersive mode" (沉浸模式), and once the page has been there the headset
 * refuses VR sessions ("The specified session configuration is not supported", Tim's Pico on
 * 2026-11-18, on the live site, where every click asked for fullscreen). The page already has
 * a screen of its own in a headset, so fullscreen gains nothing there.
 */

let pending = false;
/** Set when the player chose a window with the game's fullscreen switch: clicks stop going fullscreen. */
let autoFullscreenOff = false;

export function isAutoFullscreenOff() {
    return autoFullscreenOff;
}

export function setAutoFullscreenOff(off) {
    autoFullscreenOff = Boolean(off);
}

/** The element currently shown fullscreen, or null. */
export function getFullscreenElement() {
    return document.fullscreenElement ?? document.webkitFullscreenElement ?? document.mozFullScreenElement ?? document.msFullscreenElement ?? null;
}

/** False where pages cannot go fullscreen at all (e.g. Safari on iPhone). */
export function isFullscreenSupported() {
    const root = document.documentElement;
    return Boolean(root.requestFullscreen || root.webkitRequestFullscreen || root.mozRequestFullScreen || root.msRequestFullscreen);
}

/**
 * Asks the browser to show the whole page fullscreen. Does nothing if it already is, if a
 * request is still in flight, if the browser has no fullscreen support, or in a VR headset's
 * browser (see above).
 * @returns {Promise<boolean>} whether the page ended up fullscreen
 */
export async function enterFullscreen(element = document.documentElement) {
    if (getFullscreenElement()) return true;
    if (pending || isHeadsetBrowser() || !isFullscreenSupported()) return false;
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen ?? element.mozRequestFullScreen ?? element.msRequestFullscreen;
    pending = true;
    try {
        await request.call(element);
        return true;
    } catch {
        // Refused (no user gesture, an iframe without permission, the user said no): stay windowed.
        return false;
    } finally {
        pending = false;
    }
}

/** Leaves fullscreen if the page is showing fullscreen. */
export async function exitFullscreen() {
    if (!getFullscreenElement()) return;
    const exit = document.exitFullscreen ?? document.webkitExitFullscreen ?? document.mozCancelFullScreen ?? document.msExitFullscreen;
    try {
        await exit?.call(document);
    } catch {
        // Already left (e.g. Esc pressed at the same time).
    }
}

/** Events fired when the page enters or leaves fullscreen, across browsers. */
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
