/**
 * What a player is playing on, as the lobby shows it beside their name: a kind (desktop,
 * phone or tablet, VR headset) and a short description worked out from the browser.
 * A browser cannot read the device's own name, so this is "Chrome · macOS", not "Tim's MacBook".
 */

/** Values of the backend's LanDeviceKind. */
export const DEVICE_KIND = Object.freeze({ DESKTOP: 'Desktop', MOBILE: 'Mobile', VR: 'VR' });

const HEADSETS = [
    [/Pico/i, 'Pico'],
    [/Quest|OculusBrowser/i, 'Meta Quest'],
    [/\bVR\b/i, 'VR headset'],
];

const BROWSERS = [
    [/PicoBrowser|Pico/i, 'Pico Browser'],
    [/OculusBrowser/i, 'Meta Browser'],
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox\/|FxiOS/, 'Firefox'],
    [/Chrome\/|CriOS/, 'Chrome'],
    [/Safari\//, 'Safari'],
];

const SYSTEMS = [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Macintosh|Mac OS X/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
];

const firstMatch = (table, text) => table.find(([pattern]) => pattern.test(text))?.[1] ?? null;

/**
 * @param {string} userAgent navigator.userAgent
 * @param {boolean} touch whether the primary pointer is a finger (input/device.js isTouchDevice)
 * @returns {{ kind: string, name: string }}
 */
export function describeDevice(userAgent = '', touch = false) {
    const headset = firstMatch(HEADSETS, userAgent);
    const browser = firstMatch(BROWSERS, userAgent) ?? 'Browser';
    if (headset) return { kind: DEVICE_KIND.VR, name: `${headset} · ${browser}` };
    // An iPad asks for desktop sites as a Mac; the finger gives it away.
    const system = firstMatch(SYSTEMS, userAgent) ?? 'Unknown device';
    const mobile = touch || /iPhone|iPad|Android|Mobile/.test(userAgent);
    const shown = mobile && system === 'macOS' ? 'iPad' : system;
    return { kind: mobile ? DEVICE_KIND.MOBILE : DEVICE_KIND.DESKTOP, name: `${browser} · ${shown}` };
}
