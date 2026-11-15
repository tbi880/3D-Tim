import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTION } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { forwardOf } from '../core/math.js';
import { breakupPose, breakupSeconds } from './effects/breakup.js';
import { ExhaustPlume } from './effects/ExhaustPlume.js';
import { ShieldShell, shieldShells } from './effects/ShieldShell.js';
import { WARP_IN_DISTANCE, WARP_STRETCH, warpDisplacement } from './effects/warpPath.js';
import { useGameStore } from '../state/gameStore.js';
import ShipModel, { getModelInfo } from './models/ShipModel.jsx';
import { cameraModeOf } from '../xr/vrState.js';

const HALF_PI = Math.PI / 2;

const FACTION_COLORS = Object.freeze({
    [FACTION.DAWN]: { shield: '#59c8ff', engine: '#7fdcff' },
    [FACTION.UMBRA]: { shield: '#d04dff', engine: '#ff5c8f' },
    [FACTION.NEUTRAL]: { shield: '#ffffff', engine: '#ffd36b' },
    [FACTION.PIRATE]: { shield: '#ffb347', engine: '#ffc56b' },
});

const scratchForward = new THREE.Vector3();

// A unit cone with its base at the origin and its tip at +Z: scaled into an exhaust plume.
let plumeGeometry = null;
function getPlumeGeometry() {
    plumeGeometry ??= new THREE.ConeGeometry(1, 1, 10, 1, true).rotateX(HALF_PI).translate(0, 0, 0.5);
    return plumeGeometry;
}

/** How far a ship's shield stands off its hull, as a multiple of the hull's half-size. */
const SHIELD_STANDOFF = 1.45;

/** Half-size of a ship's shield shell along its own x, y, z. */
function shieldExtent(ship) {
    if (ship.cls.shieldExtents) return [...ship.cls.shieldExtents];
    if (ship.halfExtents) return ship.halfExtents.clone().multiplyScalar(SHIELD_STANDOFF).toArray();
    const size = ship.radius * 1.3;
    return [size, size, size];
}

/**
 * The shield around a ship: nothing to see until it is hit, then a patch of honeycomb
 * flares where the hit landed (effects/ShieldShell.js). ShipsLayer feeds it the hits.
 */
function Shield({ ship, world }) {
    const meshRef = useRef(null);
    const scale = useMemo(() => shieldExtent(ship), [ship]);
    const shell = useMemo(() => new ShieldShell(FACTION_COLORS[ship.faction].shield, scale), [ship, scale]);

    useEffect(() => {
        shieldShells.set(ship, shell);
        return () => {
            shieldShells.delete(ship);
            shell.dispose();
        };
    }, [ship, shell]);

    useFrame(() => {
        if (meshRef.current) meshRef.current.visible = shell.update(world.time);
    });

    return (
        <mesh ref={meshRef} scale={scale} material={shell.material} visible={false}>
            <sphereGeometry args={[1, 40, 28]} />
        </mesh>
    );
}

/** Shader-drawn exhaust for every engine of a ship, as one mesh (effects/ExhaustPlume.js). */
function Exhaust({ engines, faction, ship, session }) {
    const plume = useMemo(() => new ExhaustPlume(engines, FACTION_COLORS[faction].engine), [engines, faction]);
    useEffect(() => () => plume.dispose(), [plume]);

    useFrame(() => {
        const thrust = ship.cls.maxSpeed > 0 ? Math.min(1, ship.velocity.length() / ship.cls.maxSpeed) : 0.2;
        plume.update(0.12 + thrust * 0.88, session.world.time, session.effectsDelta);
    });

    return <primitive object={plume.mesh} />;
}

/**
 * Glowing cones whose length follows the thrust (0..~1.6), for a player ship model that
 * lists `engines` instead of carrying its own animated flames.
 */
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
    // Arriving: comes in from far behind along its own heading. Leaving: leaps forward.
    const displacement = warpDisplacement(ship);
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

/**
 * Thrust of a player-flown ship, for the flames its model carries: 0.15 idle .. 1 at top
 * speed .. 1.6 on the afterburner (coasting down from a burn stays capped there).
 */
function pilotThrust(ship) {
    if (!ship?.alive) return 0;
    return ship.boosting ? 1.6 : Math.min(1.6, 0.15 + (ship.speed / ship.cls.maxSpeed) * 0.85);
}

/** One ship: follows its simulation entity, with engine exhaust, shield and warp streak. */
function ShipView({ ship, session }) {
    const world = session.world;
    const groupRef = useRef(null);
    const streakRef = useRef(null);
    const info = getModelInfo(ship.cls.model);
    // Another player's ship (multiplayer): its model has its own flames, driven like the local ship's.
    const getThrust = ship.isPlayer ? () => pilotThrust(ship) : null;

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        group.quaternion.copy(ship.quaternion);
        applyWarpTransform(group, streakRef.current, ship);
    });

    const streakWidth = ship.boundingRadius * 0.12;

    return (
        <group ref={groupRef}>
            <ShipModel modelId={ship.cls.model} faction={ship.faction} getThrust={getThrust} />
            {info?.engines?.length > 0 && <Exhaust engines={info.engines} faction={ship.faction} ship={ship} session={session} />}
            {ship.maxShield > 0 && <Shield ship={ship} world={world} />}
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
    // Replaced on every new game or reload, which is also when a different ship may have been chosen.
    const player = useGameStore((state) => state.playerShip);
    const info = getModelInfo(player?.cls.model ?? 'kestrel');
    // Always the Federation's in single player; in multiplayer the side the player was dealt.
    const faction = player?.faction ?? FACTION.DAWN;

    useFrame(() => {
        const group = groupRef.current;
        if (!group || !player) return;
        group.visible = player.alive && cameraModeOf(session) === 'chase';
        group.position.copy(player.position);
        group.quaternion.copy(player.quaternion);
    });

    const getThrust = () => pilotThrust(player);

    return (
        <group ref={groupRef} visible={false}>
            <ShipModel modelId={player?.cls.model ?? 'kestrel'} faction={faction} getThrust={getThrust} />
            {info?.engines?.length > 0 && <EnginePlumes engines={info.engines} faction={faction} getThrust={getThrust} />}
            {player && <Shield key={player.id} ship={player} world={session.world} />}
        </group>
    );
}

/**
 * The hull of a capital ship that has just been destroyed. The simulation has already
 * removed it; the picture lingers - powerless, drifting, starting to tumble - while
 * ExplosionsLayer sets it on fire, and disappears in the main explosion (effects/breakup.js).
 */
function DyingHull({ ship, session, onGone }) {
    const groupRef = useRef(null);
    const elapsed = useRef(0);
    const seconds = breakupSeconds(ship);

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
        breakupPose(ship, elapsed.current, group.position, group.quaternion);
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
                setDying((list) => [...list, ship]);
            }),
            // Shields light up where they are struck.
            events.on(GAME_EVENTS.HIT, ({ target, position, shield }) => {
                if (shield && target) shieldShells.get(target)?.addHit(target, position, session.world.time);
            }),
            events.on(GAME_EVENTS.SECTOR_CHANGED, () => setDying([])),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session]);

    const removeDying = (ship) => setDying((list) => list.filter((entry) => entry !== ship));

    return (
        <>
            <PlayerShipView session={session} />
            {roster
                .filter((ship) => ship.cls.model)
                .map((ship) => <ShipView key={ship.id} ship={ship} session={session} />)}
            {dying.map((ship) => <DyingHull key={ship.id} ship={ship} session={session} onGone={removeDying} />)}
        </>
    );
}
