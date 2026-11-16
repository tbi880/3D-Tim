import { Suspense, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useVRActive, useVRSupported, vr } from '../xr/vrState.js';
import VRCockpitShell, { preloadVRCockpit } from '../xr/VRCockpitShell.jsx';
import { preloadVRFlightStick } from '../xr/VRFlightStick.jsx';
import GltfModel from './models/GltfModel.jsx';
import { ModelErrorBoundary, getModelInfo, useShipMaterials } from './models/ShipModel.jsx';

/**
 * The Kestrel's cockpit interior (public/assets/game/cockpit.glb), attached to the camera.
 *
 * `baseFov` is the field of view the model was laid out for. When the camera's field of
 * view widens (afterburner, warp) the cockpit is scaled sideways and upwards by the same
 * ratio, so it stays put on screen instead of shrinking into view as a floating frame.
 */
function CockpitModel() {
    const materials = useShipMaterials();
    // In VR the pilot can look all round, so the flat-screen model (steel plating, open behind,
    // the nose out ahead) gives way to a full cabin built for the headset.
    const inVR = useVRActive();
    return inVR ? <VRCockpitShell /> : <GltfModel url={getModelInfo('cockpit').file} materials={materials} />;
}

export default function Cockpit({ baseFov }) {
    const groupRef = useRef(null);
    const inVR = useVRActive();
    // Where VR can be entered, fetch the VR cabin and flight stick ahead of time so they are
    // there on entering.
    const vrSupported = useVRSupported();
    useEffect(() => {
        if (!vrSupported) return;
        preloadVRCockpit();
        preloadVRFlightStick();
    }, [vrSupported]);
    const baseTangent = Math.tan((baseFov * Math.PI) / 360);

    useFrame(({ camera }) => {
        const group = groupRef.current;
        if (!group) return;
        // In VR the field of view never changes (and the headset's camera has its own).
        const ratio = vr.active ? 1 : Math.tan((camera.fov * Math.PI) / 360) / baseTangent;
        group.scale.set(ratio, ratio, 1);
    });

    return (
        <group ref={groupRef}>
            <ModelErrorBoundary fallback={null}>
                <Suspense fallback={null}>
                    <CockpitModel />
                </Suspense>
            </ModelErrorBoundary>
            {/* Soft instrument glow so the interior never goes pitch black. The VR cabin has its
                glow baked in, and every light costs each lit surface in the scene, so not in VR. */}
            {!inVR && <pointLight position={[0, -0.3, -0.6]} intensity={0.5} distance={4} decay={1.2} color="#8fc4ff" />}
        </group>
    );
}
