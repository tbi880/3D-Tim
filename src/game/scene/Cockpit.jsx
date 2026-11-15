import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useVRActive, vr } from '../xr/vrState.js';
import VRCockpitShell from '../xr/VRCockpitShell.jsx';
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
    // In VR the pilot can look behind them, where the flat-screen model is open.
    const inVR = useVRActive();
    return (
        <>
            <GltfModel url={getModelInfo('cockpit').file} materials={materials} />
            {inVR && <VRCockpitShell materials={materials} />}
        </>
    );
}

export default function Cockpit({ baseFov }) {
    const groupRef = useRef(null);
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
            {/* Soft instrument glow so the interior never goes pitch black. */}
            <pointLight position={[0, -0.3, -0.6]} intensity={0.5} distance={4} decay={1.2} color="#8fc4ff" />
        </group>
    );
}
