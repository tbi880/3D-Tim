/**
 * Starting a headset session: what the game asks the browser for, and the tracking space it
 * flies in.
 *
 * The game needs nothing from WebXR beyond an immersive session itself: VRCameraRig re-centres
 * the seat on the pilot's head a moment after the session starts, so the floor-level tracking
 * space ('local-floor') and the head-level one every immersive session has ('local') give the
 * same seat. So no feature is ever *required*: a browser that cannot give one refuses the
 * whole session ("The specified session configuration is not supported", what the Pico's
 * browser said on 2026-11-18). Instead:
 *
 *  1. ask for 'local-floor' as an optional feature, and fly in it when the session grants it,
 *     in 'local' otherwise;
 *  2. if the browser still refuses, ask again with nothing at all (the WebXR minimum) - unless
 *     the refusal was one that asking for less cannot change (no click to allow it, a session
 *     already running).
 *
 * A request refused for want of a click (a browser that spends the click on the first
 * request) leaves the next click on "Enter VR" to start with the request after the refused
 * one, and the error says to click again rather than reload.
 *
 * Plain module (no React or three imports), so the order of requests is tested in Node.
 */

/**
 * What is asked of the browser, in turn. `init` makes a fresh XRSessionInit each time: a
 * browser (or the emulator) may keep or change the one it is handed.
 */
export const SESSION_REQUESTS = [
    { name: 'optional local-floor', init: () => ({ optionalFeatures: ['local-floor'] }) },
    { name: 'no features', init: () => ({}) },
];

/** Refusals after which asking again with less makes no difference. */
const FINAL_REFUSALS = new Set(['SecurityError', 'InvalidStateError']);

/** A refusal for want of a user gesture (the click was spent, or too long ago). */
const NEEDS_CLICK = 'SecurityError';

/** "NotSupportedError: The specified session configuration is not supported." */
export function describeError(error) {
    const name = error?.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return `${name}${error?.message ?? error}`;
}

/** A session that could not be started: every request tried, and why each failed. */
export class VRStartError extends Error {
    /**
     * @param {{ request: string, error: unknown }[]} failures in the order they were tried
     * @param {{ clickAgain?: boolean }} [options] `clickAgain`: the next click tries something else
     */
    constructor(failures, { clickAgain = false } = {}) {
        super(summarizeFailures(failures));
        this.name = 'VRStartError';
        this.failures = failures;
        this.clickAgain = clickAgain;
    }
}

/**
 * The failures in one line, identical reasons said once:
 * "NotSupportedError: The specified session configuration is not supported. [optional local-floor, no features]".
 */
export function summarizeFailures(failures) {
    const reasons = new Map();
    for (const { request, error } of failures) {
        const reason = describeError(error);
        if (!reasons.has(reason)) reasons.set(reason, []);
        reasons.get(reason).push(request);
    }
    return [...reasons].map(([reason, requests]) => `${reason} [${requests.join(', ')}]`).join(' · ');
}

/** 'local-floor' if this session gives it, 'local' (which every immersive session has) otherwise. */
async function trackingSpaceOf(session) {
    try {
        await session.requestReferenceSpace('local-floor');
        return 'local-floor';
    } catch {
        return 'local';
    }
}

/**
 * Starts headset sessions for the page, remembering between clicks which request to begin
 * with.
 *
 * @param {{ name: string, init: () => XRSessionInit }[]} [requests]
 */
export function createVRStarter(requests = SESSION_REQUESTS) {
    let first = 0;

    return {
        /** The request the next start begins with (for tests). */
        get first() { return requests[first].name; },

        /**
         * Asks for a session and hands it to three.js. Must be called from a click: the first
         * request goes out before this returns.
         *
         * @param {XRSystem | undefined} xr `navigator.xr`
         * @param {THREE.WebXRManager | null} manager the renderer's `xr`
         * @returns {Promise<{ session: XRSession, request: string, referenceSpace: string, failures: { request: string, error: unknown }[] }>}
         *   rejected with a VRStartError when no request worked
         */
        async start(xr, manager) {
            if (!xr?.requestSession) throw new VRStartError([{ request: 'navigator.xr', error: new Error('WebXR is not available in this browser') }]);
            if (!manager) throw new VRStartError([{ request: 'renderer', error: new Error('the 3D view is not ready yet') }]);
            const failures = [];
            for (let index = first; index < requests.length; index++) {
                const request = requests[index];
                let session;
                try {
                    session = await xr.requestSession('immersive-vr', request.init());
                } catch (error) {
                    failures.push({ request: request.name, error });
                    if (error?.name === NEEDS_CLICK && index > first) {
                        // The browser spent the click on the request before: the next click starts here.
                        first = index;
                        throw new VRStartError(failures, { clickAgain: true });
                    }
                    if (FINAL_REFUSALS.has(error?.name)) break;
                    continue;
                }
                try {
                    const referenceSpace = await trackingSpaceOf(session);
                    manager.setReferenceSpaceType(referenceSpace);
                    await manager.setSession(session);
                    // Later sessions on this page start with the request that worked.
                    first = index;
                    return { session, request: request.name, referenceSpace, failures };
                } catch (error) {
                    // The session started but three.js could not take it: give the headset back.
                    failures.push({ request: request.name, error });
                    await session.end().catch(() => {});
                    break;
                }
            }
            throw new VRStartError(failures);
        },
    };
}
