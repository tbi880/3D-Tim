/**
 * Keeps one bad frame from blacking out the headset for good.
 *
 * three.js asks the headset for the next frame only after the current frame's callback has
 * returned. If anything in that callback throws - one line in one component - the next frame
 * is never asked for: the picture in the headset freezes or goes black, and nothing short of
 * leaving VR brings it back. Outside a headset the same mistake costs one frame.
 *
 * And frames do throw. When a second VR session starts in the same page, @react-three/xr can
 * hold the previous session's reference space for a frame or two until React has re-rendered,
 * and asking a frame for a pose in another session's space is an InvalidStateError in a real
 * browser (the desktop emulator does not check, so it never shows there).
 *
 * `guardXRFrames` wraps whatever callback is given to `renderer.xr.setAnimationLoop` (React
 * Three Fiber sets it when a session starts) so that an error ends that frame only. The error
 * goes to the console and to `onError` (the session's report on the page, vrPerformance.js).
 *
 * Being round the whole of a frame's script, the wrapper is also where that is timed:
 * `onFrame` is told how long each frame's callback took.
 */

/** Errors written to the console per session: after that they are only counted, or a per-frame error would flood it. */
const LOGGED_PER_SESSION = 5;

/**
 * @param {THREE.WebGLRenderer} gl
 * @param {{ onError: (error: unknown) => void, onFrame: (milliseconds: number) => void }} handlers
 *   `onError` for every frame that threw, `onFrame` after every frame with how long its callback took
 * @returns {() => void} undoes the wrapping
 */
export function guardXRFrames(gl, { onError, onFrame }) {
    const xr = gl.xr;
    const setAnimationLoop = xr.setAnimationLoop;
    xr.setAnimationLoop = function guardedSetAnimationLoop(callback) {
        if (!callback) return setAnimationLoop.call(this, callback);
        let logged = 0;
        return setAnimationLoop.call(this, (time, frame) => {
            const started = performance.now();
            try {
                callback(time, frame);
            } catch (error) {
                onError(error);
                if (logged++ < LOGGED_PER_SESSION) console.error('[Echoes of Dawn] A VR frame failed:', error);
            }
            onFrame(performance.now() - started);
        });
    };
    return () => { xr.setAnimationLoop = setAnimationLoop; };
}
