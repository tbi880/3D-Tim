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
 * is passed to `onError` and thrown again outside the frame, where the browser reports it as
 * usual (console, and in development the on-page error notice).
 */

/** Errors thrown again per session: after that they are only counted, or a per-frame error would flood the console. */
const RETHROWN_PER_SESSION = 3;

/**
 * @param {THREE.WebGLRenderer} gl
 * @param {(error: unknown) => void} onError called for every frame that threw
 * @returns {() => void} undoes the wrapping
 */
export function guardXRFrames(gl, onError) {
    const xr = gl.xr;
    const setAnimationLoop = xr.setAnimationLoop;
    xr.setAnimationLoop = function guardedSetAnimationLoop(callback) {
        if (!callback) return setAnimationLoop.call(this, callback);
        let rethrown = 0;
        return setAnimationLoop.call(this, (time, frame) => {
            try {
                callback(time, frame);
            } catch (error) {
                onError(error);
                if (rethrown++ < RETHROWN_PER_SESSION) setTimeout(() => { throw error; }, 0);
            }
        });
    };
    return () => { xr.setAnimationLoop = setAnimationLoop; };
}
