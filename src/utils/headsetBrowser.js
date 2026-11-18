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
