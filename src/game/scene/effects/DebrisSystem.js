import * as THREE from 'three';
import { WRECKAGE, createWreckageGeometries } from './wreckageShapes.js';

/**
 * Wreckage: pieces of hull (or rock) thrown out of an explosion, tumbling as they go.
 *
 * Every piece is an instance of one of a few shapes (see wreckageShapes.js), so the whole
 * field costs one draw call per shape. Ship wreckage wears the ships' own plating textures
 * and paint; freshly torn pieces also glow red-hot and cool over a few seconds. An
 * explosion pushes every piece equally hard, so small light pieces fly far and fast while
 * big heavy plates barely drift. Pieces are scenery only - nothing collides with them.
 */

const scratchMatrix = new THREE.Matrix4();
const scratchSpin = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchColor = new THREE.Color();
const SHRINK_SECONDS = 1.5;
/** A piece's speed falls with this power of its relative size: twice as long, less than half as fast. */
const MASS_EXPONENT = 1.1;

/** Adds the red-hot glow of a piece's `chunkHeat` on top of a standard material's lighting. */
function addHeatGlow(material) {
    material.onBeforeCompile = (shader) => {
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
    return material;
}

export class DebrisSystem {
    /**
     * @param {number} capacity most pieces alive at once
     * @param {{ albedo, normal, orm } | null} textures the ships' plating textures (null: plain metal)
     */
    constructor(capacity, textures) {
        this.capacity = capacity;
        this.count = 0;
        this.pieces = Array.from({ length: capacity }, () => ({
            shape: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
            axis: new THREE.Vector3(1, 0, 0), spin: 0, scale: new THREE.Vector3(1, 1, 1), color: new THREE.Color(),
            age: 0, life: 1, heat: 0,
        }));

        this.hullMaterial = addHeatGlow(new THREE.MeshStandardMaterial({
            map: textures?.albedo ?? null,
            normalMap: textures?.normal ?? null,
            roughnessMap: textures?.orm ?? null,
            metalnessMap: textures?.orm ?? null,
            metalness: 0.7,
            roughness: 1,
            // Plates and hull sections are open shells: both faces must draw.
            side: THREE.DoubleSide,
        }));
        this.rockMaterial = addHeatGlow(new THREE.MeshStandardMaterial({ metalness: 0.05, roughness: 0.95, flatShading: true }));

        this.geometries = createWreckageGeometries();
        this.meshes = this.geometries.map((geometry, shape) => {
            const heat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
            heat.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('chunkHeat', heat);
            const mesh = new THREE.InstancedMesh(geometry, shape === WRECKAGE.ROCK ? this.rockMaterial : this.hullMaterial, capacity);
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.setColorAt(0, scratchColor.set('#ffffff')); // allocates the per-instance colours
            return mesh;
        });
        this.filled = this.meshes.map(() => 0);
    }

    /**
     * Throws `count` pieces out of `origin`.
     * @param {{ count: number, size: number, speed: number, life: number, shapes: number[],
     *           colors: THREE.ColorRepresentation[], heat?: number, spread?: number, drift?: THREE.Vector3 }} burst
     *   size - typical piece length in metres (actual pieces range from a third to twice that);
     *   speed - how fast a typical-size piece leaves; shapes - WRECKAGE indices to pick from;
     *   colors - paints to pick from; spread - how far from `origin` pieces start;
     *   drift - velocity shared by all of them (the dying ship's own motion).
     */
    emit(origin, { count, size, speed, life, shapes, colors, heat = 0, spread = 0, drift = null }) {
        for (let n = 0; n < count; n++) {
            const piece = this.pieces[this.count < this.capacity ? this.count++ : this.oldest()];
            piece.shape = shapes[Math.floor(Math.random() * shapes.length)];
            scratchAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            piece.position.copy(origin).addScaledVector(scratchAxis, spread * Math.random());
            // Mostly small pieces, a few large ones.
            const relative = 0.33 + Math.random() ** 2.2 * 1.7;
            const length = size * relative;
            // Same push on every piece: speed falls with mass.
            piece.velocity.copy(scratchAxis).multiplyScalar(speed * (0.5 + Math.random() * 0.7) / relative ** MASS_EXPONENT);
            if (drift) piece.velocity.add(drift);
            piece.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            // Big pieces turn ponderously, small ones whirl.
            piece.spin = (0.5 + Math.random() * 1.6) / relative ** 1.3 * Math.min(1, 14 / length + 0.12);
            piece.quaternion.setFromAxisAngle(piece.axis, Math.random() * Math.PI * 2);
            piece.scale.set(length * (0.85 + Math.random() * 0.3), length * (0.85 + Math.random() * 0.3), length * (0.85 + Math.random() * 0.3));
            piece.color.set(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(0.75 + Math.random() * 0.5);
            piece.age = 0;
            // Large pieces linger; small ones are soon too far away to matter.
            piece.life = life * (0.55 + 0.45 * Math.min(2, relative));
            piece.heat = heat * (0.4 + Math.random() * 0.6);
        }
    }

    oldest() {
        let index = 0;
        let best = -1;
        for (let i = 0; i < this.count; i++) {
            const progress = this.pieces[i].age / this.pieces[i].life;
            if (progress > best) {
                best = progress;
                index = i;
            }
        }
        return index;
    }

    clear() {
        this.count = 0;
        for (const mesh of this.meshes) mesh.count = 0;
    }

    update(dt) {
        const { pieces, meshes, filled } = this;
        filled.fill(0);
        let i = 0;
        while (i < this.count) {
            const piece = pieces[i];
            piece.age += dt;
            if (piece.age >= piece.life) {
                // Swap the dead piece with the last live one and re-examine this slot.
                const last = --this.count;
                pieces[i] = pieces[last];
                pieces[last] = piece;
                continue;
            }
            piece.position.addScaledVector(piece.velocity, dt);
            piece.quaternion.premultiply(scratchSpin.setFromAxisAngle(piece.axis, piece.spin * dt));
            const remaining = piece.life - piece.age;
            const shrink = remaining < SHRINK_SECONDS ? remaining / SHRINK_SECONDS : 1;
            const mesh = meshes[piece.shape];
            const slot = filled[piece.shape]++;
            mesh.setMatrixAt(slot, scratchMatrix.compose(piece.position, piece.quaternion, scratchScale.copy(piece.scale).multiplyScalar(shrink)));
            mesh.setColorAt(slot, piece.color);
            // Hot metal cools in the first few seconds.
            mesh.geometry.attributes.chunkHeat.array[slot] = piece.heat * Math.max(0, 1 - piece.age / 5);
            i++;
        }
        for (let shape = 0; shape < meshes.length; shape++) {
            const mesh = meshes[shape];
            mesh.count = filled[shape];
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
            mesh.geometry.attributes.chunkHeat.needsUpdate = true;
        }
    }

    dispose() {
        for (const geometry of this.geometries) geometry.dispose();
        this.hullMaterial.dispose();
        this.rockMaterial.dispose();
    }
}
