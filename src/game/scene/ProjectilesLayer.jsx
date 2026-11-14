import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { lookRotation } from '../core/math.js';
import { TorpedoEffects } from './effects/TorpedoEffects.js';

const MAX_BOLTS = 400;
/** Colours above 1.0 feed the bloom pass. */
const BOLT_BRIGHTNESS = 2.6;
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

/**
 * Draws all bolts (one instanced mesh) and photon torpedoes with their wakes, launch flashes
 * and impact bursts (TorpedoEffects, three draw calls).
 */
export default function ProjectilesLayer({ session }) {
    const boltsRef = useRef(null);
    const boltGeometry = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 10, 6).rotateX(HALF_PI), []);
    const torpedoFx = useMemo(() => new TorpedoEffects(), []);

    // After a jump nothing from the old sector should hang in the new sky.
    useEffect(() => session.world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => torpedoFx.reset()), [session, torpedoFx]);
    useEffect(() => () => {
        torpedoFx.dispose();
        boltGeometry.dispose();
    }, [torpedoFx, boltGeometry]);

    useFrame(() => {
        const world = session.world;
        const bolts = boltsRef.current;
        let boltCount = 0;

        for (const projectile of world.projectiles) {
            if (projectile.kind !== 'bolt') continue;
            if (boltCount >= MAX_BOLTS) break;
            dummy.position.copy(projectile.position);
            lookRotation(direction.copy(projectile.velocity).normalize(), dummy.quaternion);
            dummy.scale.setScalar(1);
            dummy.updateMatrix();
            bolts.setMatrixAt(boltCount, dummy.matrix);
            bolts.setColorAt(boltCount, brightColor(projectile.color, BOLT_BRIGHTNESS));
            boltCount += 1;
        }
        finishInstances(bolts, boltCount);
        torpedoFx.update(world, session.effectsDelta);
    });

    return (
        <>
            <instancedMesh ref={boltsRef} args={[boltGeometry, undefined, MAX_BOLTS]} frustumCulled={false}>
                <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
            <primitive object={torpedoFx.group} />
        </>
    );
}
