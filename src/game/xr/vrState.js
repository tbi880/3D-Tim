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

/**
 * Keeps the game's depth buffer away from the headset's compositor.
 *
 * On headsets with WebXR layers (Quest), three renders straight into a projection layer that
 * has a depth texture, and the compositor reads that depth to re-project each frame to the
 * latest head pose. It assumes ordinary perspective depth, but this game writes a logarithmic
 * depth buffer (it spans metres to thousands of kilometres), so the compositor took the
 * cockpit, a metre away, for something a couple of centimetres from the eyes and warped it
 * out of view: only the HUD screens (which write no depth) and distant objects survived.
 * Asking for the layer without depth (depthFormat 0) makes three keep its own depth buffer
 * for drawing and hand the compositor colour only.
 */
function submitColourOnly() {
    const binding = typeof XRWebGLBinding === 'undefined' ? null : XRWebGLBinding.prototype;
    if (!binding?.createProjectionLayer || binding.createProjectionLayer.colourOnly) return;
    const create = binding.createProjectionLayer;
    const createColourOnly = function createProjectionLayer(init = {}) {
        const layer = create.call(this, { ...init, depthFormat: 0 });
        // three keys its own depth buffer off this; a layer without depth must report it.
        if (layer && layer.ignoreDepthValues !== true) Object.defineProperty(layer, 'ignoreDepthValues', { value: true });
        return layer;
    };
    createColourOnly.colourOnly = true;
    binding.createProjectionLayer = createColourOnly;
}

/** The page's XR store, created on first use. */
export function getXRStore() {
    if (!store) {
        submitColourOnly();
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
