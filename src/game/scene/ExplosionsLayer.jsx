import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { ParticleSystem, randomDirection } from './effects/ParticleSystem.js';

/**
 * Explosions, impact sparks and warp flashes.
 *
 * Three pooled systems, all fed by simulation events:
 *  - a ParticleSystem ring buffer (debris, sparks, fire);
 *  - a handful of expanding "flash" spheres (the initial fireball / warp-in burst);
 *  - expanding shock rings (warp arrivals and departures, capital ship deaths).
 */

const MAX_PARTICLES = 2400;
const MAX_FLASHES = 14;
const MAX_RINGS = 10;
const SPARK_COOLDOWN = 0.03;
const FLASH_INDICES = Array.from({ length: MAX_FLASHES }, (_, index) => index);
const RING_INDICES = Array.from({ length: MAX_RINGS }, (_, index) => index);

const FIRE_COLORS = [new THREE.Color('#fff3c4'), new THREE.Color('#ffb347'), new THREE.Color('#ff5a1f')];
const SHIELD_SPARK = new THREE.Color('#7fd8ff');
const HULL_SPARK = new THREE.Color('#ffb061');
/** Largest flash (metres) a ship leaves when it drops out of warp; the ring still scales with the hull. */
const MAX_WARP_FLASH = 220;
/**
 * Limits for the biggest explosions. A station is kilometres across; a fireball and sparks
 * scaled straight from that would swallow the camera in white for many seconds, so past
 * these sizes a ship dies in more blasts rather than bigger ones.
 */
const MAX_FIREBALL = 650;
const MAX_FIREBALL_SECONDS = 1.8;
const MAX_PARTICLE_SIZE = 150;
const MAX_PARTICLE_SPEED = 800;
const MAX_PARTICLE_SECONDS = 4;
/** Hulls with an explosion size above this break up in a long chain of secondary blasts. */
const HUGE_EXPLOSION = 600;
const WARP_COLOR = new THREE.Color('#a8d8ff');
const ROCK_COLORS = [new THREE.Color('#b08a5a'), new THREE.Color('#7d6a58'), new THREE.Color('#ffd9a0')];
const scratchColor = new THREE.Color();

