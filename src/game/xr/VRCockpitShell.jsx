import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { bucketURL } from '../../Settings';
import { useGameStore } from '../state/gameStore.js';
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
 *    displays). u runs along each strip in metres, for the pulses that travel along them.
 *  - `glass`: the tinted glass roof.
 * Faces the pilot's head can never see were removed in Blender.
 *
 * The ambient light follows the ship:
 *  - its colour is the power mode's - blue balanced, cyan defense, red attack;
 *  - on the afterburner the pulses along the strips run faster;
 *  - with the hull critical the whole cabin throbs red.
 */

/**
 * The whole cabin (seat included) is drawn this much larger round the pilot's eye, so it
 * sits further away in the headset. VRHud scales the instrument display the same way.
 */
export const CABIN_SCALE = layout.cabinScale;

/** Same arguments as GltfModel (Draco + Meshopt decoders), so the file is fetched once. */
const MODEL_FILE = 'game/vr-cockpit-transformed.glb';
const useCabinModel = () => useGLTF(bucketURL + MODEL_FILE, true, true);
/** Starts downloading the cabin (when the browser can do VR) so it is there on entering VR. */
export const preloadVRCockpit = () => useGLTF.preload(bucketURL + MODEL_FILE, true, true);

/** Ambient-light colours per power mode. */
const AMBIENT_COLOURS = Object.freeze({
    balanced: new THREE.Color('#3f7bff'),
    defense: new THREE.Color('#25d6d0'),
    attack: new THREE.Color('#ff3346'),
});
const ALARM_COLOUR = new THREE.Color('#ff2a2a');
/** Below this hull fraction the cabin throbs red, this many times a second. */
const ALARM_HULL = 0.3;
const ALARM_RATE = 1.4;
/** Brightness of the light strips (they are not tone mapped, so 1 = full colour). */
const LINE_BRIGHTNESS = 0.9;
/** Brightness of the glow the strips cast on the cabin (the baked emissive map). */
const GLOW_BRIGHTNESS = 1.6;
/**
 * A faint light of its own on every surface, in the surface's own colour: a headset shows
 * near-black as black, and the sectors' ambient light is deliberately small.
 */
const SELF_LIGHT = 0.7;
/** How fast the colour follows a mode change (1/s). */
const COLOUR_FOLLOW = 3.5;
/** Travelling pulses along the light strips: metres apart, metres per second. */
const PULSE_SPACING = 2.6;
const PULSE_SPEED = 0.9;
const BOOST_PULSE_SPEED = 3.2;

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
    // The self light is a light map of one white texel: light that needs no light in the scene.
    useEffect(() => {
        const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        white.needsUpdate = true;
        materials.cabin.lightMap = white;
        materials.cabin.lightMapIntensity = SELF_LIGHT;
        materials.cabin.needsUpdate = true;
        return () => {
            materials.cabin.lightMap = null;
            materials.cabin.needsUpdate = true;
            white.dispose();
        };
    }, [materials]);
    const ambient = useRef({ colour: AMBIENT_COLOURS.balanced.clone(), shown: new THREE.Color(), time: 0 });

    useFrame((_, delta) => {
        const hud = useGameStore.getState().hud;
        const state = ambient.current;
        state.time += delta;
        state.colour.lerp(AMBIENT_COLOURS[hud?.powerMode] ?? AMBIENT_COLOURS.balanced, 1 - Math.exp(-COLOUR_FOLLOW * delta));
        state.shown.copy(state.colour);
        if (hud?.alive && hud.hull < ALARM_HULL) {
            state.shown.lerp(ALARM_COLOUR, 0.5 - 0.5 * Math.cos(state.time * ALARM_RATE * Math.PI * 2));
        }
        lightMaterial.uniforms.color.value.copy(state.shown).multiplyScalar(LINE_BRIGHTNESS);
        // Kept within one spacing: the pattern repeats there, and small numbers stay exact on the GPU.
        lightMaterial.uniforms.travel.value = (lightMaterial.uniforms.travel.value + delta * (hud?.boosting ? BOOST_PULSE_SPEED : PULSE_SPEED)) % PULSE_SPACING;
        materials.cabin.emissive.copy(state.shown).multiplyScalar(GLOW_BRIGHTNESS);
    });

    return (
        <group scale={CABIN_SCALE} dispose={null}>
            <mesh geometry={nodes.cabin.geometry} material={materials.cabin} frustumCulled={false} />
            <mesh geometry={nodes.lights.geometry} material={lightMaterial} frustumCulled={false} />
            <mesh geometry={nodes.glass.geometry} material={materials.glass} frustumCulled={false} renderOrder={2} />
        </group>
    );
}
