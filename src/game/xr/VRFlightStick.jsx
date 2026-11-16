import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { XRSpace, useXRInputSourceStateContext } from '@react-three/xr';
import { bucketURL } from '../../Settings';
import { GLOW_BRIGHTNESS, addSelfLight, ambientLight } from './cabinLighting.js';

/**
 * The flight stick drawn in each of the pilot's hands in VR, in place of the headset's own
 * controller model: a wireless stick that belongs to the cabin (same leather, wood and
 * metal), with a ring of light floating under its foot where a cable would be.
 *
 * Modelled in Blender (tools/game-models/vr-cockpit) in WebXR's grip space, so it sits in
 * the hand the way the real controller does, and web-optimised with `npx gltfjsx --transform`.
 * One mesh, one draw call per hand: its lights are part of the mesh and shine through its
 * baked emissive map, in the cabin's ambient colour (cabinLighting.js). They brighten as
 * the hand squeezes the trigger.
 */

/** Same arguments as GltfModel (Draco + Meshopt decoders), so the file is fetched once. */
const MODEL_FILE = 'game/vr-stick-transformed.glb';
/** Starts downloading the stick (when the browser can do VR) so it is there on entering VR. */
export const preloadVRFlightStick = () => useGLTF.preload(bucketURL + MODEL_FILE, true, true);
/** How much brighter the stick's lights are with the trigger fully squeezed. */
const TRIGGER_GLOW = 1.5;

/**
 * The stick itself, in grip space. `getTrigger` returns how far its trigger is squeezed (0..1).
 * Each stick has its own copy of the material (the textures are shared), since each glows
 * with its own trigger.
 */
export function FlightStickModel({ getTrigger = null }) {
    const { nodes, materials } = useGLTF(bucketURL + MODEL_FILE, true, true);
    const material = useMemo(() => materials.stick.clone(), [materials]);
    useEffect(() => {
        const removeSelfLight = addSelfLight(material);
        return () => {
            removeSelfLight();
            material.dispose();
        };
    }, [material]);

    useFrame(() => {
        const squeeze = getTrigger ? getTrigger() : 0;
        material.emissive.copy(ambientLight.colour).multiplyScalar(GLOW_BRIGHTNESS * ambientLight.level * (1 + TRIGGER_GLOW * squeeze));
    });

    return <mesh geometry={nodes.stick.geometry} material={material} />;
}

/** The controller implementation given to @react-three/xr (vrState.js): one per controller. */
export default function VRFlightStick() {
    const state = useXRInputSourceStateContext('controller');
    const getTrigger = () => state.inputSource.gamepad?.buttons[0]?.value ?? 0;
    return (
        <XRSpace space="grip-space">
            <FlightStickModel getTrigger={getTrigger} />
        </XRSpace>
    );
}
