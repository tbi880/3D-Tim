import { useEffect, useState } from 'react';
import { createXRStore } from '@react-three/xr';
import { useStore } from 'zustand';

/**
 * WebXR (VR headset) mode of the game.
 *
 * One XR store for the page (@react-three/xr). Nothing here runs in Node: only the browser
 * page and the 3D scene import this module, never the simulation.
 *
 * Choices made for comfort and frame rate (VR has to hold 72-90 fps in stereo):
 *  - controllers are drawn, but without ray / grab / teleport pointers: the game reads the
 *    sticks and buttons itself (xr/XRGamepadInput.js) and its menus are driven by the sticks;
 *  - hand tracking is off (flying needs the sticks and triggers);
 *  - fixed foveated rendering at full strength: the edges of the lenses are blurry anyway;
 *  - the headset's default refresh rate (72 Hz on a Quest) instead of the highest one.
 *
 * Without a headset, VR can be tried on a desktop browser with Meta's "Immersive Web
 * Emulator" browser extension.
 */

const CONTROLLER = { rayPointer: false, grabPointer: false, teleportPointer: false };

let store = null;

/** The page's XR store, created on first use. */
export function getXRStore() {
    if (!store) {
        store = createXRStore({
            emulate: false,
            offerSession: false,
            enterGrantedSession: false,
            controller: CONTROLLER,
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
        return undefined;
    });
}

/** Ends the VR session and returns to the flat page. */
export function exitVR() {
    getXRStore().getState().session?.end().catch(() => {});
}
