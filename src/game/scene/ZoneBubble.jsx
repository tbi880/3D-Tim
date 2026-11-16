import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTION, WORLD } from '../config/gameConfig.js';
import { useGameStore } from '../state/gameStore.js';

/** The bubble's colour for each side that can hold a planet. */
const BUBBLE_COLORS = Object.freeze({
    [FACTION.DAWN]: '#59c8ff',
    [FACTION.UMBRA]: '#c04dff',
    [FACTION.PIRATE]: '#ffb347',
});

/**
 * The anti-gravity bubble of the side that holds the planet the player is at (battle
 * royale): one huge, faintly glowing sphere around the whole combat area, in that side's
 * colour. From inside it tints the sky; ships arriving see it from afar.
 */
export default function ZoneBubble() {
    const owner = useGameStore((state) => {
        const match = state.match;
        return match?.planets?.find((planet) => planet.id === match.you?.planet)?.owner ?? null;
    });
    const materialRef = useRef(null);

    useFrame(({ clock }) => {
        // A slow breath, so it reads as a field and not as painted sky.
        if (materialRef.current) materialRef.current.opacity = 0.085 + 0.025 * Math.sin(clock.elapsedTime * 0.8);
    });

    if (!owner || !BUBBLE_COLORS[owner]) return null;
    return (
        <mesh scale={WORLD.arenaRadius} renderOrder={-1}>
            <sphereGeometry args={[1, 64, 40]} />
            <meshBasicMaterial
                ref={materialRef}
                color={BUBBLE_COLORS[owner]}
                transparent
                opacity={0.1}
                side={THREE.DoubleSide}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
            />
        </mesh>
    );
}
