import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { forwardOf } from '../core/math.js';

const MOTE_COUNT = 380;
/** Motes live in a cube of this half-size around the camera and wrap to the far side when they leave it. */
const BOX_HALF_SIZE = 340;
/** Each mote is drawn as a short streak this many seconds of travel long. */
const STREAK_SECONDS = 0.035;
/** Extra apparent speed (units / s) at full warp, which stretches the dust into warp streaks. */
const WARP_SPEED = 9000;
const WARP_STREAK_SECONDS = 0.07;
const MIN_STREAK_LENGTH = 0.6;

const forward = new THREE.Vector3();
const streak = new THREE.Vector3();

function wrap(value, centre) {
    const size = BOX_HALF_SIZE * 2;
    let offset = (value - centre + BOX_HALF_SIZE) % size;
    if (offset < 0) offset += size;
    return centre - BOX_HALF_SIZE + offset;
}

/**
 * Space dust: without it there is nothing nearby to judge speed against. The same motes
 * stretch into long streaks while `world.warpFactor` is above zero.
 */
export default function SpaceDust({ session }) {
    const materialRef = useRef(null);
    const motes = useMemo(() => {
        const points = new Float32Array(MOTE_COUNT * 3);
        for (let i = 0; i < points.length; i++) points[i] = (Math.random() * 2 - 1) * BOX_HALF_SIZE;
        return points;
    }, []);
    const geometry = useMemo(() => {
        const buffer = new THREE.BufferGeometry();
        const positions = new THREE.BufferAttribute(new Float32Array(MOTE_COUNT * 6), 3);
        positions.setUsage(THREE.DynamicDrawUsage);
        buffer.setAttribute('position', positions);
        return buffer;
    }, []);

    useFrame(({ camera }) => {
        const { world, effectsDelta: dt } = session;
        const player = world.player;
        if (!player) return;
        const warp = world.warpFactor;
        forwardOf(player.quaternion, forward);

        // The streak points backwards along the apparent motion of the dust past the ship.
        streak.copy(player.velocity).multiplyScalar(STREAK_SECONDS).addScaledVector(forward, warp * WARP_SPEED * WARP_STREAK_SECONDS);
        if (streak.lengthSq() < MIN_STREAK_LENGTH ** 2) streak.copy(forward).multiplyScalar(MIN_STREAK_LENGTH);
        const rush = warp * WARP_SPEED * dt;

        const positions = geometry.attributes.position.array;
        for (let i = 0; i < MOTE_COUNT; i++) {
            const m = i * 3;
            // During warp the dust itself rushes past, on top of the ship's own movement.
            motes[m] = wrap(motes[m] - forward.x * rush, camera.position.x);
            motes[m + 1] = wrap(motes[m + 1] - forward.y * rush, camera.position.y);
            motes[m + 2] = wrap(motes[m + 2] - forward.z * rush, camera.position.z);
            const v = i * 6;
            positions[v] = motes[m];
            positions[v + 1] = motes[m + 1];
            positions[v + 2] = motes[m + 2];
            positions[v + 3] = motes[m] + streak.x;
            positions[v + 4] = motes[m + 1] + streak.y;
            positions[v + 5] = motes[m + 2] + streak.z;
        }
        geometry.attributes.position.needsUpdate = true;
        if (materialRef.current) materialRef.current.opacity = 0.35 + warp * 0.65;
    });

    return (
        <lineSegments geometry={geometry} frustumCulled={false}>
            <lineBasicMaterial ref={materialRef} color="#bcd8ff" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
        </lineSegments>
    );
}
