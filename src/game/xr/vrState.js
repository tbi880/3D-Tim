import { useEffect, useState } from 'react';
import { createXRStore } from '@react-three/xr';
import { useStore } from 'zustand';
import { GRAPHICS } from '../config/graphics.js';
import { useGameStore } from '../state/gameStore.js';
import VRFlightStick from './VRFlightStick.jsx';
import { vrPerformance } from './vrPerformance.js';

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
 *  - each eye's buffer is sized by the graphics setting (config/graphics.js, `vrResolution`):
 *    a headset's GPU is limited by the number of pixels it has to fill, and a late frame is
 *    worse than a soft one. The resolution can also follow the frame rate
 *    (DynamicResolution.js), which the pilot turns on in the VR pause menu: it relies on a
 *    part of WebXR (viewport scaling) that few pages use and that has not been seen working
 *    in every headset's browser, so it is off until asked for;
 *  - 4x multisampling (see `canvasAntialias`): on a headset's tile-based GPU it costs next
 *    to nothing, and without it every hull edge and light line shimmers as the head moves;
 *  - the headset's default refresh rate (72 Hz on a Quest) instead of the highest one.
 *
 * Without a headset, VR can be tried on a desktop browser with Meta's "Immersive Web
 * Emulator" browser extension.
 */

let store = null;

const HEADSET_BROWSER = /Pico|OculusBrowser|Quest|\bVR\b/i;

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
    return typeof navigator !== 'undefined' && HEADSET_BROWSER.test(navigator.userAgent);
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
            // Asked each time a session starts, so the setting can be changed between sessions.
            frameBufferScaling: () => GRAPHICS[useGameStore.getState().settings.graphics].vrResolution,
            frameRate: false,
            handTracking: false,
            layers: false,
            anchors: false,
            hitTest: false,
            planeDetection: false,
            meshDetection: false,
            domOverlay: false,
        });
        store.subscribe((state) => {
            vr.active = state.session != null && state.mode === 'immersive-vr';
        });
    }
    return store;
}

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

/** Starts a VR session. Must be called from a click (browsers need a user gesture). */
export function enterVR() {
    vr.view = 'cockpit';
    return getXRStore().enterVR().catch((error) => {
        console.warn('[Echoes of Dawn] Could not start VR:', error);
        // No console in a headset: say so on the page.
        vrPerformance.couldNotStart(error);
        return undefined;
    });
}

/** Ends the VR session and returns to the flat page. */
export function exitVR() {
    getXRStore().getState().session?.end().catch(() => {});
}
