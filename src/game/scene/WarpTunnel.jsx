import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const TUNNEL_RADIUS = 45;
const TUNNEL_LENGTH = 1400;
const HALF_PI = Math.PI / 2;

const VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
    }
`;

/** Lanes of light racing towards the viewer along the inside of a tube. */
const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform float time;
    uniform float strength;
    varying vec2 vUv;

    float hash(float n) {
        return fract(sin(n * 127.1) * 43758.5453);
    }
    void main() {
        #include <logdepthbuf_fragment>
        float lanes = 110.0;
        float lane = floor(vUv.x * lanes);
        float seed = hash(lane);
        float travel = fract(vUv.y * (1.2 + seed * 2.5) - time * (1.6 + seed * 3.5) + seed * 9.0);
        float streak = smoothstep(0.0, 0.06, travel) * (1.0 - smoothstep(0.08, 0.6, travel));
        float laneShape = 1.0 - smoothstep(0.15, 0.5, abs(fract(vUv.x * lanes) - 0.5));
        float lit = step(0.45, seed);
        float ends = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        float glow = streak * laneShape * lit * ends * strength;
        vec3 color = mix(vec3(0.2, 0.5, 1.0), vec3(0.92, 0.98, 1.0), seed * streak);
        // A faint blue wash fills the gaps so the tunnel reads as a wall, not as lines.
        vec3 wash = vec3(0.08, 0.22, 0.6) * ends * strength * strength * 0.35;
        gl_FragColor = vec4(color * glow * 2.4 + wash, 1.0);
    }
`;

/**
 * The warp tunnel: a tube of rushing light around the camera, faded in by `world.warpFactor`.
 * Rendered as a child of the camera, so it always surrounds the view.
 */
export default function WarpTunnel({ session }) {
    const meshRef = useRef(null);
    const geometry = useMemo(
        () => new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS * 0.25, TUNNEL_LENGTH, 48, 1, true).rotateX(-HALF_PI),
        [],
    );
    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: { time: { value: 0 }, strength: { value: 0 } },
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
    }), []);
    const clock = useRef(0);

    useFrame(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        const warp = session.world.warpFactor;
        mesh.visible = warp > 0.01;
        if (!mesh.visible) return;
        clock.current += session.effectsDelta;
        mesh.material.uniforms.time.value = clock.current;
        mesh.material.uniforms.strength.value = warp;
    });

    return <mesh ref={meshRef} geometry={geometry} material={material} position={[0, 0, -TUNNEL_LENGTH / 2 + 40]} visible={false} frustumCulled={false} />;
}
