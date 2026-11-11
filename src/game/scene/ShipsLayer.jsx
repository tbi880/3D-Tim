import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import AnyModel from '../../modelComponents/AnyModel';
import { bucketURL } from '../../Settings';
import { FACTION } from '../config/gameConfig.js';
import { useGameStore } from '../state/gameStore.js';
import { createShipModel, hasShipModel } from './models/shipModels.js';

/** The upgraded ship from the site's "Project Dawn" scene plays Captain Tim's Dawnbreaker. */
const DAWNBREAKER_MODEL = 'ship-upgrade-transformed.glb';
/** The GLB is ~1.09 units long with its bow towards +Z; scale it to the ship's hit shape and turn it round. */
const DAWNBREAKER_SCALE = 480;

const SHIELD_FLASH_SECONDS = 0.55;
const SPAWN_GROW_SECONDS = 0.35;
const SHIELD_COLORS = Object.freeze({
    [FACTION.DAWN]: '#59c8ff',
    [FACTION.UMBRA]: '#d04dff',
    [FACTION.NEUTRAL]: '#ffffff',
});

function DawnbreakerModel() {
    return (
        <group rotation={[0, Math.PI, 0]}>
            <AnyModel modelURL={DAWNBREAKER_MODEL} scale={DAWNBREAKER_SCALE} />
        </group>
    );
}

/**
 * Downloads the Dawnbreaker while the loading screen is still up, so it does not pop in
 * (or re-trigger the loader) when Captain Tim's ship first appears mid-story.
 */
export function ShipModelPreloader() {
    useGLTF(bucketURL + DAWNBREAKER_MODEL, true, true);
    return null;
}

/** One ship: follows its simulation entity and shows a shield shimmer when shields take a hit. */
function ShipView({ ship, world }) {
    const groupRef = useRef(null);
    const shieldRef = useRef(null);
    const model = useMemo(
        () => (hasShipModel(ship.cls.model) ? createShipModel(ship.cls.model, ship.faction) : null),
        [ship],
    );
    const shieldScale = useMemo(() => {
        const width = ship.radius * 1.25;
        return [width, width, (ship.halfLength + ship.radius) * 1.12];
    }, [ship]);

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        group.position.copy(ship.position);
        group.quaternion.copy(ship.quaternion);
        // Ships "pop" in from a point, like dropping out of warp.
        const grow = Math.min(1, (world.time - ship.spawnTime) / SPAWN_GROW_SECONDS);
        group.scale.setScalar(Math.max(0.001, grow));

        const flash = Math.max(0, 1 - (world.time - ship.lastShieldHitAt) / SHIELD_FLASH_SECONDS);
        const shield = shieldRef.current;
        shield.visible = flash > 0.01;
        shield.material.opacity = flash * 0.4;
    });

    return (
        <group ref={groupRef}>
            {model ? <primitive object={model} /> : <DawnbreakerModel />}
            <mesh ref={shieldRef} scale={shieldScale} visible={false}>
                <sphereGeometry args={[1, 20, 14]} />
                <meshBasicMaterial
                    color={SHIELD_COLORS[ship.faction]}
                    transparent
                    opacity={0}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    toneMapped={false}
                />
            </mesh>
        </group>
    );
}

/** Renders every ship in the world except the player's own (which is the camera). */
export default function ShipsLayer({ session }) {
    const roster = useGameStore((state) => state.roster);
    return roster
        .filter((ship) => ship.cls.model)
        .map((ship) => <ShipView key={ship.id} ship={ship} world={session.world} />);
}
