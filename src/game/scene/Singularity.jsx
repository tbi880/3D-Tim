import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { viewPose } from './viewPose.js';

/**
 * The black hole bearing down on wherever the player is (World `singularity`): a disc of
 * nothing with a thin bright ring round it, a halo of infalling light, and the band of its
 * accretion disc across the front. It is a picture in the sky, not a thing in the world: it
 * keeps its distance from the eye and only grows - `size` 0 it is not there, 1 it has taken
 * the whole sky - so everything near (ships, stations) stays in front of it until the dark
 * has filled the view.
 *
 * One quad, one draw call. Inside the horizon it covers what is behind it; outside it only adds light.
 */

/** Metres from the eye it is drawn at: beyond any battle, in front of the sector's distant bodies. */
const DISTANCE = 100_000;
/** The horizon's radius as seen from the eye, in degrees, at `size` 0 and 1. */
const SMALLEST = 3;
const LARGEST = 78;
/** How many horizon radii the halo reaches (the quad is this many times the horizon across). */
const HALO = 2.3;

const vertexShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vPoint;
    void main() {
        vPoint = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

const fragmentShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float time;
    uniform float power;
    varying vec2 vPoint;

    float hash( vec2 p ) {
        return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }
    float noise( vec2 p ) {
        vec2 cell = floor( p );
        vec2 f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( hash( cell ), hash( cell + vec2( 1.0, 0.0 ) ), f.x ),
                    mix( hash( cell + vec2( 0.0, 1.0 ) ), hash( cell + vec2( 1.0, 1.0 ) ), f.x ), f.y );
    }

    void main() {
        #include <logdepthbuf_fragment>
        // In horizon radii: 1 is the edge of the dark.
        vec2 p = vPoint * ${HALO.toFixed(2)};
        float r = length( p );
        float angle = atan( p.y, p.x );

        // The halo: light on its way in, wound round the hole, brighter on the side turning towards the eye.
        float winding = noise( vec2( angle * 4.0 + 3.0 / r - time * 0.5, r * 5.0 - time * 0.8 ) );
        float streaks = noise( vec2( angle * 14.0 - time * 0.9 + 6.0 / r, r * 2.0 ) );
        float fall = exp( -( r - 1.0 ) * 2.4 ) * step( 1.0, r );
        float lean = 0.75 + 0.25 * cos( angle - 0.6 );
        float halo = fall * ( 0.28 + 0.7 * winding * winding + 0.4 * streaks * streaks ) * lean;
        // The ring of light that goes all the way round, right at the edge.
        float ring = exp( -pow( ( r - 1.035 ) * 34.0, 2.0 ) ) * 1.5;
        // The disc itself, seen nearly edge on: a band across the front of the hole.
        vec2 tilted = vec2( p.x * 0.954 + p.y * 0.3, -p.x * 0.3 + p.y * 0.954 );
        float thickness = 0.022 + 0.05 * abs( tilted.x );
        float band = exp( -pow( tilted.y / thickness, 2.0 ) ) * smoothstep( 2.1, 1.1, abs( tilted.x ) )
            * ( 0.7 + 0.6 * noise( vec2( tilted.x * 9.0 - time * 1.6, 1.0 ) ) );

        // Nothing reaches the eye from inside; outside, the sky shows through under the light.
        float dark = 1.0 - smoothstep( 0.985, 1.0, r );
        float rim = smoothstep( 1.0, 0.82, length( vPoint ) );
        vec3 hot = vec3( 1.0, 0.86, 0.66 );
        vec3 cool = vec3( 0.55, 0.3, 1.0 );
        // Kept near 1: much brighter and the bloom washes the dark out of the hole.
        vec3 light = mix( hot, cool, smoothstep( 1.0, 1.9, r ) ) * halo + hot * ( ring + band * 1.1 );
        gl_FragColor = vec4( light * rim * power, dark );
    }
`;

/** @param {{ session: import('../state/GameSession.js').GameSession }} props */
export default function Singularity({ session }) {
    const meshRef = useRef(null);
    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, power: { value: 1 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        // Colour is added; whatever is behind is kept only as far as alpha lets it through.
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
        toneMapped: false,
    }), []);
    useEffect(() => () => material.dispose(), [material]);

    useFrame(({ clock }) => {
        const mesh = meshRef.current;
        const { size, direction } = session.world.singularity;
        mesh.visible = size > 0;
        if (!mesh.visible) return;
        const horizon = THREE.MathUtils.degToRad(SMALLEST + (LARGEST - SMALLEST) * Math.min(1, size));
        mesh.position.copy(viewPose.position).addScaledVector(direction, DISTANCE);
        mesh.quaternion.copy(viewPose.quaternion);
        mesh.lookAt(viewPose.position);
        mesh.scale.setScalar(DISTANCE * Math.tan(horizon) * HALO);
        material.uniforms.time.value = clock.elapsedTime;
        // It comes up out of the sky rather than switching on.
        material.uniforms.power.value = Math.min(1, size * 12);
    });

    // Before anything else that is see-through (it is behind all of it), after the sky.
    return (
        <mesh ref={meshRef} material={material} visible={false} frustumCulled={false} renderOrder={-1}>
            <planeGeometry args={[2, 2]} />
        </mesh>
    );
}
