import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The pieces a destroyed ship comes apart into. They are built to look like what the ships
 * are made of - torn hull plating, curved sections of pressure hull, lengths of structural
 * frame, machinery housings - and carry UVs for the same plating textures as the ships.
 * Each is roughly one unit long; the debris system scales them.
 */

/** Repeatable pseudo-random numbers, so the shapes are the same on every load. */
function createRandom(seed) {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
}

/** A flat-ish armour plate with a ragged outline, slightly buckled. */
function createPlate(seed) {
    const random = createRandom(seed);
    const outline = new THREE.Shape();
    const corners = 9;
    for (let i = 0; i < corners; i++) {
        const angle = (i / corners) * Math.PI * 2;
        // Alternate long and short radii for a torn, saw-toothed edge.
        const radius = (i % 2 === 0 ? 0.62 : 0.4) + random() * 0.22;
        const x = Math.cos(angle) * radius * 1.25;
        const y = Math.sin(angle) * radius * 0.8;
        if (i === 0) outline.moveTo(x, y);
        else outline.lineTo(x, y);
    }
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.07, bevelEnabled: false, curveSegments: 1 });
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        positions.setZ(i, positions.getZ(i) + 0.22 * x * x - 0.12 * y * x);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/** A curved slab of hull: part of a cylinder wall, with thickness. */
function createHullSection() {
    const outer = new THREE.CylinderGeometry(0.62, 0.62, 1.5, 7, 2, true, 0, 1.7);
    const inner = new THREE.CylinderGeometry(0.55, 0.55, 1.5, 7, 2, true, 0, 1.7);
    // The inside wall faces the axis.
    inner.scale(-1, 1, 1).rotateY(Math.PI - 1.7);
    const geometry = mergeGeometries([outer.toNonIndexed(), inner.toNonIndexed()]);
    geometry.translate(-0.3, 0, -0.45).rotateX(Math.PI / 2);
    return geometry;
}

/** A length of structural frame: two rails joined by braces. */
function createGirder() {
    const parts = [];
    const rail = (y) => new THREE.BoxGeometry(0.09, 0.09, 1.8).translate(0, y, 0);
    parts.push(rail(0.22), rail(-0.22));
    for (let i = 0; i < 5; i++) {
        const z = -0.8 + i * 0.4;
        parts.push(new THREE.BoxGeometry(0.06, 0.44, 0.06).translate(0, 0, z));
        if (i < 4) parts.push(new THREE.BoxGeometry(0.05, 0.6, 0.05).rotateX(0.74 * (i % 2 === 0 ? 1 : -1)).translate(0, 0, z + 0.2));
    }
    // One end is bent where it tore loose.
    const geometry = mergeGeometries(parts.map((part) => part.toNonIndexed()));
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const z = positions.getZ(i);
        if (z > 0.3) positions.setX(i, positions.getX(i) + (z - 0.3) ** 2 * 0.9);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/** A machinery housing with a stub of pipe still attached. */
function createHousing() {
    const body = new THREE.BoxGeometry(0.7, 0.45, 1.0);
    const lid = new THREE.BoxGeometry(0.5, 0.12, 0.6).translate(0.05, 0.28, -0.1);
    const pipe = new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8).rotateX(Math.PI / 2).translate(-0.2, -0.05, 0.75);
    const flange = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8).rotateX(Math.PI / 2).translate(-0.2, -0.05, 0.5);
    return mergeGeometries([body, lid, pipe, flange].map((part) => part.toNonIndexed()));
}

/** A jagged lump of rock (asteroid fragments). */
function createRockShard() {
    const geometry = new THREE.DodecahedronGeometry(0.6, 0);
    const positions = geometry.attributes.position;
    const random = createRandom(11);
    const jitter = new Map();
    for (let i = 0; i < positions.count; i++) {
        const key = `${positions.getX(i).toFixed(2)},${positions.getY(i).toFixed(2)},${positions.getZ(i).toFixed(2)}`;
        if (!jitter.has(key)) jitter.set(key, 0.65 + random() * 0.6);
        const k = jitter.get(key);
        positions.setXYZ(i, positions.getX(i) * k, positions.getY(i) * k * 0.6, positions.getZ(i) * k);
    }
    geometry.computeVertexNormals();
    return geometry;
}

/** Indices into the list returned by createWreckageGeometries(). */
export const WRECKAGE = Object.freeze({ PLATE_A: 0, PLATE_B: 1, HULL_SECTION: 2, GIRDER: 3, HOUSING: 4, ROCK: 5 });
/** What a ship leaves behind: mostly plating, some structure and machinery. */
export const SHIP_WRECKAGE = Object.freeze([
    WRECKAGE.PLATE_A, WRECKAGE.PLATE_A, WRECKAGE.PLATE_B, WRECKAGE.PLATE_B, WRECKAGE.HULL_SECTION, WRECKAGE.HULL_SECTION,
    WRECKAGE.GIRDER, WRECKAGE.HOUSING,
]);
/** The big pieces of a broken capital ship: plating and hull sections only. */
export const HULL_WRECKAGE = Object.freeze([WRECKAGE.PLATE_A, WRECKAGE.PLATE_B, WRECKAGE.HULL_SECTION, WRECKAGE.HULL_SECTION]);
export const ROCK_WRECKAGE = Object.freeze([WRECKAGE.ROCK]);

export function createWreckageGeometries() {
    return [createPlate(3), createPlate(8), createHullSection(), createGirder(), createHousing(), createRockShard()];
}
