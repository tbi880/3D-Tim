import { forwardRef, useCallback, useEffect, useRef } from 'react';
import { EffectComposer } from '@react-three/postprocessing';

// @react-three/postprocessing (v2) creates a new postprocessing EffectComposer whenever the
// default camera changes, and never frees the old one (nor the last one on unmount). Each
// composer owns two full-screen half-float buffers (multisampled on phones), so every camera
// switch, and every unmount of a composer the scene shows conditionally (the Scene 3 noise
// effect), left tens of MB of GPU memory behind. Scene 5 switches cameras five times.
// Use this instead of EffectComposer in every scene.
//
// This wrapper frees the buffers of a composer once it has been replaced or unmounted.
// Only the render targets are disposed, not the composer itself: three.js re-allocates them
// if the same composer renders again (React StrictMode remounts reuse it in development).
function releaseBuffers(composer) {
    composer.inputBuffer?.dispose();
    composer.outputBuffer?.dispose();
}

const ManagedEffectComposer = forwardRef(function ManagedEffectComposer(props, ref) {
    const current = useRef(null);

    const setComposer = useCallback((composer) => {
        if (composer && current.current && current.current !== composer) {
            // The library has already moved the effect passes to the new composer.
            releaseBuffers(current.current);
        }
        if (composer) current.current = composer;
        if (typeof ref === 'function') ref(composer);
        else if (ref) ref.current = composer;
    }, [ref]);

    useEffect(() => () => {
        if (current.current) releaseBuffers(current.current);
    }, []);

    return <EffectComposer ref={setComposer} {...props} />;
});

export default ManagedEffectComposer;
