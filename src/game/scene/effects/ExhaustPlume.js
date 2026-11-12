import * as THREE from 'three';

/**
 * Engine exhaust.
 *
 * A plume is a tapering tube of glowing gas behind a nozzle. The shader makes the tube look
 * like a volume rather than a surface: it is brightest where you look through the most gas
 * (the middle) and fades to nothing at its outline; it runs white-hot at the nozzle and
 * cools to the faction's colour; standing shock diamonds ripple down its length; and it
 * flickers. Length and brightness follow the ship's thrust.
 *
 * All the plumes of one ship are a single mesh (one draw call), built from the engine list
 * in the model manifest.
 */

const RADIAL_SEGMENTS = 14;
const AXIAL_SEGMENTS = 12;
const CAP_RINGS = 3;

const VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform float thrust;
    attribute vec3 plumeOrigin;   // the nozzle this vertex belongs to
    attribute vec4 plumeShape;    // cos, sin around the axis; distance along it (0..1); 1 on the nozzle disc
    attribute float plumeRadius;
    varying float vAxial;
    varying float vFacing;
    varying float vPhase;
    varying float vDisc;
    void main() {
        float along = plumeShape.z;
        float onDisc = plumeShape.w;
        float reach = plumeRadius * ( 2.4 + thrust * 9.5 );
        // Leaves the nozzle at its width, swells a little, then tapers to a point.
        float width = plumeRadius * 0.8 * ( 1.0 - pow( along, 1.7 ) ) * ( 1.0 + 0.22 * sin( along * 3.14159 ) );
        vec3 local = plumeOrigin + vec3( plumeShape.xy * width, along * reach );
        vec4 mvPosition = modelViewMatrix * vec4( local, 1.0 );
        vec3 outward = mix( vec3( plumeShape.xy, 0.12 ), vec3( 0.0, 0.0, 1.0 ), onDisc );
        // (The tiny offset keeps normalize() defined if the camera sits exactly on a vertex.)
        vFacing = abs( dot( normalize( normalMatrix * outward ), normalize( vec3( 0.0, 0.0, 1e-5 ) - mvPosition.xyz ) ) );
        vAxial = along;
        vDisc = onDisc * length( plumeShape.xy );
        vPhase = plumeOrigin.x * 0.37 + plumeOrigin.y * 0.11;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float thrust;
    uniform float time;
    varying float vAxial;
    varying float vFacing;
    varying float vPhase;
    varying float vDisc;
    void main() {
        #include <logdepthbuf_fragment>
        // Interpolated values can land a hair outside 0..1 (most often right at the plume's
        // tip). pow() of a negative number is undefined and on many GPUs yields NaN, and a
        // single NaN pixel is smeared over the whole screen by the bloom pass - a black frame.
        // So every base is clamped before it is raised to a power.
        float axial = clamp( vAxial, 0.0, 1.0 );
        float depth = pow( clamp( vFacing, 0.0, 1.0 ), 2.2 );   // how much gas this ray passes through
        float fall = pow( 1.0 - axial, 1.5 );
        float diamonds = pow( max( 0.0, sin( axial * 27.0 - time * 9.0 + vPhase ) ), 6.0 ) * exp( -axial * 4.0 ) * ( 0.35 + thrust );
        float flicker = 0.86 + 0.14 * sin( time * 47.0 + vPhase * 9.0 + axial * 31.0 );
        vec3 colour = mix( vec3( 1.0 ), tint, smoothstep( 0.0, 0.5, axial + ( 1.0 - depth ) * 0.55 ) );
        float strength = ( depth * fall * ( 1.5 + thrust * 2.4 ) + diamonds * 1.6 ) * flicker;
        // Seen from behind, the nozzle itself is a bright disc.
        strength *= max( 0.0, 1.0 - vDisc * vDisc );
        gl_FragColor = vec4( colour * strength, 1.0 );
        // Last line of defence: never hand an invalid colour to the bloom pass.
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

/** One merged tube-and-disc mesh for every engine in `engines` ([x, y, z, radius] each). */
function createPlumeGeometry(engines) {
    const origin = [];
    const shape = [];
    const radius = [];
    const indices = [];
    const push = (engine, cos, sin, along, disc) => {
        origin.push(engine[0], engine[1], engine[2]);
        shape.push(cos, sin, along, disc);
        radius.push(engine[3]);
        return origin.length / 3 - 1;
    };
    for (const engine of engines) {
        // The tube.
        const rings = [];
        for (let a = 0; a <= AXIAL_SEGMENTS; a++) {
            const ring = [];
            for (let r = 0; r < RADIAL_SEGMENTS; r++) {
                const angle = (r / RADIAL_SEGMENTS) * Math.PI * 2;
                ring.push(push(engine, Math.cos(angle), Math.sin(angle), a / AXIAL_SEGMENTS, 0));
            }
            rings.push(ring);
        }
        for (let a = 0; a < AXIAL_SEGMENTS; a++) {
            for (let r = 0; r < RADIAL_SEGMENTS; r++) {
                const next = (r + 1) % RADIAL_SEGMENTS;
                indices.push(rings[a][r], rings[a][next], rings[a + 1][next], rings[a][r], rings[a + 1][next], rings[a + 1][r]);
            }
        }
        // The disc across the nozzle.
        const centre = push(engine, 0, 0, 0, 1);
        let inner = null;
        for (let ringIndex = 1; ringIndex <= CAP_RINGS; ringIndex++) {
            const fraction = ringIndex / CAP_RINGS;
            const ring = [];
            for (let r = 0; r < RADIAL_SEGMENTS; r++) {
                const angle = (r / RADIAL_SEGMENTS) * Math.PI * 2;
                ring.push(push(engine, Math.cos(angle) * fraction, Math.sin(angle) * fraction, 0, 1));
            }
            for (let r = 0; r < RADIAL_SEGMENTS; r++) {
                const next = (r + 1) % RADIAL_SEGMENTS;
                if (inner) indices.push(inner[r], inner[next], ring[next], inner[r], ring[next], ring[r]);
                else indices.push(centre, ring[r], ring[next]);
            }
            inner = ring;
        }
    }
    const geometry = new THREE.BufferGeometry();
    // The shader builds the real positions; `position` only has to exist.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(origin, 3));
    geometry.setAttribute('plumeOrigin', new THREE.Float32BufferAttribute(origin, 3));
    geometry.setAttribute('plumeShape', new THREE.Float32BufferAttribute(shape, 4));
    geometry.setAttribute('plumeRadius', new THREE.Float32BufferAttribute(radius, 1));
    geometry.setIndex(indices);
    return geometry;
}

export class ExhaustPlume {
    /**
     * @param {number[][]} engines [x, y, z, radius] per nozzle, in the ship's own axes
     * @param {THREE.ColorRepresentation} color the cool end of the flame
     */
    constructor(engines, color) {
        this.uniforms = { tint: { value: new THREE.Color(color) }, thrust: { value: 0.2 }, time: { value: 0 } };
        this.geometry = createPlumeGeometry(engines);
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        // Vertices are placed by the shader, so three.js cannot know the true bounds.
        this.mesh.frustumCulled = false;
    }

    /** `thrust`: 0 (idling) .. 1 (flat out), eased so the flame does not snap. */
    update(thrust, time, dt) {
        const current = this.uniforms.thrust.value;
        this.uniforms.thrust.value = current + (thrust - current) * Math.min(1, dt * 3);
        this.uniforms.time.value = time;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
