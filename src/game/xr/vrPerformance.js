import { DynamicResolution } from './DynamicResolution.js';

/**
 * The headset's frame rate, kept up by scaling the resolution (DynamicResolution.js), and
 * the numbers to judge it by. VRCameraRig calls `update` once a frame during a VR session.
 *
 * `flight` is what the pause menu shows (xr/VRMenu.js): the figures of the last half second
 * of flying, so they can be read in the headset itself, the only place they mean anything.
 */

const resolution = new DynamicResolution();
const PUBLISH_INTERVAL = 0.5;
let sincePublish = 0;

export const vrPerformance = {
    /** The last flight's figures, or null before any: { fps, scale, width, height, drawCalls, triangles }. */
    flight: null,

    /** A new session starts at full resolution. */
    reset() {
        resolution.reset();
        sincePublish = 0;
    },

    /**
     * @param {THREE.WebGLRenderer} gl
     * @param {number} delta seconds since the previous frame
     * @param {XRFrame} [frame] this frame, from useFrame
     * @param {boolean} flying whether the game is being played (not a menu)
     */
    update(gl, delta, frame, flying) {
        const session = gl.xr.getSession();
        const scale = resolution.update(delta, session?.frameRate);
        // Asked for on every frame's views; it is used from the next frame on.
        const views = frame?.getViewerPose?.(gl.xr.getReferenceSpace())?.views ?? [];
        for (const view of views) view.requestViewportScale?.(scale);

        sincePublish += delta;
        if (!flying || sincePublish < PUBLISH_INTERVAL) return;
        sincePublish = 0;
        // What the renderer drew last frame (both eyes), and one eye's picture in pixels.
        const eye = gl.xr.getCamera().cameras[0]?.viewport;
        this.flight = {
            fps: Math.round(resolution.fps),
            scale,
            width: Math.round(eye?.z ?? 0),
            height: Math.round(eye?.w ?? 0),
            drawCalls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
        };
    },
};
