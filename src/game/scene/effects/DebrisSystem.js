import * as THREE from 'three';

/**
 * Wreckage: chunks of hull (or rock) thrown out of an explosion, tumbling as they go.
 *
 * Every chunk is an instance of one jagged shard, so the whole field is a single draw call.
 * Chunks are lit like the ships they came from; freshly torn ones also glow red-hot and
 * cool over a few seconds. They are scenery only - nothing collides with them.
 */

const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchSpin = new THREE.Quaternion();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchColor = new THREE.Color();
const SHRINK_SECONDS = 1.2;

/** A torn plate: a squashed, irregular solid with hard facets. */
function createShardGeometry() {
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const positions = geometry.attributes.position;
    const jitter = (x, y, z) => {
        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return 0.62 + 0.55 * (n - Math.floor(n));
    };
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const k = jitter(Math.round(x * 10), Math.round(y * 10), Math.round(z * 10));
        positions.setXYZ(i, x * k, y * k * 0.45, z * k);
    }
    geometry.computeVertexNormals();
    return geometry;
}

export class DebrisSystem {
    constructor(capacity) {
        this.capacity = capacity;
        this.count = 0;
        this.chunks = Array.from({ length: capacity }, () => ({
            position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
            axis: new THREE.Vector3(1, 0, 0), spin: 0, scale: new THREE.Vector3(1, 1, 1), color: new THREE.Color(),
            age: 0, life: 1, heat: 0,
        }));
        this.geometry = createShardGeometry();
        this.heat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
        this.heat.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('chunkHeat', this.heat);

        this.material = new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.62, flatShading: true });
        // Adds the red-hot glow of a chunk's `chunkHeat` on top of the normal lighting.
        this.material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float chunkHeat;\nvarying float vChunkHeat;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChunkHeat = chunkHeat;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vChunkHeat;')
                .replace('#include <emissivemap_fragment>', `
                    #include <emissivemap_fragment>
                    totalEmissiveRadiance += mix( vec3( 1.0, 0.16, 0.03 ), vec3( 1.0, 0.7, 0.3 ), vChunkHeat ) * vChunkHeat * vChunkHeat * 3.0;
                `);
        };

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Allocate the per-instance colours up front.
        this.mesh.setColorAt(0, scratchColor.set('#ffffff'));
    }

    /**
     * Throws `count` chunks out of `origin`.
     * @param {{ count: number, size: number, speed: number, life: number, color: THREE.ColorRepresentation,
     *           heat?: number, spread?: number, drift?: THREE.Vector3 }} burst
     *   size - typical chunk length in metres; spread - how far from `origin` chunks start;
     *   drift - velocity shared by all of them (the dying ship's own motion).
     */
    emit(origin, { count, size, speed, life, color, heat = 0, spread = 0, drift = null }) {
        for (let n = 0; n < count; n++) {
            const chunk = this.chunks[this.count < this.capacity ? this.count++ : this.oldest()];
            scratchAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            chunk.position.copy(origin).addScaledVector(scratchAxis, spread * Math.random());
            // Small pieces fly fastest.
            const scale = size * (0.35 + Math.random() ** 2 * 1.3);
            chunk.velocity.copy(scratchAxis).multiplyScalar(speed * (0.25 + Math.random() * 0.75) * Math.sqrt(size / scale));
            if (drift) chunk.velocity.add(drift);
            chunk.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            chunk.spin = (0.4 + Math.random() * 2.2) * Math.min(1, 12 / scale + 0.15);
            chunk.quaternion.setFromAxisAngle(chunk.axis, Math.random() * Math.PI * 2);
            chunk.scale.set(scale * (0.6 + Math.random() * 0.8), scale * (0.5 + Math.random() * 0.7), scale * (0.7 + Math.random() * 0.9));
            chunk.color.set(color).multiplyScalar(0.7 + Math.random() * 0.5);
            chunk.age = 0;
            chunk.life = life * (0.6 + Math.random() * 0.6);
            chunk.heat = heat * (0.4 + Math.random() * 0.6);
        }
    }

    oldest() {
        let index = 0;
        let best = -1;
        for (let i = 0; i < this.count; i++) {
            const progress = this.chunks[i].age / this.chunks[i].life;
            if (progress > best) {
                best = progress;
                index = i;
            }
        }
        return index;
    }

    clear() {
        this.count = 0;
        this.mesh.count = 0;
    }

    update(dt) {
        const { chunks, mesh } = this;
        let i = 0;
        while (i < this.count) {
            const chunk = chunks[i];
            chunk.age += dt;
            if (chunk.age >= chunk.life) {
                // Swap the dead chunk with the last live one and re-examine this slot.
                const last = --this.count;
                chunks[i] = chunks[last];
                chunks[last] = chunk;
                continue;
            }
            chunk.position.addScaledVector(chunk.velocity, dt);
            chunk.quaternion.premultiply(scratchSpin.setFromAxisAngle(chunk.axis, chunk.spin * dt));
            const remaining = chunk.life - chunk.age;
            const shrink = remaining < SHRINK_SECONDS ? remaining / SHRINK_SECONDS : 1;
            mesh.setMatrixAt(i, scratchMatrix.compose(
                scratchPosition.copy(chunk.position), scratchQuaternion.copy(chunk.quaternion), scratchScale.copy(chunk.scale).multiplyScalar(shrink),
            ));
            mesh.setColorAt(i, chunk.color);
            // Hot metal cools in the first few seconds.
            this.heat.array[i] = chunk.heat * Math.max(0, 1 - chunk.age / 4);
            i++;
        }
        mesh.count = this.count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        this.heat.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
