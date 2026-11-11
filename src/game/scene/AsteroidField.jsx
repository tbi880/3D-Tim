import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGameStore } from '../state/gameStore.js';
import { createAsteroidGeometry } from './models/shipModels.js';

const MAX_ASTEROIDS = 220;

/** Draws the sector's asteroids (`world.obstacles`) with a single instanced mesh. */
export default function AsteroidField({ session }) {
    const sectorId = useGameStore((state) => state.sectorId);
    const meshRef = useRef(null);
    const geometry = useMemo(() => createAsteroidGeometry(), []);

    useEffect(() => {
        const mesh = meshRef.current;
        const obstacles = session.world.obstacles;
        const dummy = new THREE.Object3D();
        const count = Math.min(obstacles.length, MAX_ASTEROIDS);
        for (let i = 0; i < count; i++) {
            const { position, radius, seed } = obstacles[i];
            dummy.position.copy(position);
            dummy.rotation.set(seed * 6.28, seed * 31.4, seed * 12.6);
            // Slightly uneven scaling makes the shared rock shape read as many different rocks.
            dummy.scale.set(radius * (0.85 + seed * 0.3), radius * (0.8 + ((seed * 7) % 1) * 0.3), radius);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
    }, [session, sectorId]);

    useEffect(() => () => geometry.dispose(), [geometry]);

    return (
        <instancedMesh ref={meshRef} args={[geometry, undefined, MAX_ASTEROIDS]} frustumCulled={false}>
            <meshStandardMaterial color="#4b443e" roughness={0.95} metalness={0.05} flatShading />
        </instancedMesh>
    );
}
