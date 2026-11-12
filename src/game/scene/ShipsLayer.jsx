import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EFFECTS, FACTION } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { forwardOf } from '../core/math.js';
import { useGameStore } from '../state/gameStore.js';
import ShipModel, { getModelInfo } from './models/ShipModel.jsx';

const SHIELD_FLASH_SECONDS = 0.55;
/** How fast (rad/s) a dying capital ship's hull rolls while it breaks up. */
const DYING_ROLL = 0.05;
/** How far behind its destination a ship starts its warp-in streak, and how much it is stretched. */
const WARP_IN_DISTANCE = 9000;
const WARP_STRETCH = 45;
/** Final seconds of a departing ship's life, during which it stretches away into warp. */
const WARP_OUT_SECONDS = 0.9;
const HALF_PI = Math.PI / 2;

const FACTION_COLORS = Object.freeze({
    [FACTION.DAWN]: { shield: '#59c8ff', engine: '#7fdcff' },
    [FACTION.UMBRA]: { shield: '#d04dff', engine: '#ff5c8f' },
    [FACTION.NEUTRAL]: { shield: '#ffffff', engine: '#ffd36b' },
});

const scratchForward = new THREE.Vector3();

// A unit cone with its base at the origin and its tip at +Z: scaled into an exhaust plume.
let plumeGeometry = null;
function getPlumeGeometry() {
    plumeGeometry ??= new THREE.ConeGeometry(1, 1, 10, 1, true).rotateX(HALF_PI).translate(0, 0, 0.5);
    return plumeGeometry;
}

/** Glowing exhaust behind each engine; its length follows the ship's thrust (0..~1.6). */
function EnginePlumes({ engines, faction, getThrust }) {
    const groupRef = useRef(null);
    const geometry = getPlumeGeometry();

    useFrame(({ clock }) => {
        const group = groupRef.current;
        if (!group) return;
        const thrust = getThrust();
        const flicker = 1 + 0.08 * Math.sin(clock.elapsedTime * 40);
        for (let i = 0; i < group.children.length; i++) {
            const radius = engines[i][3];
            group.children[i].scale.set(radius * 0.85, radius * 0.85, radius * (1.2 + thrust * 6) * flicker);
        }
    });

    return (
        <group ref={groupRef}>
            {engines.map(([x, y, z], index) => (
                <mesh key={index} position={[x, y, z]} geometry={geometry}>
                    <meshBasicMaterial
                        color={FACTION_COLORS[faction].engine}
                        transparent
                        opacity={0.55}
                        blending={THREE.AdditiveBlending}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                        toneMapped={false}
                    />
                </mesh>
            ))}
        </group>
    );
}

/**
 * Moves a ship's view for warp arrival / departure: the hull is stretched into a streak
 * that decelerates into (or accelerates away from) its real position.
 */
function applyWarpTransform(group, streak, ship) {
    let displacement = 0;
    if (ship.warpTimer > 0) {
        // Arriving: comes in from far behind along its own heading.
        displacement = -((ship.warpTimer / ship.warpDuration) ** 3);
    } else if (ship.despawnTimer != null && ship.despawnTimer < WARP_OUT_SECONDS) {
        // Leaving: leaps forward.
        displacement = (1 - Math.max(0, ship.despawnTimer) / WARP_OUT_SECONDS) ** 3;
    }
    group.position.copy(ship.position);
    if (displacement === 0) {
        group.scale.setScalar(1);
        streak.visible = false;
        return;
    }
    const amount = Math.abs(displacement);
    forwardOf(ship.quaternion, scratchForward);
    group.position.addScaledVector(scratchForward, displacement * WARP_IN_DISTANCE);
    group.scale.set(1, 1, 1 + amount * WARP_STRETCH);
    streak.visible = true;
    streak.material.opacity = Math.min(1, amount * 3);
}

