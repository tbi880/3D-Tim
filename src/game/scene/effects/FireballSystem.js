import * as THREE from 'three';

/**
 * Fire and smoke.
 *
 * An explosion is a cluster of "puffs". Each puff is a square that always faces the camera,
 * and the shader paints a boiling ball on it: white-hot at first, cooling through orange to
 * red, then turning into dark smoke that thins out and disappears. Noise eats into the edge
 * of every puff differently, so a handful of them read as one churning volume.
 *
 * All puffs are instances of one quad, drawn in a single call. Fire is added to the picture
 * and smoke covers it; one blend mode does both (see the material below).
 */

const VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 puffPosition;
    attribute vec4 puffState;   // radius, age (0..1), seed, heat
    attribute vec3 puffTint;
    varying vec2 vCorner;
    varying float vAge;
    varying float vSeed;
    varying float vHeat;
    varying vec3 vTint;
    void main() {
        vCorner = position.xy * 2.0;
        vAge = puffState.y;
        vSeed = puffState.z;
        vHeat = puffState.w;
        vTint = puffTint;
        // Spin each puff a little as it ages so the noise does not look screen-aligned.
        float angle = puffState.z * 6.2831 + puffState.y * (puffState.z - 0.5) * 1.6;
        vec2 corner = mat2( cos( angle ), -sin( angle ), sin( angle ), cos( angle ) ) * position.xy;
        vec4 mvPosition = modelViewMatrix * vec4( puffPosition, 1.0 );
        mvPosition.xy += corner * 2.0 * puffState.x;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    varying vec2 vCorner;
    varying float vAge;
    varying float vSeed;
    varying float vHeat;
    varying vec3 vTint;

    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    float noise( vec2 p ) {
        vec2 i = floor( p );
        vec2 f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
    }
    float fbm( vec2 p ) {
        float value = 0.0;
        float amplitude = 0.5;
        for ( int i = 0; i < 4; i++ ) {
            value += amplitude * noise( p );
            p = p * 2.03 + 17.0;
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        #include <logdepthbuf_fragment>
        float r = length( vCorner );
        if ( r > 1.0 ) discard;
        float billow = fbm( vCorner * 2.1 + vSeed * 37.0 + vec2( 0.0, -vAge * 0.8 ) );
        float detail = fbm( vCorner * 4.6 - vSeed * 11.0 + vAge * 0.7 );
        // A ball whose edge is eaten away by the noise.
        float body = 1.0 - smoothstep( 0.2, 1.0, r + ( billow - 0.5 ) * 0.95 );
        float heat = body * clamp( 1.25 - vAge * 1.45 + ( detail - 0.5 ) * 0.9, 0.0, 1.0 ) * ( 1.0 - r * 0.3 ) * vHeat;

        vec3 fire = mix( vec3( 1.0, 0.14, 0.02 ), vec3( 1.0, 0.52, 0.1 ), smoothstep( 0.08, 0.45, heat ) );
        fire = mix( fire, vec3( 1.0, 0.93, 0.74 ), smoothstep( 0.45, 0.95, heat ) ) * vTint;
        vec3 emission = fire * heat * heat * 6.0;

        float smoke = body * smoothstep( 0.1, 0.45, vAge ) * pow( max( 0.0, 1.0 - vAge ), 1.2 ) * 0.85 * ( 0.55 + 0.45 * detail );
        // Lit from one side so the smoke has form instead of being a flat grey disc.
        float lit = 0.55 + 0.45 * dot( normalize( vec2( -0.6, 0.8 ) ), vCorner ) * ( 0.6 + 0.4 * billow );
        vec3 smokeColour = vec3( 0.16, 0.145, 0.135 ) * lit + fire * heat * 0.35;
        float fade = 1.0 - smoothstep( 0.82, 1.0, vAge );
        // Premultiplied: the fire is added to what is behind it, the smoke hides it.
        gl_FragColor = vec4( ( emission + smokeColour * smoke ) * fade, smoke * fade );
        // Last line of defence: never hand an invalid colour to the bloom pass.
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

const WHITE = new THREE.Color(1, 1, 1);

export class FireballSystem {
    constructor(capacity) {
        this.capacity = capacity;
        this.count = 0;
        // Per-puff simulation state (struct of arrays; live puffs are kept packed at the front).
        this.position = new Float32Array(capacity * 3);
        this.velocity = new Float32Array(capacity * 3);
        this.tint = new Float32Array(capacity * 3);
        this.radius = new Float32Array(capacity);
        this.growth = new Float32Array(capacity);
        this.age = new Float32Array(capacity);
        this.life = new Float32Array(capacity);
        this.seed = new Float32Array(capacity);
        this.heat = new Float32Array(capacity);

        const quad = new THREE.PlaneGeometry(1, 1);
        this.geometry = new THREE.InstancedBufferGeometry();
        this.geometry.index = quad.index;
        this.geometry.setAttribute('position', quad.attributes.position);
        this.attributes = {
            puffPosition: new THREE.InstancedBufferAttribute(this.position, 3),
            puffState: new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
            puffTint: new THREE.InstancedBufferAttribute(this.tint, 3),
        };
        for (const [name, attribute] of Object.entries(this.attributes)) {
            attribute.setUsage(THREE.DynamicDrawUsage);
            this.geometry.setAttribute(name, attribute);
        }
        this.geometry.instanceCount = 0;

        this.material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
        });
    }

    /**
     * Adds one puff. `radius` is its starting size and `growth` how many times bigger it is
     * when it dies; `heat` below 1 gives a duller, smokier puff.
     */
    spawn(position, velocity, { radius, growth = 2, life, heat = 1, tint = WHITE }) {
        // When full, the oldest puff (the faintest smoke) makes room.
        const i = this.count < this.capacity ? this.count++ : this.oldest();
        position.toArray(this.position, i * 3);
        velocity.toArray(this.velocity, i * 3);
        tint.toArray(this.tint, i * 3);
        this.radius[i] = radius;
        this.growth[i] = growth;
        this.age[i] = 0;
        this.life[i] = life;
        this.seed[i] = Math.random();
        this.heat[i] = heat;
    }

    oldest() {
        let index = 0;
        let best = -1;
        for (let i = 0; i < this.count; i++) {
            const progress = this.age[i] / this.life[i];
            if (progress > best) {
                best = progress;
                index = i;
            }
        }
        return index;
    }

    clear() {
        this.count = 0;
        this.geometry.instanceCount = 0;
    }

    update(dt) {
        const { position, velocity, tint, radius, growth, age, life, seed, heat } = this;
        const state = this.attributes.puffState.array;
        const drag = Math.exp(-1.6 * dt);
        let i = 0;
        while (i < this.count) {
            age[i] += dt;
            if (age[i] >= life[i]) {
                // Dead: move the last live puff into this slot.
                const last = --this.count;
                for (let k = 0; k < 3; k++) {
                    position[i * 3 + k] = position[last * 3 + k];
                    velocity[i * 3 + k] = velocity[last * 3 + k];
                    tint[i * 3 + k] = tint[last * 3 + k];
                }
                radius[i] = radius[last]; growth[i] = growth[last]; age[i] = age[last];
                life[i] = life[last]; seed[i] = seed[last]; heat[i] = heat[last];
                continue;
            }
            for (let k = 0; k < 3; k++) {
                position[i * 3 + k] += velocity[i * 3 + k] * dt;
                velocity[i * 3 + k] *= drag;
            }
            const progress = age[i] / life[i];
            // Fast expansion that slows down, like a real blast.
            state[i * 4] = radius[i] * (1 + (growth[i] - 1) * (1 - (1 - progress) ** 2.5));
            state[i * 4 + 1] = progress;
            state[i * 4 + 2] = seed[i];
            state[i * 4 + 3] = heat[i];
            i++;
        }
        this.geometry.instanceCount = this.count;
        for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
