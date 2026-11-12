import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { lookRotation } from '../core/math.js';

const MAX_BEAMS = 48;
const HALF_PI = Math.PI / 2;
const WHITE = new THREE.Color(1, 1, 1);

/** How each kind of beam is drawn: glow brightness, core brightness, and impact flare size. */
const BEAM_STYLES = Object.freeze({
    beam: { glow: 1.8, core: 2.2, flare: 3.2 },
    lanceCharge: { glow: 0.9, core: 0, flare: 0 },
    lance: { glow: 2.4, core: 3, flare: 0 },
    cannon: { glow: 2.6, core: 3.4, flare: 4 },
    tractor: { glow: 1.1, core: 0, flare: 1.2 },
});

const dummy = new THREE.Object3D();
const direction = new THREE.Vector3();
const color = new THREE.Color();

/**
 * Draws `world.beams` (rebuilt by the simulation every frame). Each beam is a coloured
 * outer cylinder, a white-hot core, and a flare where it lands.
 */
export default function BeamsLayer({ session }) {
    const glowRef = useRef(null);
    const coreRef = useRef(null);
    const flareRef = useRef(null);
    // Unit cylinder along Z, so scale.z is the beam length and scale.x/y its radius.
    const beamGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(HALF_PI), []);

    useFrame(() => {
        const world = session.world;
        const glow = glowRef.current;
        const core = coreRef.current;
        const flare = flareRef.current;
        const count = Math.min(world.beams.length, MAX_BEAMS);
        let glowCount = 0;
        let coreCount = 0;
        let flareCount = 0;

        for (let i = 0; i < count; i++) {
            const beam = world.beams[i];
            const style = BEAM_STYLES[beam.kind] ?? BEAM_STYLES.beam;
            const length = direction.copy(beam.end).sub(beam.start).length();
            if (length < 1e-3) continue;
            const flicker = 1 + 0.18 * Math.sin(world.time * 55 + i * 2.1);
            const radius = beam.width * 0.5 * flicker;

            dummy.position.copy(beam.start).add(beam.end).multiplyScalar(0.5);
            lookRotation(direction.multiplyScalar(1 / length), dummy.quaternion);
            dummy.scale.set(radius, radius, length);
            dummy.updateMatrix();
            glow.setMatrixAt(glowCount, dummy.matrix);
            glow.setColorAt(glowCount, color.set(beam.color).multiplyScalar(style.glow));
            glowCount += 1;

            if (style.core > 0) {
                dummy.scale.set(radius * 0.4, radius * 0.4, length);
                dummy.updateMatrix();
                core.setMatrixAt(coreCount, dummy.matrix);
                core.setColorAt(coreCount, color.copy(WHITE).multiplyScalar(style.core));
                coreCount += 1;
            }
            if (style.flare > 0) {
                dummy.position.copy(beam.end);
                dummy.quaternion.identity();
                dummy.scale.setScalar(beam.width * style.flare * flicker);
                dummy.updateMatrix();
                flare.setMatrixAt(flareCount, dummy.matrix);
                flare.setColorAt(flareCount, color.set(beam.color).multiplyScalar(1.5));
                flareCount += 1;
            }
        }

        for (const [mesh, used] of [[glow, glowCount], [core, coreCount], [flare, flareCount]]) {
            mesh.count = used;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    });

    return (
        <>
            <instancedMesh ref={glowRef} args={[beamGeometry, undefined, MAX_BEAMS]} frustumCulled={false}>
                <meshBasicMaterial transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={coreRef} args={[beamGeometry, undefined, MAX_BEAMS]} frustumCulled={false}>
                <meshBasicMaterial transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={flareRef} args={[undefined, undefined, MAX_BEAMS]} frustumCulled={false}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshBasicMaterial transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </instancedMesh>
        </>
    );
}
