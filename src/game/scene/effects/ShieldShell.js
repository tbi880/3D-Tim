import * as THREE from 'three';

/**
 * A ship's shield: invisible until something hits it.
 *
 * Each hit lights the shell around the point of impact - brightest there, fading with
 * distance across the surface - shows the shield's honeycomb for a moment and sends a
 * ripple outwards. The rest of the shell stays dark. The last few hits are remembered so
 * sustained fire from several directions lights several patches.
 *
 * The pilot's own shell is also seen from the inside, from the cockpit: `insideMaterial`
 * draws its inner face, dimmer (the patch is close and fills much of the view), and the
 * shell is drawn INSIDE_SCALE times larger there so it stands clear of the cabin.
 */

/** How much larger the pilot's own shell is drawn when seen from the cockpit. */
export const INSIDE_SCALE = 1.8;
/**
 * From there a hit is close and wide in the view, so it is drawn dimmer and tighter, with a
 * finer honeycomb: [brightness, how far the glow spreads (rad²), how far the ripple runs (rad),
 * honeycomb cells round the shell].
 */
const OUTSIDE_LOOK = [1, 0.11, 1.1, 9];
const INSIDE_LOOK = [0.38, 0.022, 0.36, 21];

const MAX_HITS = 6;
const HIT_SECONDS = 1.1;

const VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vDirection;
    varying float vRim;
    void main() {
        vDirection = normalize( position );
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vRim = 1.0 - abs( dot( normalize( normalMatrix * normal ), normalize( vec3( 0.0, 0.0, 1e-5 ) - mvPosition.xyz ) ) );
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float time;
    uniform vec4 look;                  // x: brightness, y: glow spread, z: ripple reach, w: honeycomb cells
    uniform vec4 hits[ ${MAX_HITS} ];   // xyz: where on the shell (unit direction), w: when
    varying vec3 vDirection;
    varying float vRim;

    // Distance to the nearest edge of a hexagonal grid (0 on an edge).
    float hexEdge( vec2 p ) {
        const vec2 s = vec2( 1.0, 1.7320508 );
        vec4 centres = floor( vec4( p, p - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
        vec4 offsets = vec4( p - centres.xy * s, p - ( centres.zw + 0.5 ) * s );
        vec2 cell = abs( dot( offsets.xy, offsets.xy ) < dot( offsets.zw, offsets.zw ) ? offsets.xy : offsets.zw );
        return 0.5 - max( dot( cell, s * 0.5 ), cell.x );
    }

    void main() {
        #include <logdepthbuf_fragment>
        vec3 direction = normalize( vDirection );
        float glow = 0.0;
        float ripple = 0.0;
        for ( int i = 0; i < ${MAX_HITS}; i++ ) {
            float age = ( time - hits[ i ].w ) / ${HIT_SECONDS.toFixed(2)};
            if ( age < 0.0 || age > 1.0 ) continue;
            float angle = acos( clamp( dot( direction, hits[ i ].xyz ), -1.0, 1.0 ) );
            float fade = pow( max( 0.0, 1.0 - age ), 1.6 );
            glow += exp( -angle * angle / look.y ) * fade;
            // Squared by multiplying: pow() of a negative number (everywhere inside the ring)
            // is undefined and gives NaN on many GPUs, which the bloom pass spreads into a black frame.
            float fromRing = ( angle - age * look.z ) / ( 0.045 * look.z );
            ripple += exp( -fromRing * fromRing ) * fade * 0.7;
        }
        if ( glow + ripple < 0.004 ) discard;
        vec2 grid = vec2( atan( direction.z, direction.x ), asin( clamp( direction.y, -1.0, 1.0 ) ) ) * look.w;
        float cells = 1.0 - smoothstep( 0.0, 0.07, hexEdge( grid ) );
        float strength = glow * ( 0.35 + 1.5 * cells + 0.5 * vRim ) + ripple * ( 0.6 + cells );
        gl_FragColor = vec4( tint * strength * 1.6 * look.x, 1.0 );
        // Last line of defence: never hand an invalid colour to the bloom pass.
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

const scratchLocal = new THREE.Vector3();
const scratchInverse = new THREE.Quaternion();

export class ShieldShell {
    /**
     * @param {THREE.ColorRepresentation} color
     * @param {number[]} scale half-size of the shell along the ship's x, y, z (metres)
     */
    constructor(color, scale) {
        this.scale = new THREE.Vector3().fromArray(scale);
        this.cursor = 0;
        this.lastHitAt = -Infinity;
        // Shared by both materials (same hits, same clock); only the look differs.
        const hits = { value: Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 1, 0, -1000)) };
        const time = { value: 0 };
        const tint = { value: new THREE.Color(color) };
        this.uniforms = { tint, time, hits, look: { value: new THREE.Vector4(...OUTSIDE_LOOK) } };
        const options = { vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending };
        this.material = new THREE.ShaderMaterial({ ...options, uniforms: this.uniforms });
        this.insideMaterial = new THREE.ShaderMaterial({ ...options, uniforms: { tint, time, hits, look: { value: new THREE.Vector4(...INSIDE_LOOK) } }, side: THREE.BackSide });
    }

    /**
     * The point on the shell in the direction of `worldPosition` from the ship's centre, with
     * the shell drawn `scale` times its size. Returns `out`.
     */
    surfacePoint(ship, worldPosition, scale, out) {
        out.copy(worldPosition).sub(ship.position).applyQuaternion(scratchInverse.copy(ship.quaternion).invert()).divide(this.scale);
        if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
        return out.normalize().multiply(this.scale).multiplyScalar(scale).applyQuaternion(ship.quaternion).add(ship.position);
    }

    /** Records a hit at a world position on (or near) the shield of `ship`. */
    addHit(ship, worldPosition, time) {
        scratchLocal.copy(worldPosition).sub(ship.position).applyQuaternion(scratchInverse.copy(ship.quaternion).invert()).divide(this.scale);
        if (scratchLocal.lengthSq() < 1e-8) scratchLocal.set(0, 0, -1);
        scratchLocal.normalize();
        this.uniforms.hits.value[this.cursor].set(scratchLocal.x, scratchLocal.y, scratchLocal.z, time);
        this.cursor = (this.cursor + 1) % MAX_HITS;
        this.lastHitAt = time;
    }

    /** Advances the animation; returns whether anything is still glowing (so the mesh can be hidden). */
    update(time) {
        this.uniforms.time.value = time;
        return time - this.lastHitAt < HIT_SECONDS;
    }

    dispose() {
        this.material.dispose();
        this.insideMaterial.dispose();
    }
}

/** Shells by ship, so the hit listener can find the right one. */
export const shieldShells = new WeakMap();
