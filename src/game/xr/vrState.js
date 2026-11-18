import { useEffect, useState } from 'react';
import { createXRStore } from '@react-three/xr';
import { useStore } from 'zustand';
import { isHeadsetBrowser } from '../../utils/headsetBrowser.js';
import VRFlightStick from './VRFlightStick.jsx';
import { vrPerformance } from './vrPerformance.js';
import { createVRStarter } from './vrSession.js';

/**
 * WebXR (VR headset) mode of the game.
 *
 * One XR store for the page (@react-three/xr). Nothing here runs in Node: only the browser
 * page and the 3D scene import this module, never the simulation.
 *
 * Choices made for comfort and frame rate (VR has to hold 72-90 fps in stereo):
 *  - each controller is drawn as a flight stick (xr/VRFlightStick.jsx) instead of the
 *    headset's own controller model, and without ray / grab / teleport pointers: the game
 *    reads the sticks and buttons itself (xr/XRGamepadInput.js) and its menus are driven by
 *    the sticks;
 *  - hand tracking is off (flying needs the sticks and triggers);
 *  - fixed foveated rendering at full strength: the edges of the lenses are blurry anyway;
 *  - each eye's buffer is left at the size the headset's browser recommends: a smaller one
 *    (framebufferScaleFactor 0.8) gave a session that ran with both eyes black in the Pico's
 *    browser. Following the frame rate with the resolution inside that buffer
 *    (DynamicResolution.js) is one of the `?vrtest` tools only: the Pico's browser ignores
 *    the viewport scaling it relies on, and no other headset has tried it;
 *  - 4x multisampling (see `canvasAntialias`): on a headset's tile-based GPU it costs next
 *    to nothing, and without it every hull edge and light line shimmers as the head moves;
 *  - the headset's default refresh rate (72 Hz on a Quest) instead of the highest one;
 *  - no WebXR feature required, not even the floor-level tracking space: the session is
 *    started here (vrSession.js), not by the store, which would require 'local-floor' and
 *    get the whole session refused by a browser that cannot give it.
 *
 * Without a headset, VR can be tried on a desktop browser with Meta's "Immersive Web
 * Emulator" browser extension.
 */

let store = null;
/** three.js's WebXR manager (the renderer's `xr`), handed to the store by <XR> in GameScene. */
let xrManager = null;
const starter = createVRStarter();

/**
 * Whether the game's WebGL canvas should be created with antialiasing.
 *
 * In VR three.js draws straight into the headset's layer, multisampled only if the canvas
 * itself was created with antialiasing, and that cannot be changed once the canvas exists.
 * On the flat page the post-processing composer does the smoothing instead (config/
 * graphics.js) and canvas antialiasing would only cost memory, so it is asked for only in
 * a headset's own browser (Pico, Quest), where VR is what the page is opened for.
 */
export function canvasAntialias() {
    return isHeadsetBrowser();
}

/**
 * Extra WebGL context options in a headset's own browser: always the GPU's fast mode. The
 * site asks for "low-power" whenever a page renders one pixel per CSS pixel, as the game's
 * Smooth preset does, which is the last thing wanted where the page is about to draw two
 * eyes at once.
 */
export function headsetContextOptions() {
    return canvasAntialias() ? { powerPreference: 'high-performance' } : {};
}

/** The page's XR store, created on first use. */
export function getXRStore() {
    if (!store) {
        store = createXRStore({
            emulate: false,
            offerSession: false,
            enterGrantedSession: false,
            controller: VRFlightStick,
            hand: false,
            gaze: false,
            screenInput: false,
            transientPointer: false,
            foveation: 1,
            frameRate: false,
            handTracking: false,
            layers: false,
            anchors: false,
            hitTest: false,
            planeDetection: false,
            meshDetection: false,
            domOverlay: false,
        });
        // Keep the renderer's XR manager: enterVR hands it the session itself.
        const setWebXRManager = store.setWebXRManager;
        store.setWebXRManager = (manager) => {
            xrManager = manager;
            setWebXRManager(manager);
        };
        store.subscribe((state, previous) => {
            vr.active = state.session != null && state.mode === 'immersive-vr';
            // three.js keeps a finished session's reference space, and the store goes on
            // offering it until the new session's first frame: long enough for the controllers
            // to be asked for their pose in it, which a real browser refuses (a space belongs
            // to its session). Forget it the moment a new session starts.
            if (state.session && state.session !== previous.session && state.originReferenceSpace) {
                store.setState({ originReferenceSpace: undefined });
            }
        });
    }
    return store;
}

/**
 * Whether the page was opened with `?vrtest` in its address. That, and only that, shows the
 * tools for looking into how VR runs in a headset: in the VR pause menu the last flight's
 * frame rate and the tests (xr/vrBenchmark.js, xr/vrUploadTest.js, dynamic resolution), and
 * on the page the last session's figures and the tests' results. A player sees none of it,
 * except a session that failed, which says so under the "Enter VR" button.
 */
export const VR_DIAGNOSTICS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('vrtest');

/**
 * Plain, per-frame readable VR state (no React): whether a headset session is running, and
 * the view used in it. VR has its own view setting so flying in VR never changes the saved
 * desktop view.
 */
export const vr = {
    active: false,
    /** 'cockpit' | 'chase' */
    view: 'cockpit',
    /** Whether the resolution follows the frame rate (the VR pause menu's switch; not saved). */
    dynamicResolution: false,
};

/** The camera mode the scene should use right now. */
export function cameraModeOf(session) {
    return vr.active ? vr.view : session.settings.cameraMode;
}

/** React: true while a VR session is running. */
export function useVRActive() {
    return useStore(getXRStore(), (state) => state.session != null && state.mode === 'immersive-vr');
}

/** React: true when this browser can start an immersive VR session (headset connected, or the emulator). */
export function useVRSupported() {
    const [supported, setSupported] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const xr = typeof navigator !== 'undefined' ? navigator.xr : null;
        if (!xr?.isSessionSupported) return undefined;
        xr.isSessionSupported('immersive-vr').then((value) => { if (!cancelled) setSupported(value); }).catch(() => {});
        return () => { cancelled = true; };
    }, []);
    return supported;
}

/**
 * Starts a VR session. Must be called from a click (browsers need a user gesture). The store
 * picks the session up from three.js when it starts.
 */
export function enterVR() {
    vr.view = 'cockpit';
    getXRStore();
    const xr = typeof navigator !== 'undefined' ? navigator.xr : undefined;
    return starter.start(xr, xrManager).then((started) => {
        if (started.failures.length) console.warn('[Echoes of Dawn] VR started after refusals:', started.failures);
        vrPerformance.started(started);
        return started.session;
    }, (error) => {
        console.warn('[Echoes of Dawn] Could not start VR:', error, error?.failures ?? '');
        // No console in a headset: say so on the page.
        vrPerformance.couldNotStart(error);
        return undefined;
    });
}

/** Ends the VR session and returns to the flat page. */
export function exitVR() {
    getXRStore().getState().session?.end().catch(() => {});
}
