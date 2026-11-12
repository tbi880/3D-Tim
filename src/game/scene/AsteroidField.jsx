import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createAsteroidGeometry } from './models/asteroidGeometry.js';

const MAX_ASTEROIDS = 400;
const dummy = new THREE.Object3D();

/**
 * Draws the sector's asteroids (`world.obstacles`) with a single instanced mesh.
 * The list changes as rocks are blown apart, so the instances are rewritten every frame;
 * that also lets every rock tumble slowly.
 */
export default function AsteroidField({ session }) {
    const meshRef = useRef(null);
    const geometry = useMemo(() => createAsteroidGeometry(), []);

    useFrame(() => {
        const mesh = meshRef.current;
        const { obstacles, time } = session.world;
        const count = Math.min(obstacles.length, MAX_ASTEROIDS);
        for (let i = 0; i < count; i++) {
            const { position, radius, seed } = obstacles[i];
            const spin = time * (0.04 + seed * 0.12);
            dummy.position.copy(position);
            dummy.rotation.set(seed * 6.28 + spin, seed * 31.4 + spin * 0.7, seed * 12.6);
            // Slightly uneven scaling makes the one shared rock shape read as many different rocks.
            dummy.scale.set(radius * (0.85 + seed * 0.3), radius * (0.8 + ((seed * 7) % 1) * 0.3), radius);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
    });

    useEffect(() => () => geometry.dispose(), [geometry]);

    return (
        <instancedMesh ref={meshRef} args={[geometry, undefined, MAX_ASTEROIDS]} frustumCulled={false}>
            <meshStandardMaterial color="#4b443e" roughness={0.95} metalness={0.05} flatShading />
        </instancedMesh>
    );
}
