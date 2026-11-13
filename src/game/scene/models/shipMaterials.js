import * as THREE from 'three';
import { createGuideLightMaterial } from './guideLightMaterial.js';

/**
 * The materials every generated ship shares.
 *
 * A generated model (tools/game-models) is one mesh with two material slots, named "hull"
 * and "glow". Its own materials are only placeholders: the game swaps in the ones built
 * here, so all ships of all factions draw with the same few shader programs and textures.
 *
 *   hull - physically based, textured with the tiling plating maps. The mesh's vertex
 *          colours carry the faction paint and baked ambient occlusion (RGB) and where
 *          lit windows should show (alpha: 1 = none, 0 = windows).
 *   glow - engines and light strips: unlit, and brighter than white so they bloom.
 *
 * Downloaded models keep their own materials, except for "guideLight" (Lantern Station's
 * undock and dock beacons, guideLightMaterial.js).
 */

/** Files under the asset bucket (made by tools/game-models/make_textures.py). */
export const HULL_TEXTURE_FILES = Object.freeze({
    albedo: 'game/textures/hull_albedo.webp',
    normal: 'game/textures/hull_normal.webp',
    orm: 'game/textures/hull_orm.webp',
    emissive: 'game/textures/hull_emissive.webp',
});

export const ROCK_TEXTURE_FILES = Object.freeze({
    albedo: 'game/textures/rock_albedo.webp',
    normal: 'game/textures/rock_normal.webp',
});

/** How many times finer the second, close-range layer of plating is than the first. */
const FINE_DETAIL_REPEAT = '6.0';
const GLOW_BRIGHTNESS = 3.2;
const WINDOW_BRIGHTNESS = 2.6;

/** Tiling, colour space and filtering for a set of surface textures (albedo / emissive are colour, the rest data). */
export function configureSurfaceTextures(textures, anisotropy = 4) {
    for (const [name, texture] of Object.entries(textures)) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = anisotropy;
        texture.colorSpace = name === 'albedo' || name === 'emissive' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.needsUpdate = true;
    }
    return textures;
}

/**
 * Adds two things the stock material cannot do:
 *  - a second, finer sampling of the plating maps, so a hull still shows detail when the
 *    camera is skimming it and the large plates have become blurry;
 *  - windows that light up only where the vertex colour's alpha says so.
 */
function patchHullShader(shader) {
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `
            #include <map_fragment>
            #ifdef USE_MAP
                diffuseColor.rgb *= mix( 1.0, texture2D( map, vMapUv * ${FINE_DETAIL_REPEAT} ).r / 0.88, 0.55 );
            #endif
        `)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
            'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
            `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
             vec3 fineN = texture2D( normalMap, vNormalMapUv * ${FINE_DETAIL_REPEAT} ).xyz * 2.0 - 1.0;
             mapN = normalize( vec3( mapN.xy + fineN.xy * 0.55, mapN.z ) );`,
        ))
        .replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            #ifdef USE_COLOR_ALPHA
                totalEmissiveRadiance *= 1.0 - vColor.a;
            #else
                totalEmissiveRadiance *= 0.0;
            #endif
        `);
}

/**
 * Unlit emitter surface. It is brightest where it faces the camera and falls off towards
 * its silhouette, which is what makes a glowing sphere read as a ball of plasma instead of
 * a flat disc, and an engine throat look deep.
 */
function createGlowMaterial() {
    return new THREE.ShaderMaterial({
        vertexColors: true,
        toneMapped: false,
        uniforms: { brightness: { value: GLOW_BRIGHTNESS } },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec3 vGlow;
            varying vec3 vViewNormal;
            varying vec3 vViewPosition;
            void main() {
                vGlow = color.rgb;
                vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
                vViewNormal = normalize( normalMatrix * normal );
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
                #include <logdepthbuf_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            uniform float brightness;
            varying vec3 vGlow;
            varying vec3 vViewNormal;
            varying vec3 vViewPosition;
            void main() {
                #include <logdepthbuf_fragment>
                // Clamped, with a nudge on the normal: pow() of a negative or normalize() of a
                // zero vector would give NaN, which the bloom pass turns into a black frame.
                float facing = clamp( abs( dot( normalize( vViewNormal + vec3( 0.0, 0.0, 1e-5 ) ), normalize( vViewPosition + vec3( 0.0, 0.0, 1e-5 ) ) ) ), 0.0, 1.0 );
                float core = 0.3 + 0.7 * pow( facing, 1.6 );
                // The very centre burns towards white.
                vec3 colour = mix( vGlow, vec3( 1.0 ), pow( facing, 6.0 ) * 0.35 ) * core * brightness;
                gl_FragColor = vec4( colour, 1.0 );
            }
        `,
    });
}

/**
 * Builds the material set for one set of loaded textures.
 * @returns {{ resolve(original: THREE.Material): THREE.Material, setLightTime(seconds: number): void, dispose(): void }}
 */
export function createShipMaterials(textures) {
    const hullVariants = new Map();
    const glow = createGlowMaterial();
    const guideLights = createGuideLightMaterial();

    /** Factions differ only in finish (how metallic / rough), so variants are keyed by that. */
    const hull = (metalness, roughness) => {
        const key = `${metalness.toFixed(2)}|${roughness.toFixed(2)}`;
        if (!hullVariants.has(key)) {
            const material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                map: textures.albedo,
                normalMap: textures.normal,
                normalScale: new THREE.Vector2(1.15, 1.15),
                roughnessMap: textures.orm,
                metalnessMap: textures.orm,
                aoMap: textures.orm,
                aoMapIntensity: 1,
                emissiveMap: textures.emissive,
                emissive: new THREE.Color(1, 1, 1),
                emissiveIntensity: WINDOW_BRIGHTNESS,
                metalness,
                roughness,
                envMapIntensity: 1,
            });
            material.onBeforeCompile = patchHullShader;
            // One program for every variant: only uniforms differ between them.
            material.customProgramCacheKey = () => 'eod-hull';
            hullVariants.set(key, material);
        }
        return hullVariants.get(key);
    };

    return {
        /** The game material to use in place of a model's own (by the generator's naming convention). */
        resolve(original) {
            if (original.name === 'glow') return glow;
            if (original.name === 'guideLight') return guideLights;
            if (original.name === 'hull') return hull(original.metalness ?? 0.75, original.roughness ?? 1);
            return original;
        },
        /** Advances the station guide lights' blinking (seconds); see guideLightMaterial.js. */
        setLightTime(seconds) {
            guideLights.uniforms.time.value = seconds;
        },
        dispose() {
            glow.dispose();
            guideLights.dispose();
            for (const material of hullVariants.values()) material.dispose();
        },
    };
}
