/** A VR headset's own browser (Pico Browser, Meta Quest Browser) by its user agent. */
const HEADSET_BROWSER = /Pico|OculusBrowser|Quest|\bVR\b/i;

/**
 * Whether the page is open in a VR headset's own browser. There the page already floats on a
 * screen of its own, VR is what it is opened for, and some page features work differently:
 * fullscreen in the Pico's browser is its cinema-like "immersive mode", after which the
 * headset refuses VR sessions (see utils/fullscreen.js).
 *
 * @param {string} [userAgent] defaults to this browser's
 */
export function isHeadsetBrowser(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
    return HEADSET_BROWSER.test(userAgent ?? '');
}

/** Set once the browser has said it can start an immersive VR session (see noteVRSupported). */
let vrSupported = false;

/**
 * The browser has said it can start an immersive VR session (`navigator.xr.isSessionSupported`,
 * asked by the game page for its "Enter VR" button: xr/vrState.js). Only the game asks: on
 * some PCs asking wakes the VR runtime (SteamVR), which no other page of the site should do.
 */
export function noteVRSupported() {
    vrSupported = true;
}

/**
 * Whether this browser can do VR: a headset's own browser, or one that has said it can start
 * a VR session. Clicks then leave the page windowed (hooks/useClickToFullscreen.jsx): in a
 * Pico, fullscreen is its immersive mode, after which VR no longer starts.
 */
export function canDoVR() {
    return vrSupported || isHeadsetBrowser();
}
