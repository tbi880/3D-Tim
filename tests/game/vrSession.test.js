import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SESSION_REQUESTS, VRStartError, createVRStarter, summarizeFailures } from '../../src/game/xr/vrSession.js';

/** Starting a headset session (xr/vrSession.js): what is asked of the browser, and what is tried when it says no. */

/** Chromium's words for a session it will not give (what the Pico's browser said on 2026-11-18). */
const NOT_SUPPORTED = 'The specified session configuration is not supported.';

function domError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}

/**
 * A browser's `navigator.xr`, played by the book: required features it lacks refuse the
 * session, optional ones are left out, 'viewer' and 'local' are always there.
 *
 * @param {object} [options]
 * @param {string[]} [options.features] what the headset can give
 * @param {(init: XRSessionInit, index: number) => Error | null} [options.refuse] extra refusals
 */
function fakeXR({ features = ['local-floor'], refuse = () => null } = {}) {
    const requests = [];
    const sessions = [];
    return {
        requests,
        sessions,
        requestSession(mode, init) {
            requests.push({ mode, init });
            const refusal = refuse(init, requests.length - 1);
            if (refusal) return Promise.reject(refusal);
            if ((init.requiredFeatures ?? []).some((feature) => !features.includes(feature))) {
                return Promise.reject(domError('NotSupportedError', NOT_SUPPORTED));
            }
            const enabled = ['viewer', 'local', ...(init.optionalFeatures ?? []).filter((feature) => features.includes(feature)), ...(init.requiredFeatures ?? [])];
            const session = {
                ended: false,
                enabledFeatures: enabled,
                requestReferenceSpace(type) {
                    return enabled.includes(type)
                        ? Promise.resolve({ type })
                        : Promise.reject(domError('NotSupportedError', 'This device does not support the requested reference space type.'));
                },
                end() { this.ended = true; return Promise.resolve(); },
            };
            sessions.push(session);
            return Promise.resolve(session);
        },
    };
}

/** three.js's WebXRManager, as far as starting a session goes: it asks for its tracking space and fails without it. */
function fakeManager({ failSetSession = null } = {}) {
    return {
        referenceSpaceType: 'local-floor',
        session: null,
        setReferenceSpaceType(type) { this.referenceSpaceType = type; },
        async setSession(session) {
            if (failSetSession) throw failSetSession;
            await session.requestReferenceSpace(this.referenceSpaceType);
            this.session = session;
        },
    };
}

test('no request makes any feature required', () => {
    for (const request of SESSION_REQUESTS) assert.deepEqual(request.init().requiredFeatures ?? [], [], request.name);
    // Each request is a fresh object: nothing a browser does to one changes the next.
    assert.notEqual(SESSION_REQUESTS[0].init(), SESSION_REQUESTS[0].init());
});

test('a headset with a floor-level tracking space flies in it', async () => {
    const xr = fakeXR();
    const manager = fakeManager();
    const started = await createVRStarter().start(xr, manager);
    assert.equal(started.referenceSpace, 'local-floor');
    assert.equal(started.request, 'optional local-floor');
    assert.deepEqual(started.failures, []);
    assert.equal(manager.session, started.session);
    assert.equal(xr.requests.length, 1);
    assert.equal(xr.requests[0].mode, 'immersive-vr');
});

test('a headset without one still starts, at head level, on the first request', async () => {
    const xr = fakeXR({ features: [] });
    const manager = fakeManager();
    const started = await createVRStarter().start(xr, manager);
    assert.equal(started.referenceSpace, 'local');
    assert.equal(manager.referenceSpaceType, 'local');
    assert.equal(manager.session, started.session);
    assert.equal(xr.requests.length, 1);
});

test('a browser that refuses any feature at all is asked again with none, and later sessions start there', async () => {
    const xr = fakeXR({ refuse: (init) => ((init.optionalFeatures ?? []).length ? domError('NotSupportedError', NOT_SUPPORTED) : null) });
    const starter = createVRStarter();
    const started = await starter.start(xr, fakeManager());
    assert.equal(started.request, 'no features');
    assert.equal(started.referenceSpace, 'local');
    assert.equal(started.failures.length, 1);
    assert.equal(started.failures[0].error.message, NOT_SUPPORTED);
    assert.equal(starter.first, 'no features');

    xr.requests.length = 0;
    await starter.start(xr, fakeManager());
    assert.deepEqual(xr.requests.map(({ init }) => init), [{}]);
});

test('when every request is refused the error names each, the same reason said once', async () => {
    const xr = fakeXR({ refuse: () => domError('NotSupportedError', NOT_SUPPORTED) });
    const starter = createVRStarter();
    const error = await starter.start(xr, fakeManager()).catch((caught) => caught);
    assert.ok(error instanceof VRStartError);
    assert.equal(error.failures.length, 2);
    assert.equal(error.clickAgain, false);
    assert.equal(error.message, `NotSupportedError: ${NOT_SUPPORTED} [optional local-floor, no features]`);
    // Nothing worked: the next click asks for the floor again.
    assert.equal(starter.first, 'optional local-floor');
});

test('different reasons are each kept', () => {
    const summary = summarizeFailures([
        { request: 'a', error: domError('NotSupportedError', NOT_SUPPORTED) },
        { request: 'b', error: new Error('plain') },
    ]);
    assert.equal(summary, `NotSupportedError: ${NOT_SUPPORTED} [a] · plain [b]`);
});

test('a browser that spent the click on the first request gets the next one on the next click', async () => {
    const xr = fakeXR({
        refuse: (init, index) => {
            if (index === 0) return domError('NotSupportedError', NOT_SUPPORTED);
            if (index === 1) return domError('SecurityError', 'The requested session requires user activation.');
            return null;
        },
    });
    const starter = createVRStarter();
    const error = await starter.start(xr, fakeManager()).catch((caught) => caught);
    assert.equal(error.clickAgain, true);
    assert.equal(starter.first, 'no features');
    const started = await starter.start(xr, fakeManager());
    assert.equal(started.request, 'no features');
    assert.deepEqual(xr.requests.at(-1).init, {});
});

test('refusals that asking for less cannot change are not asked again', async () => {
    for (const name of ['SecurityError', 'InvalidStateError']) {
        const xr = fakeXR({ refuse: () => domError(name, 'no') });
        const error = await createVRStarter().start(xr, fakeManager()).catch((caught) => caught);
        assert.equal(xr.requests.length, 1, name);
        assert.equal(error.clickAgain, false, name);
        assert.equal(error.message, `${name}: no [optional local-floor]`);
    }
});

test('a session three.js cannot take is ended, not left running in the headset', async () => {
    const xr = fakeXR();
    const error = await createVRStarter().start(xr, fakeManager({ failSetSession: new Error('layer') })).catch((caught) => caught);
    assert.ok(error instanceof VRStartError);
    assert.equal(xr.sessions.length, 1);
    assert.equal(xr.sessions[0].ended, true);
    assert.equal(error.message, 'layer [optional local-floor]');
});

test('the first request goes out while the click is still being handled', () => {
    const xr = fakeXR();
    const pending = createVRStarter().start(xr, fakeManager());
    assert.equal(xr.requests.length, 1);
    return pending;
});

test('no WebXR, or no 3D view yet, says so', async () => {
    await assert.rejects(createVRStarter().start(undefined, fakeManager()), { name: 'VRStartError', message: /WebXR is not available/ });
    await assert.rejects(createVRStarter().start(fakeXR(), null), { name: 'VRStartError', message: /3D view is not ready/ });
});
