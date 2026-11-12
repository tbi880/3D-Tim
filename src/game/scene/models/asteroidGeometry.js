import * as THREE from 'three';

/** A lumpy rock used (instanced) for asteroid fields. Radius is roughly 1. */
export function createAsteroidGeometry() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        // Cheap deterministic "noise" from the vertex direction keeps shared vertices welded.
        const bump = Math.sin(vertex.x * 5.1) * Math.cos(vertex.y * 4.3) * Math.sin(vertex.z * 3.7 + 1.3);
        vertex.multiplyScalar(0.82 + bump * 0.22);
        positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
    return geometry;
}
