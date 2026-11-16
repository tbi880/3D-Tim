import * as THREE from 'three';

/**
 * Everything made of light that is long and thin, in one draw call: beams, the flares at
 * their ends, energy bolts and the shards a shield breaks them into.
 *
 * Each is one instanced quad that turns to face the eye round its own axis (worked out in
 * view space, so it is right for each eye in VR), shaded as light rather than as a solid:
 *  - a beam is a white-hot core in a soft halo of its colour, with energy running along it;
 *  - a bolt is a tracer: brightest at its head, thinning and fading to its tail;
 *  - a flare is a soft burst with a thin streak across it, where a beam leaves or lands;
 *    a glow is the same burst without the streak (the light at a bolt's head).
 * Nothing has a hard edge, and nothing gets thinner than about two pixels, so distant fire
 * stays visible instead of flickering in and out between pixels.
 *
 * Refilled every frame: begin(), then beam() / bolt() / flare(), then finish().
 * The shaders include three.js's logdepthbuf chunks because the game renders with a
 * logarithmic depth buffer.
 */

const SHAPE = Object.freeze({ beam: 0, flare: 1, bolt: 2, glow: 3 });
/** Narrowest a ribbon is drawn, as a fraction of its distance (about two pixels). */
const MIN_ANGULAR_WIDTH = 0.0011;

const VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 ribbonStart;
    attribute vec3 ribbonEnd;
    attribute vec3 ribbonColor;
    attribute vec4 ribbonShape;   // x: half-width (m), y: shape, z: core brightness, w: seed
    varying vec2 vPlace;          // x: -1..1 across, y: 0..1 along (tail to head)
    varying vec3 vColor;
    varying vec4 vShape;
    varying float vLength;
    void main() {
        vec3 start = ( modelViewMatrix * vec4( ribbonStart, 1.0 ) ).xyz;
        vec3 end = ( modelViewMatrix * vec4( ribbonEnd, 1.0 ) ).xyz;
        vec3 axis = end - start;
        float span = length( axis );
        float halfWidth = ribbonShape.x;
        vec3 viewPosition;
        if ( ( ribbonShape.y > 0.5 && ribbonShape.y < 1.5 ) || ribbonShape.y > 2.5 ) {
            // A flare or a glow: a square facing the eye.
            viewPosition = start + vec3( position.x, position.y * 2.0 - 1.0, 0.0 ) * halfWidth;
        } else {
            vec3 centre = start + axis * position.y;
            // Across both the ribbon and the line of sight to it.
            vec3 side = cross( axis / max( span, 1e-4 ), centre );
            float sideLength = length( side );
            side = sideLength > 1e-5 ? side / sideLength : vec3( 1.0, 0.0, 0.0 );
            halfWidth = max( halfWidth, -centre.z * ${MIN_ANGULAR_WIDTH} );
            viewPosition = centre + side * position.x * halfWidth;
        }
        vPlace = position.xy;
        vColor = ribbonColor;
        vShape = ribbonShape;
        vLength = span;
        gl_Position = projectionMatrix * vec4( viewPosition, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform float time;
    varying vec2 vPlace;
    varying vec3 vColor;
    varying vec4 vShape;
    varying float vLength;
    void main() {
        #include <logdepthbuf_fragment>
        float across = abs( vPlace.x );
        float seed = vShape.w;
        vec3 light;
        if ( vShape.y < 0.5 ) {
            // Beam: energy runs along it (two waves that drift through each other) and it
            // softens over its first and last metres instead of ending in a cut.
            float metres = vPlace.y * vLength;
            float flow = 0.74 + 0.26 * sin( metres * 0.19 - time * 52.0 + seed ) * sin( metres * 0.047 + time * 21.0 + seed * 1.7 );
            float ends = smoothstep( 0.0, 3.0, metres ) * smoothstep( 0.0, 3.0, vLength - metres );
            float halo = exp( -across * across * 5.0 );
            float core = exp( -across * across * 70.0 );
            light = ( vColor * halo * flow + vec3( core * vShape.z ) ) * ends;
        } else if ( vShape.y < 1.5 || vShape.y > 2.5 ) {
            // Flare: a soft burst, a hot centre, and (not on a glow) a thin streak across it.
            vec2 q = vec2( vPlace.x, vPlace.y * 2.0 - 1.0 );
            float r = length( q );
            float burst = pow( max( 0.0, 1.0 - r ), 2.4 );
            float centre = pow( max( 0.0, 1.0 - r * 3.2 ), 2.0 );
            float streak = vShape.y < 1.5 ? exp( -q.y * q.y * 700.0 ) * pow( max( 0.0, 1.0 - abs( q.x ) ), 2.0 ) : 0.0;
            float flicker = 0.85 + 0.15 * sin( time * 61.0 + seed * 9.0 );
            light = ( vColor * ( burst + streak * 0.7 ) + vec3( centre * vShape.z ) ) * flicker;
        } else {
            // Bolt: a tracer. The head is round and white-hot; the body narrows and fades to the tail.
            float along = vPlace.y;
            float body = across / mix( 0.3, 1.0, along );
            float head = smoothstep( 1.0, 0.9, along );
            float halo = exp( -body * body * 5.0 ) * pow( along, 1.3 ) * head;
            float core = exp( -body * body * 50.0 ) * pow( along, 2.6 ) * head;
            light = vColor * halo + vec3( core * vShape.z );
        }
        gl_FragColor = vec4( light, 1.0 );
    }
`;

export class EnergyRibbons {
    constructor(capacity) {
        this.capacity = capacity;
        this.count = 0;
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.attributes = {
            ribbonStart: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
            ribbonEnd: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
            ribbonColor: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
            ribbonShape: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
        };
        for (const [name, attribute] of Object.entries(this.attributes)) {
            attribute.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute(name, attribute);
        }
        geometry.instanceCount = 0;
        this.geometry = geometry;
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: { time: { value: 0 } },
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.frustumCulled = false;
    }

    begin() {
        this.count = 0;
    }

    add(start, end, color, brightness, halfWidth, shape, core, seed) {
        if (this.count >= this.capacity) return;
        const i = this.count++;
        const { ribbonStart, ribbonEnd, ribbonColor, ribbonShape } = this.attributes;
        ribbonStart.setXYZ(i, start.x, start.y, start.z);
        ribbonEnd.setXYZ(i, end.x, end.y, end.z);
        ribbonColor.setXYZ(i, color.r * brightness, color.g * brightness, color.b * brightness);
        ribbonShape.setXYZW(i, halfWidth, shape, core, seed);
    }

    /** A beam from `start` to `end`: `halfWidth` is how far its halo reaches from its axis (m). */
    beam(start, end, color, brightness, halfWidth, core, seed = 0) {
        this.add(start, end, color, brightness, halfWidth, SHAPE.beam, core, seed);
    }

    /** A bolt whose head is at `head`, trailing back to `tail`. */
    bolt(tail, head, color, brightness, halfWidth, core, seed = 0) {
        this.add(tail, head, color, brightness, halfWidth, SHAPE.bolt, core, seed);
    }

    /** A burst of light `radius` metres across at `position`. */
    flare(position, color, brightness, radius, core, seed = 0) {
        this.add(position, position, color, brightness, radius, SHAPE.flare, core, seed);
    }

    /** The same burst without the streak. */
    glow(position, color, brightness, radius, core, seed = 0) {
        this.add(position, position, color, brightness, radius, SHAPE.glow, core, seed);
    }

    /** Hands this frame's ribbons to the GPU. `time` (seconds) drives the flow and the flicker. */
    finish(time) {
        this.geometry.instanceCount = this.count;
        for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
        // Kept small: the shader's waves only need it modulo their periods, and it stays exact.
        this.material.uniforms.time.value = time % 1000;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
