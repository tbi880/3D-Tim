import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const FRAME_COLOR = '#151b25';
const HEALTHY_COLOR = new THREE.Color('#3fd0ff');
const DAMAGED_COLOR = new THREE.Color('#ff3b3b');
/** Emissive strips are brighter than 1 so the bloom pass picks them up. */
const STRIP_BRIGHTNESS = 1.3;

/**
 * The Kestrel's cockpit: a canopy frame and dashboard attached to the camera.
 * Purely cosmetic; it frames the view and its light strips turn red as the hull fails.
 */
export default function Cockpit({ session }) {
    const stripMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: HEALTHY_COLOR, toneMapped: false }), []);
    const frameMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: FRAME_COLOR, metalness: 0.3, roughness: 0.7 }), []);
    const pulse = useRef(0);

    useFrame(() => {
        const player = session.world.player;
        if (!player) return;
        pulse.current += session.effectsDelta;
        const hull = player.hullFraction;
        // Below 30% hull the strips also pulse, like an alarm.
        const alarm = hull < 0.3 ? 0.65 + 0.35 * Math.sin(pulse.current * 9) : 1;
        stripMaterial.color.copy(DAMAGED_COLOR).lerp(HEALTHY_COLOR, Math.min(1, hull * 1.4)).multiplyScalar(STRIP_BRIGHTNESS * alarm);
    });

    return (
        <group>
            {/* Dashboard */}
            <mesh position={[0, -1.2, -1.45]} rotation={[0.55, 0, 0]} material={frameMaterial}>
                <boxGeometry args={[4.4, 0.5, 1.1]} />
            </mesh>
            <mesh position={[0, -0.985, -1.72]} rotation={[0.55, 0, 0]} material={stripMaterial}>
                <boxGeometry args={[3.2, 0.012, 0.02]} />
            </mesh>
            {/* Canopy struts: kept near the screen edges so they frame the view without hiding it. */}
            <mesh position={[-1.76, 0.05, -1.5]} rotation={[0, 0, -0.3]} material={frameMaterial}>
                <boxGeometry args={[0.05, 2.6, 0.05]} />
            </mesh>
            <mesh position={[1.76, 0.05, -1.5]} rotation={[0, 0, 0.3]} material={frameMaterial}>
                <boxGeometry args={[0.05, 2.6, 0.05]} />
            </mesh>
            <mesh position={[0, 1.02, -1.5]} material={frameMaterial}>
                <boxGeometry args={[3.2, 0.08, 0.08]} />
            </mesh>
            <mesh position={[0, 0.975, -1.5]} material={stripMaterial}>
                <boxGeometry args={[0.4, 0.01, 0.02]} />
            </mesh>
            {/* A soft fill light so the frame is never pitch black. */}
            <pointLight position={[0, 0.1, -0.4]} intensity={1} distance={5} decay={1.2} color="#8fc4ff" />
        </group>
    );
}
