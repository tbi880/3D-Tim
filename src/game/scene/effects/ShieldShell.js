import * as THREE from 'three';

/**
 * A ship's shield: invisible until something hits it.
 *
 * Each hit lights the shell around the point of impact - brightest there, fading with
 * distance across the surface - shows the shield's honeycomb for a moment and sends a
 * ripple outwards. The rest of the shell stays dark. The last few hits are remembered so
 * sustained fire from several directions lights several patches.
 */

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
        vRim = 1.0 - abs( dot( normalize( normalMatrix * normal ), normalize( -mvPosition.xyz ) ) );
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float time;
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
            float fade = pow( 1.0 - age, 1.6 );
            glow += exp( -angle * angle / 0.11 ) * fade;
            ripple += exp( -pow( ( angle - age * 1.1 ) / 0.05, 2.0 ) ) * fade * 0.7;
        }
        if ( glow + ripple < 0.004 ) discard;
        vec2 grid = vec2( atan( direction.z, direction.x ), asin( clamp( direction.y, -1.0, 1.0 ) ) ) * 9.0;
        float cells = 1.0 - smoothstep( 0.0, 0.07, hexEdge( grid ) );
        float strength = glow * ( 0.35 + 1.5 * cells + 0.5 * vRim ) + ripple * ( 0.6 + cells );
        gl_FragColor = vec4( tint * strength * 1.6, 1.0 );
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
        this.uniforms = {
            tint: { value: new THREE.Color(color) },
            time: { value: 0 },
            hits: { value: Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 1, 0, -1000)) },
        };
        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
        });
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
    }
}

/** Shells by ship, so the hit listener can find the right one. */
export const shieldShells = new WeakMap();
