import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { bucketURL } from '../../Settings';
import { GLOW_BRIGHTNESS, LINE_BRIGHTNESS, PULSE_SPACING, addSelfLight, ambientLight } from './cabinLighting.js';
import layout from './cockpitLayout.json';
import { HEADSET_SPARK_EMITTERS, SCREEN_SPARK_EMITTERS } from './sparkEmitters.js';

/**
 * The cabin the pilot sits in, in every first-person view: on a screen and in a headset.
 * Modelled in Blender (tools/game-models/vr-cockpit) and web-optimised with
 * `npx gltfjsx --transform`. It was built for VR first, so its file and tool folder still
 * say "vr" (the file is in the asset bucket under that name).
 *
 * It sits in the cockpit's frame (eye at the origin, -z ahead, metres); Cockpit.jsx hangs it
 * off the camera. The file holds three meshes, so the whole cabin is three draw calls and
 * no light:
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
 * The ambient light follows the ship, and stutters when the hull is hit (cabinLighting.js;
 * Cockpit.jsx keeps it up to date).
 */

/**
 * The whole cabin (seat included) is drawn this much larger round the pilot's eye, so it
 * sits further away. VRHud scales the instrument display the same way.
 */
export const CABIN_SCALE = layout.cabinScale;

/** [x, y, z, dx, dy, dz] in the model's metres -> the same in the cabin as drawn. */
const scaledEmitters = (emitters) => emitters.map(([x, y, z, ...direction]) => [x * CABIN_SCALE, y * CABIN_SCALE, z * CABIN_SCALE, ...direction]);

/**
 * Where sparks can burst from when the hull is hit, in the cabin as drawn (CockpitSparks.jsx;
 * the places are in sparkEmitters.js): all round the pilot in a headset, along the dashboard
 * on a screen.
 */
export const SPARK_EMITTERS = Object.freeze({
    headset: scaledEmitters(HEADSET_SPARK_EMITTERS),
    screen: scaledEmitters(SCREEN_SPARK_EMITTERS),
});

/** Loaded with the same arguments as GltfModel (Draco + Meshopt decoders), so the file is fetched once. */
export const CABIN_FILE = 'game/vr-cockpit-transformed.glb';
const useCabinModel = () => useGLTF(bucketURL + CABIN_FILE, true, true);
/** Starts downloading the cabin without waiting for it. */
export const preloadCockpitCabin = () => useGLTF.preload(bucketURL + CABIN_FILE, true, true);

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

export default function CockpitCabin() {
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
