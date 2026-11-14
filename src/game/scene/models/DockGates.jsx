import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Hangar doors on a station's dock mouths: a dark opening covered by a shimmering force field.
 *
 * They are what a docking ship flies into. The door is opaque (it writes depth), so a ship
 * passing through it disappears into the hangar instead of clipping into the hull behind,
 * and the field's light says which way the door is meant for (the lane's colour).
 *
 * `gates` (model coordinates, metres): [{ centre: [x, y, z], size: [width, height], color }],
 * each door facing -Z, out along the lanes. All doors are one mesh and one draw call; the
 * shimmer is worked out in the shader from the time.
 */

const vertexShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 gateColor;
    varying vec2 vUv;
    varying vec3 vColor;
    void main() {
        vUv = uv;
        vColor = gateColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

const fragmentShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float time;
    varying vec2 vUv;
    varying vec3 vColor;
    void main() {
        #include <logdepthbuf_fragment>
        // Distance to the nearest edge (0 at the frame, 0.5 in the middle).
        float edge = min( min( vUv.x, 1.0 - vUv.x ), min( vUv.y, 1.0 - vUv.y ) );
        float rim = 1.0 - smoothstep( 0.0, 0.06, edge );
        // Slow bands rolling up the field, plus a faint fine grain.
        float bands = 0.5 + 0.5 * sin( vUv.y * 18.0 - time * 2.2 );
        float grain = 0.5 + 0.5 * sin( vUv.x * 90.0 + time * 0.7 ) * sin( vUv.y * 60.0 - time * 1.3 );
        float field = 0.12 + 0.18 * pow( bands, 3.0 ) + 0.05 * grain;
        // Deep hangar black, lit by the field and a bright rim.
        vec3 colour = vec3( 0.006, 0.008, 0.012 ) + vColor * ( field + rim * 2.4 );
        gl_FragColor = vec4( colour, 1.0 );
    }
`;

function buildGeometry(gates) {
    const positions = [];
    const uvs = [];
    const colours = [];
    const indices = [];
    const colour = new THREE.Color();
    gates.forEach(({ centre: [x, y, z], size: [width, height], color }, gate) => {
        colour.set(color);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [sx, sy] of corners) {
            positions.push(x + (sx * width) / 2, y + (sy * height) / 2, z);
            uvs.push((sx + 1) / 2, (sy + 1) / 2);
            colours.push(colour.r, colour.g, colour.b);
        }
        // Facing -Z (out along the lane).
        const base = gate * 4;
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('gateColor', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

export default function DockGates({ gates }) {
    const geometry = useMemo(() => buildGeometry(gates), [gates]);
    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader,
        fragmentShader,
        toneMapped: false,
    }), []);

    useEffect(() => () => {
        geometry.dispose();
        material.dispose();
    }, [geometry, material]);

    useFrame(({ clock }) => {
        material.uniforms.time.value = clock.elapsedTime;
    });

    return <mesh geometry={geometry} material={material} />;
}
