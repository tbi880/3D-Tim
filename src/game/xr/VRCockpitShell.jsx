import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { bucketURL } from '../../Settings';
import { GLOW_BRIGHTNESS, LINE_BRIGHTNESS, PULSE_SPACING, addSelfLight, ambientLight } from './cabinLighting.js';
import layout from './cockpitLayout.json';

/**
 * The cockpit interior for VR: a cabin built round the pilot, modelled in Blender
 * (tools/game-models/vr-cockpit) and web-optimised with `npx gltfjsx --transform`.
 *
 * cockpit.glb was built for a flat screen (only what lies ahead is ever seen, and it is
 * steel ship plating with the long nose out in front), so in VR it is not drawn and this
 * cabin replaces it, in the cockpit model's own frame (eye at the origin, -z ahead, metres).
 *
 * The file holds three meshes, so the whole cabin is three draw calls and no light:
 *  - `cabin`: every opaque surface in one material. Its colour (with the cabin's own
 *    shading), roughness / metalness and the glow the ambient lights cast on each surface
 *    were baked into one texture atlas; that glow is the material's emissive map, tinted
 *    here with the ambient colour.
 *  - `lights`: the ambient light strips (waist, footwell, canopy frame, rear wall, seat,
 *    displays, air vents). u runs along each strip in metres, for the pulses that travel
 *    along them.
 *  - `glass`: the tinted glass roof.
 * Faces the pilot's head can never see were removed in Blender.
 *
 * The ambient light follows the ship, and stutters when the hull is hit (cabinLighting.js).
 */

/**
 * The whole cabin (seat included) is drawn this much larger round the pilot's eye, so it
 * sits further away in the headset. VRHud scales the instrument display the same way.
 */
export const CABIN_SCALE = layout.cabinScale;

/**
 * Where sparks can burst from when the hull is hit, each [x, y, z, dx, dy, dz] in the cabin
 * as drawn (see scene/CockpitSparks.jsx): the tips of the display glass, the dash top, under
 * the display, the side sills, the canopy rails and the arch overhead.
 */
export const SPARK_EMITTERS = [
    [-0.86, -0.46, -0.6, 0.3, 1, 0.5], [0.86, -0.46, -0.6, -0.3, 1, 0.5],
    [-0.45, -0.57, -1.15, 0, 1, 0.4], [0.45, -0.57, -1.15, 0, 1, 0.4],
    [-0.3, -0.7, -0.55, 0, 0.7, 0.7], [0.3, -0.7, -0.55, 0, 0.7, 0.7],
    [-2.1, -0.6, -0.2, 0.8, 0.7, 0], [2.1, -0.6, -0.2, -0.8, 0.7, 0],
    [-1.95, 0.9, -0.5, 0.8, -0.5, 0.2], [1.95, 0.9, -0.5, -0.8, -0.5, 0.2],
    [-0.9, 1.52, 0.6, 0, -1, -0.3], [0.9, 1.52, 0.6, 0, -1, -0.3],
].map(([x, y, z, ...direction]) => [x * layout.cabinScale, y * layout.cabinScale, z * layout.cabinScale, ...direction]);

/** Same arguments as GltfModel (Draco + Meshopt decoders), so the file is fetched once. */
const MODEL_FILE = 'game/vr-cockpit-transformed.glb';
const useCabinModel = () => useGLTF(bucketURL + MODEL_FILE, true, true);
/** Starts downloading the cabin (when the browser can do VR) so it is there on entering VR. */
export const preloadVRCockpit = () => useGLTF.preload(bucketURL + MODEL_FILE, true, true);

/**
 * The material of the ambient light strips: the ambient colour, brightest along the middle
 * of the strip (`profile`, the strip's own texture), with slow pulses of light travelling
 * along every strip (u is metres along it), like current through a fibre.
 */
function createLightMaterial(profile) {
    return new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color() },
            profile: { value: profile },
            // Metres the pulses have travelled.
            travel: { value: 0 },
        },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec2 vStrip;
            void main() {
                vStrip = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            uniform vec3 color;
            uniform sampler2D profile;
            uniform float travel;
            varying vec2 vStrip;
            #include <logdepthbuf_pars_fragment>
            void main() {
                #include <logdepthbuf_fragment>
                // A pulse every ${PULSE_SPACING.toFixed(2)} m with a soft tail.
                float phase = fract((vStrip.x - travel) / ${PULSE_SPACING.toFixed(2)});
                float pulse = exp(-phase * 9.0) + exp(-(1.0 - phase) * 40.0);
                float across = texture2D(profile, vec2(0.5, vStrip.y)).r;
                gl_FragColor = vec4(color * across * (0.75 + 0.65 * pulse), 1.0);
                #include <colorspace_fragment>
            }`,
        toneMapped: false,
    });
}

export default function VRCockpitShell() {
    const { nodes, materials } = useCabinModel();
    const lightMaterial = useMemo(() => createLightMaterial(materials.ambientLight.emissiveMap), [materials]);
    useEffect(() => () => lightMaterial.dispose(), [lightMaterial]);
    useEffect(() => addSelfLight(materials.cabin), [materials]);

    useFrame(() => {
        lightMaterial.uniforms.color.value.copy(ambientLight.colour).multiplyScalar(LINE_BRIGHTNESS * ambientLight.level);
        lightMaterial.uniforms.travel.value = ambientLight.travel;
        materials.cabin.emissive.copy(ambientLight.colour).multiplyScalar(GLOW_BRIGHTNESS * ambientLight.level);
    });

    return (
        <group scale={CABIN_SCALE} dispose={null}>
            <mesh geometry={nodes.cabin.geometry} material={materials.cabin} frustumCulled={false} />
            <mesh geometry={nodes.lights.geometry} material={lightMaterial} frustumCulled={false} />
            <mesh geometry={nodes.glass.geometry} material={materials.glass} frustumCulled={false} renderOrder={2} />
        </group>
    );
}
