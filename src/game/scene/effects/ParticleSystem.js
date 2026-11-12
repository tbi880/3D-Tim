import * as THREE from 'three';

const PARTICLE_VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute float size;
    attribute float alpha;
    attribute vec3 tint;
    uniform float pixelScale;
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
        vTint = tint;
        vAlpha = alpha;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(256.0, size * pixelScale / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
        #include <logdepthbuf_vertex>
    }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    varying vec3 vTint;
    varying float vAlpha;
    void main() {
        #include <logdepthbuf_fragment>
        float falloff = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vTint * falloff * vAlpha, 1.0);
    }
`;

const scratchVelocity = new THREE.Vector3();

/** Uniformly distributed unit vector (visual effects only, so Math.random is fine). */
export function randomDirection(out) {
    const z = Math.random() * 2 - 1;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(angle), r * Math.sin(angle), z);
}

/**
 * A fixed-size ring buffer of additive point-sprite particles (debris, sparks, fire).
 * The shaders include three.js's logdepthbuf chunks because the game renders with a
 * logarithmic depth buffer. Emitting never allocates: new particles overwrite the oldest ones.
 */
export class ParticleSystem {
    constructor(capacity) {
        this.capacity = capacity;
        this.geometry = new THREE.BufferGeometry();
        this.attributes = {
            position: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
            tint: new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
            size: new THREE.BufferAttribute(new Float32Array(capacity), 1),
            alpha: new THREE.BufferAttribute(new Float32Array(capacity), 1),
        };
        for (const [name, attribute] of Object.entries(this.attributes)) {
            attribute.setUsage(THREE.DynamicDrawUsage);
            this.geometry.setAttribute(name, attribute);
        }
        this.material = new THREE.ShaderMaterial({
            vertexShader: PARTICLE_VERTEX_SHADER,
            fragmentShader: PARTICLE_FRAGMENT_SHADER,
            uniforms: { pixelScale: { value: 600 } },
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
        });
        this.velocity = new Float32Array(capacity * 3);
        this.life = new Float32Array(capacity);
        this.maxLife = new Float32Array(capacity);
        this.cursor = 0;
    }

    /** Sets the factor that converts a particle's world size into pixels for the current view. */
    setPixelScale(viewportHeight, fovDegrees) {
        this.material.uniforms.pixelScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
    }

    /**
     * Adds `count` particles flying outwards from `origin`.
     * @param {{ count: number, speed: number, life: number, size: number, colors: THREE.Color[] }} burst
     */
    emit(origin, { count, speed, life, size, colors }) {
        const { attributes } = this;
        for (let n = 0; n < count; n++) {
            const i = this.cursor;
            this.cursor = (this.cursor + 1) % this.capacity;
            randomDirection(scratchVelocity).multiplyScalar(speed * (0.25 + Math.random() * 0.75));
            attributes.position.setXYZ(i, origin.x, origin.y, origin.z);
            scratchVelocity.toArray(this.velocity, i * 3);
            const tint = colors[Math.floor(Math.random() * colors.length)];
            attributes.tint.setXYZ(i, tint.r, tint.g, tint.b);
            attributes.size.setX(i, size * (0.5 + Math.random()));
            this.maxLife[i] = life * (0.5 + Math.random() * 0.7);
            this.life[i] = this.maxLife[i];
        }
    }

    /** Removes every particle at once (the scene jumped somewhere else). */
    clear() {
        this.life.fill(0);
        this.attributes.alpha.array.fill(0);
        this.attributes.alpha.needsUpdate = true;
    }

    update(dt) {
        const { attributes, velocity, life, maxLife } = this;
        const positions = attributes.position.array;
        const alphas = attributes.alpha.array;
        const drag = Math.exp(-1.2 * dt);
        for (let i = 0; i < this.capacity; i++) {
            if (life[i] <= 0) continue;
            life[i] -= dt;
            const offset = i * 3;
            positions[offset] += velocity[offset] * dt;
            positions[offset + 1] += velocity[offset + 1] * dt;
            positions[offset + 2] += velocity[offset + 2] * dt;
            velocity[offset] *= drag;
            velocity[offset + 1] *= drag;
            velocity[offset + 2] *= drag;
            alphas[i] = life[i] > 0 ? (life[i] / maxLife[i]) ** 1.5 : 0;
        }
        for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