/** One ship: follows its simulation entity, with engine glow, shield shimmer and warp streak. */
function ShipView({ ship, world }) {
    const groupRef = useRef(null);
    const shieldRef = useRef(null);
    const streakRef = useRef(null);
    const info = getModelInfo(ship.cls.model);
    const shieldScale = useMemo(() => {
        if (ship.halfExtents) return ship.halfExtents.clone().multiplyScalar(1.45).toArray();
        const size = ship.radius * 1.3;
        return [size, size, size];
    }, [ship]);

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        group.quaternion.copy(ship.quaternion);
        applyWarpTransform(group, streakRef.current, ship);

        const flash = Math.max(0, 1 - (world.time - ship.lastShieldHitAt) / SHIELD_FLASH_SECONDS);
        const shield = shieldRef.current;
        shield.visible = flash > 0.01;
        shield.material.opacity = flash * 0.35;
    });

    const getThrust = () => (ship.cls.maxSpeed > 0 ? ship.speed / ship.cls.maxSpeed : 0.25);
    const streakWidth = ship.boundingRadius * 0.12;

    return (
        <group ref={groupRef}>
            <ShipModel modelId={ship.cls.model} faction={ship.faction} />
            {info?.engines?.length > 0 && <EnginePlumes engines={info.engines} faction={ship.faction} getThrust={getThrust} />}
            <mesh ref={shieldRef} scale={shieldScale} visible={false}>
                <sphereGeometry args={[1, 20, 14]} />
                <meshBasicMaterial
                    color={FACTION_COLORS[ship.faction].shield}
                    transparent
                    opacity={0}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    toneMapped={false}
                />
            </mesh>
            {/* Bright core of the warp streak; the stretched hull supplies the rest. */}
            <mesh ref={streakRef} scale={[streakWidth, streakWidth, ship.boundingRadius * 1.2]} visible={false}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshBasicMaterial color="#dff3ff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}

/** The player's own ship, drawn only in the third-person (chase) view. */
function PlayerShipView({ session }) {
    const groupRef = useRef(null);
    const info = getModelInfo(session.world.player?.cls.model ?? 'kestrel');

    useFrame(() => {
        const group = groupRef.current;
        const player = session.world.player;
        if (!group || !player) return;
        group.visible = player.alive && session.settings.cameraMode === 'chase';
        group.position.copy(player.position);
        group.quaternion.copy(player.quaternion);
    });

    const getThrust = () => {
        const player = session.world.player;
        if (!player?.alive) return 0;
        return player.boosting ? 1.6 : 0.15 + (player.speed / player.cls.maxSpeed) * 0.85;
    };

    return (
        <group ref={groupRef} visible={false}>
            <ShipModel modelId="kestrel" faction={FACTION.DAWN} />
            {info?.engines?.length > 0 && <EnginePlumes engines={info.engines} faction={FACTION.DAWN} getThrust={getThrust} />}
        </group>
    );
}

/**
 * The hull of a capital ship that has just been destroyed. The simulation has already
 * removed it; the picture lingers, drifting and slowly rolling, while ExplosionsLayer walks
 * blasts along it, and disappears in the main explosion (see EFFECTS in gameConfig).
 */
function DyingHull({ ship, session, seconds, onGone }) {
    const groupRef = useRef(null);
    const elapsed = useRef(0);

    useFrame(() => {
        const group = groupRef.current;
        const dt = session.effectsDelta;
        if (!group || dt <= 0) return;
        elapsed.current += dt;
        if (elapsed.current >= seconds) {
            group.visible = false;
            onGone(ship);
            return;
        }
        group.position.addScaledVector(ship.velocity, dt);
        group.rotateZ(DYING_ROLL * dt);
        group.rotateX(DYING_ROLL * 0.4 * dt);
    });

    return (
        <group ref={groupRef} position={ship.position} quaternion={ship.quaternion}>
            <ShipModel modelId={ship.cls.model} faction={ship.faction} />
        </group>
    );
}

/** Renders every ship in the world; the player's own only when seen from outside. */
export default function ShipsLayer({ session }) {
    const roster = useGameStore((state) => state.roster);
    const [dying, setDying] = useState([]);

    useEffect(() => {
        const { events } = session.world;
        const unsubscribe = [
            events.on(GAME_EVENTS.SHIP_DESTROYED, ({ ship }) => {
                const kind = ship.cls.kind;
                if (!ship.cls.model || (kind !== 'capital' && kind !== 'station')) return;
                const huge = ship.boundingRadius * 1.3 > EFFECTS.hugeExplosionSize;
                setDying((list) => [...list, { ship, seconds: huge ? EFFECTS.hugeBreakupSeconds : EFFECTS.breakupSeconds }]);
            }),
            events.on(GAME_EVENTS.SECTOR_CHANGED, () => setDying([])),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session]);

    const removeDying = (ship) => setDying((list) => list.filter((entry) => entry.ship !== ship));

    return (
        <>
            <PlayerShipView session={session} />
            {roster
                .filter((ship) => ship.cls.model)
                .map((ship) => <ShipView key={ship.id} ship={ship} world={session.world} />)}
            {dying.map(({ ship, seconds }) => (
                <DyingHull key={ship.id} ship={ship} session={session} seconds={seconds} onGone={removeDying} />
            ))}
        </>
    );
}
