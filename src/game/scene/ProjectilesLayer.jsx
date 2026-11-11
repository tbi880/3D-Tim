import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { lookRotation } from '../core/math.js';

const MAX_BOLTS = 400;
const MAX_TORPEDOES = 80;
/** Colours above 1.0 feed the bloom pass. */
const BOLT_BRIGHTNESS = 2.6;
const TORPEDO_BRIGHTNESS = 3;
const HALF_PI = Math.PI / 2;

const dummy = new THREE.Object3D();
const direction = new THREE.Vector3();
const colorCache = new Map();

/** Parses each weapon colour once; bolts ask for the same few colours thousands of times. */
function brightColor(hex, brightness) {
    const key = hex + brightness;
    if (!colorCache.has(key)) colorCache.set(key, new THREE.Color(hex).multiplyScalar(brightness));
    return colorCache.get(key);
}

function finishInstances(mesh, count) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Draws all bolts and torpedoes with three instanced meshes. */
export default function ProjectilesLayer({ session }) {
    const boltsRef = useRef(null);
    const torpedoesRef = useRef(null);
    const halosRef = useRef(null);
    const boltGeometry = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 10, 6).rotateX(HALF_PI), []);

    useFrame(() => {
        const world = session.world;
        const bolts = boltsRef.current;
        const torpedoes = torpedoesRef.current;
        const halos = halosRef.current;
        let boltCount = 0;
        let torpedoCount = 0;
        const pulse = 1 + 0.25 * Math.sin(world.time * 18);

        for (const projectile of world.projectiles) {
            if (projectile.kind === 'bolt') {
                if (boltCount >= MAX_BOLTS) continue;
                dummy.position.copy(projectile.position);
                lookRotation(direction.copy(projectile.velocity).normalize(), dummy.quaternion);
                dummy.scale.setScalar(1);
                dummy.updateMatrix();
                bolts.setMatrixAt(boltCount, dummy.matrix);
                bolts.setColorAt(boltCount, brightColor(projectile.color, BOLT_BRIGHTNESS));
                boltCount += 1;
            } else {
                if (torpedoCount >= MAX_TORPEDOES) continue;
                dummy.position.copy(projectile.position);
                dummy.quaternion.identity();
                dummy.scale.setScalar(projectile.radius);
                dummy.updateMatrix();
                torpedoes.setMatrixAt(torpedoCount, dummy.matrix);
                torpedoes.setColorAt(torpedoCount, brightColor(projectile.color, TORPEDO_BRIGHTNESS));
                dummy.scale.setScalar(projectile.radius * 3.2 * pulse);
                dummy.updateMatrix();
                halos.setMatrixAt(torpedoCount, dummy.matrix);
                halos.setColorAt(torpedoCount, brightColor(projectile.color, 1));
                torpedoCount += 1;
            }
        }
        finishInstances(bolts, boltCount);
        finishInstances(torpedoes, torpedoCount);
        finishInstances(halos, torpedoCount);
    });

    return (
        <>
            <instancedMesh ref={boltsRef} args={[boltGeometry, undefined, MAX_BOLTS]} frustumCulled={false}>
                <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={torpedoesRef} args={[undefined, undefined, MAX_TORPEDOES]} frustumCulled={false}>
                <sphereGeometry args={[1, 12, 8]} />
                <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={halosRef} args={[undefined, undefined, MAX_TORPEDOES]} frustumCulled={false}>
                <sphereGeometry args={[1, 12, 8]} />
                <meshBasicMaterial transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </instancedMesh>
        </>
    );
}
