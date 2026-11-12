import * as THREE from 'three';

/** Cheap repeatable 3D value noise in 0..1 (enough to shape a rock). */
function valueNoise(x, y, z) {
    const hash = (i, j, k) => {
        const n = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
        return n - Math.floor(n);
    };
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fade = (t) => t * t * (3 - 2 * t);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
        lerp(lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
        lerp(lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
        w,
    );
}

/** Planes that cut flat faces into the rock: unit normal, then distance from the centre. */
const FRACTURE_PLANES = [
    [0.82, 0.31, 0.48, 0.74], [-0.56, 0.71, -0.43, 0.7], [0.12, -0.93, 0.35, 0.66], [-0.71, -0.28, 0.65, 0.78],
    [0.33, 0.52, -0.79, 0.72], [-0.2, 0.15, 0.97, 0.86], [0.64, -0.55, -0.53, 0.8],
];

/**
 * One asteroid of radius ~1: a sphere pushed in and out by a few octaves of noise and cut
 * by a few flat fracture faces, with smooth normals and UVs for the rock textures. Every asteroid in the game is an instance
 * of this one shape, scaled unevenly and rotated so no two look alike.
 */
export function createAsteroidGeometry() {
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    const positions = geometry.attributes.position;
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).normalize();
        // Broad lumps, then knobs, then grit...
        let radius = 0.6
            + 0.62 * valueNoise(point.x * 1.1 + 4, point.y * 1.1 + 9, point.z * 1.1 + 2)
            + 0.3 * valueNoise(point.x * 2.9, point.y * 2.9 + 5, point.z * 2.9)
            + 0.09 * valueNoise(point.x * 8.3 + 1, point.y * 8.3, point.z * 8.3 + 7);
        // ...then a handful of flat faces sheared off it, as if by old collisions.
        for (const [nx, ny, nz, depth] of FRACTURE_PLANES) {
            const facing = point.x * nx + point.y * ny + point.z * nz;
            if (facing > 0.05) radius = Math.min(radius, depth / facing);
        }
        positions.setXYZ(i, point.x * radius, point.y * radius, point.z * radius);
    }
    geometry.computeVertexNormals();

    // The sphere's seam and poles are duplicated vertices; give the copies one shared normal
    // so the lighting does not show a crease there.
    const normals = geometry.attributes.normal;
    const sums = new Map();
    const keyOf = (i) => `${positions.getX(i).toFixed(4)},${positions.getY(i).toFixed(4)},${positions.getZ(i).toFixed(4)}`;
    for (let i = 0; i < positions.count; i++) {
        const key = keyOf(i);
        if (!sums.has(key)) sums.set(key, new THREE.Vector3());
        sums.get(key).add(point.fromBufferAttribute(normals, i));
    }
    for (let i = 0; i < positions.count; i++) {
        point.copy(sums.get(keyOf(i))).normalize();
        normals.setXYZ(i, point.x, point.y, point.z);
    }

    // Two repeats of the rock texture around the equator keeps its craters a sensible size.
    const uvs = geometry.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 2, uvs.getY(i));
    geometry.computeBoundingSphere();
    return geometry;
}
