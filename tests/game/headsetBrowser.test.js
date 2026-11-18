import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDoVR, isHeadsetBrowser, noteVRSupported } from '../../src/utils/headsetBrowser.js';
import { enterFullscreen } from '../../src/utils/fullscreen.js';

/** A VR headset's own browser, and no fullscreen there (utils/headsetBrowser.js, utils/fullscreen.js). */

const PICO = 'Mozilla/5.0 (X11; Linux x86_64; PICO 4 OS5.8.0 like Quest) AppleWebKit/537.36 (KHTML, like Gecko) PicoBrowser/3.3.38 Chrome/105.0.5195.68 VR Safari/537.36';
const QUEST = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0.0.0 SamsungBrowser/4.0 Chrome/126.0.0.0 VR Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

test('headset browsers are told from desktops and phones', () => {
    assert.equal(isHeadsetBrowser(PICO), true);
    assert.equal(isHeadsetBrowser(QUEST), true);
    for (const userAgent of [MAC, IPHONE, ANDROID, '', undefined]) assert.equal(isHeadsetBrowser(userAgent ?? ''), false, userAgent);
});

/** Runs `body` with a browser of this user agent whose page can go fullscreen; returns how often it was asked to. */
async function fullscreenRequests(userAgent, body) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let requests = 0;
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
    globalThis.document = { fullscreenElement: null, documentElement: { requestFullscreen: async () => { requests += 1; } } };
    try {
        await body();
    } finally {
        Object.defineProperty(globalThis, 'navigator', saved);
        delete globalThis.document;
    }
    return requests;
}

test('a headset browser is never asked for fullscreen (the Pico shows it as its immersive mode, and VR fails after)', async () => {
    assert.equal(await fullscreenRequests(PICO, async () => assert.equal(await enterFullscreen(), false)), 0);
    assert.equal(await fullscreenRequests(QUEST, async () => assert.equal(await enterFullscreen(), false)), 0);
});

test('other browsers still are', async () => {
    assert.equal(await fullscreenRequests(MAC, async () => assert.equal(await enterFullscreen(), true)), 1);
    assert.equal(await fullscreenRequests(ANDROID, async () => assert.equal(await enterFullscreen(), true)), 1);
});

test('clicks stop going fullscreen once the browser says it can start VR, whatever it calls itself', () => {
    // Node's user agent is no headset's, and nothing has said VR works yet.
    assert.equal(canDoVR(), false);
    noteVRSupported();
    assert.equal(canDoVR(), true);
});
