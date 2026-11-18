import { useGameStore } from '../state/gameStore.js';
import { DynamicResolution } from './DynamicResolution.js';
import { describeError, summarizeFailures } from './vrSession.js';

/**
 * How a VR session is going: its frame rate (kept up, when the pilot turns that on, by
 * scaling the resolution - DynamicResolution.js) and the figures to judge it by. VRCameraRig
 * drives it: `begin` and `end` round a session, `update` once a frame, `failed` for a frame
 * that threw.
 *
 *  - `flight` is what the VR pause menu shows (xr/VRMenu.js): the last half second of flying.
 *  - A report on the whole session is put in the game store (`vrReport`) when it ends, or when
 *    it could not start, and shown under the "Enter VR" button on the page (ui/Menus.jsx).
 *    Inside a headset there is no console to look at: this is how a session that showed
 *    nothing says what happened.
 */

const resolution = new DynamicResolution();
const PUBLISH_INTERVAL = 0.5;
let sincePublish = 0;
let session = null;

function describe(error, length = 240) {
    return describeError(error).slice(0, length);
}

export const vrPerformance = {
    /** The last flight's figures, or null before any: { fps, scale, width, height, drawCalls, triangles }. */
    flight: null,
    /** How long the last frame's script took, in milliseconds (told by xr/frameGuard.js). */
    lastFrameJs: 0,

    /** A session starts: full resolution, an empty report. */
    begin() {
        resolution.reset();
        sincePublish = 0;
        session = { frames: 0, seconds: 0, js: 0, width: 0, height: 0, lowestScale: 1, errors: 0, firstError: null, request: null, referenceSpace: null, refusals: null };
    },

    /**
     * How the session that has just begun was got (xr/vrSession.js): the request the browser
     * granted, the tracking space flown in, and the requests it refused before that.
     */
    started({ request, referenceSpace, failures }) {
        if (!session) return;
        session.request = request;
        session.referenceSpace = referenceSpace;
        session.refusals = failures.length ? describe(summarizeFailures(failures), 400) : null;
    },

    /** A frame's script took this long (xr/frameGuard.js). */
    frameTook(milliseconds) {
        this.lastFrameJs = milliseconds;
        if (session) session.js += milliseconds;
    },

    /** The session is over: publish its report. */
    end() {
        if (!session) return;
        const { frames, seconds, js } = session;
        useGameStore.setState({
            vrReport: {
                ...session,
                seconds: Math.round(seconds),
                fps: seconds > 0 ? Math.round(frames / seconds) : 0,
                js: frames > 0 ? Math.round((js / frames) * 10) / 10 : 0,
            },
        });
        session = null;
    },

    /** A frame threw (xr/frameGuard.js). */
    failed(error) {
        if (!session) return;
        session.errors += 1;
        session.firstError ??= describe(error);
    },

    /**
     * The session never started (every request was refused, or its set-up threw): why, for
     * each request tried (a VRStartError says them all), and whether clicking "Enter VR" again
     * tries something else (`clickAgain`) or only reloading the page can help.
     */
    couldNotStart(error) {
        useGameStore.setState({
            vrReport: {
                frames: 0, seconds: 0, fps: 0, js: 0, width: 0, height: 0, lowestScale: 1, errors: 1,
                firstError: describe(error?.name === 'VRStartError' ? error.message : error, 400),
                notStarted: true,
                clickAgain: Boolean(error?.clickAgain),
            },
        });
    },

    /**
     * @param {THREE.WebGLRenderer} gl
     * @param {number} delta seconds since the previous frame
     * @param {XRFrame} [frame] this frame, from useFrame
     * @param {{ flying: boolean, adapt: boolean }} options `flying`: the game is being played
     *   (not a menu); `adapt`: let the resolution follow the frame rate
     */
    update(gl, delta, frame, { flying, adapt }) {
        const xrSession = gl.xr.getSession();
        const scale = resolution.update(delta, xrSession?.frameRate, adapt);
        // The headset's own viewport scaling is only touched when the pilot has turned it on:
        // asked for on every frame's views, it is used from the next frame on.
        if (adapt) {
            const views = frame?.getViewerPose?.(gl.xr.getReferenceSpace())?.views ?? [];
            for (const view of views) view.requestViewportScale?.(scale);
        }

        // One eye's picture in pixels, and what the renderer drew last frame (both eyes).
        const eye = gl.xr.getCamera().cameras[0]?.viewport;
        const width = Math.round(eye?.z ?? 0);
        const height = Math.round(eye?.w ?? 0);
        if (session) {
            session.frames += 1;
            session.seconds += delta;
            session.lowestScale = Math.min(session.lowestScale, scale);
            if (width * height > session.width * session.height) {
                session.width = width;
                session.height = height;
            }
        }

        sincePublish += delta;
        if (!flying || sincePublish < PUBLISH_INTERVAL) return;
        sincePublish = 0;
        this.flight = { fps: Math.round(resolution.fps), scale, width, height, drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles };
    },
};