export default function ExplosionsLayer({ session }) {
    const system = useMemo(() => new ParticleSystem(MAX_PARTICLES), []);
    const flashRefs = useRef([]);
    const flashes = useRef(FLASH_INDICES.map(() => ({ life: 0, maxLife: 1, size: 1 })));
    const flashCursor = useRef(0);
    const ringRefs = useRef([]);
    const rings = useRef(RING_INDICES.map(() => ({ life: 0, maxLife: 1, size: 1, faceCamera: true })));
    const ringCursor = useRef(0);
    /** Delayed secondary blasts for capital ships: { delay, position, size }. */
    const pending = useRef([]);
    const lastSparkAt = useRef(0);

    useEffect(() => {
        const world = session.world;

        const startFlash = (position, size, life, color) => {
            const index = flashCursor.current;
            flashCursor.current = (index + 1) % MAX_FLASHES;
            const mesh = flashRefs.current[index];
            if (!mesh) return;
            Object.assign(flashes.current[index], { life, maxLife: life, size });
            mesh.position.copy(position);
            mesh.material.color.copy(color).multiplyScalar(2);
        };

        /** A thin ring that races outwards. With a quaternion it lies across that ship's path; otherwise it faces the camera. */
        const startRing = (position, size, life, color, quaternion = null) => {
            const index = ringCursor.current;
            ringCursor.current = (index + 1) % MAX_RINGS;
            const mesh = ringRefs.current[index];
            if (!mesh) return;
            Object.assign(rings.current[index], { life, maxLife: life, size, faceCamera: !quaternion });
            mesh.position.copy(position);
            if (quaternion) mesh.quaternion.copy(quaternion);
            mesh.material.color.copy(color).multiplyScalar(1.6);
        };

        const explode = (position, size, tint) => {
            const colors = tint ? [scratchColor.set(tint).clone(), FIRE_COLORS[0]] : FIRE_COLORS;
            startFlash(position, Math.min(size * 1.6, MAX_FIREBALL), Math.min(0.35 + size / 260, MAX_FIREBALL_SECONDS), colors[0]);
            system.emit(position, {
                count: Math.round(Math.min(260, 24 + size * 1.8)),
                speed: Math.min(size * 1.5, MAX_PARTICLE_SPEED),
                life: Math.min(0.9 + size / 90, MAX_PARTICLE_SECONDS),
                size: Math.min(size * 0.5, MAX_PARTICLE_SIZE),
                colors,
            });
        };

        const unsubscribe = [
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size, capital, color }) => {
                explode(position, size, color);
                if (!capital) return;
                const huge = size > HUGE_EXPLOSION;
                startRing(position, size * 3.2, huge ? 3.2 : 1.6, FIRE_COLORS[0]);
                // Big ships tear themselves apart over a couple of seconds; the biggest take longer.
                const blasts = huge ? 18 : 7;
                for (let i = 0; i < blasts; i++) {
                    pending.current.push({
                        delay: 0.15 + i * 0.28,
                        position: position.clone().add(randomDirection(new THREE.Vector3()).multiplyScalar(size * 0.45 * Math.random())),
                        size: size * (0.25 + Math.random() * 0.35),
                    });
                }
            }),
            world.events.on(GAME_EVENTS.HIT, ({ position, shield }) => {
                if (world.time - lastSparkAt.current < SPARK_COOLDOWN) return;
                lastSparkAt.current = world.time;
                system.emit(position, { count: 5, speed: 26, life: 0.45, size: 3.2, colors: [shield ? SHIELD_SPARK : HULL_SPARK] });
            }),
            world.events.on(GAME_EVENTS.WARP_FLASH, ({ position, size, quaternion }) => {
                // Capped, or a dreadnought dropping out of warp would white out the whole view.
                startFlash(position, Math.min(size * 0.9, MAX_WARP_FLASH), 0.45, WARP_COLOR);
                startRing(position, size * 2.6, 0.9, WARP_COLOR, quaternion);
                system.emit(position, { count: 36, speed: size * 1.6, life: 0.7, size: Math.min(60, size * 0.18), colors: [WARP_COLOR] });
            }),
            // After a jump nothing from the old sector should hang in the new sky.
            world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => {
                for (const flash of flashes.current) flash.life = 0;
                for (const ring of rings.current) ring.life = 0;
                pending.current = [];
                system.clear();
            }),
            world.events.on(GAME_EVENTS.OBSTACLE_DESTROYED, ({ position, radius }) => {
                startFlash(position, radius * 1.3, 0.3, ROCK_COLORS[2]);
                system.emit(position, { count: Math.round(18 + radius * 1.6), speed: radius * 1.8, life: 1.3, size: radius * 0.45, colors: ROCK_COLORS });
            }),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session, system]);

    useEffect(() => () => system.dispose(), [system]);

    useFrame(({ size, camera }) => {
        const dt = session.effectsDelta;
        system.setPixelScale(size.height, camera.fov);
        if (dt <= 0) return;

        for (const blast of pending.current) {
            blast.delay -= dt;
            if (blast.delay <= 0) {
                system.emit(blast.position, {
                    count: 60,
                    speed: Math.min(blast.size * 1.6, MAX_PARTICLE_SPEED),
                    life: 1.1,
                    size: Math.min(blast.size * 0.5, MAX_PARTICLE_SIZE),
                    colors: FIRE_COLORS,
                });
            }
        }
        if (pending.current.length > 0) pending.current = pending.current.filter((blast) => blast.delay > 0);

        system.update(dt);

        for (let i = 0; i < MAX_FLASHES; i++) {
            const flash = flashes.current[i];
            const mesh = flashRefs.current[i];
            if (!mesh) continue;
            flash.life -= dt;
            mesh.visible = flash.life > 0;
            if (!mesh.visible) continue;
            const progress = 1 - flash.life / flash.maxLife;
            // Fast expansion that slows down, while fading out.
            mesh.scale.setScalar(flash.size * (0.25 + 0.75 * Math.sqrt(progress)));
            mesh.material.opacity = (1 - progress) ** 2;
        }

        for (let i = 0; i < MAX_RINGS; i++) {
            const ring = rings.current[i];
            const mesh = ringRefs.current[i];
            if (!mesh) continue;
            ring.life -= dt;
            mesh.visible = ring.life > 0;
            if (!mesh.visible) continue;
            const progress = 1 - ring.life / ring.maxLife;
            mesh.scale.setScalar(ring.size * (0.1 + 0.9 * (1 - (1 - progress) ** 3)));
            mesh.material.opacity = 0.9 * (1 - progress) ** 1.5;
            if (ring.faceCamera) mesh.quaternion.copy(camera.quaternion);
        }
    });

    return (
        <>
            <points geometry={system.geometry} material={system.material} frustumCulled={false} />
            {FLASH_INDICES.map((index) => (
                <mesh key={index} ref={(mesh) => { flashRefs.current[index] = mesh; }} visible={false}>
                    <sphereGeometry args={[1, 16, 12]} />
                    <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {RING_INDICES.map((index) => (
                <mesh key={index} ref={(mesh) => { ringRefs.current[index] = mesh; }} visible={false}>
                    <ringGeometry args={[0.9, 1, 64]} />
                    <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
                </mesh>
            ))}
        </>
    );
}
