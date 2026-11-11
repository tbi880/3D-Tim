import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { ParticleSystem, randomDirection } from './effects/ParticleSystem.js';

/**
 * Explosions, impact sparks and warp flashes.
 *
 * Two pooled systems, both fed by simulation events:
 *  - a ParticleSystem ring buffer (debris, sparks, fire);
 *  - a handful of expanding "flash" spheres (the initial fireball / warp-in burst).
 */

const MAX_PARTICLES = 2400;
const MAX_FLASHES = 14;
const SPARK_COOLDOWN = 0.03;
const FLASH_INDICES = Array.from({ length: MAX_FLASHES }, (_, index) => index);

const FIRE_COLORS = [new THREE.Color('#fff3c4'), new THREE.Color('#ffb347'), new THREE.Color('#ff5a1f')];
const SHIELD_SPARK = new THREE.Color('#7fd8ff');
const HULL_SPARK = new THREE.Color('#ffb061');
const WARP_COLOR = new THREE.Color('#a8d8ff');
const scratchColor = new THREE.Color();

export default function ExplosionsLayer({ session }) {
    const system = useMemo(() => new ParticleSystem(MAX_PARTICLES), []);
    const flashRefs = useRef([]);
    const flashes = useRef(FLASH_INDICES.map(() => ({ life: 0, maxLife: 1, size: 1 })));
    const flashCursor = useRef(0);
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

        const explode = (position, size, tint) => {
            const colors = tint ? [scratchColor.set(tint).clone(), FIRE_COLORS[0]] : FIRE_COLORS;
            startFlash(position, size * 1.6, 0.35 + size / 260, colors[0]);
            system.emit(position, {
                count: Math.round(Math.min(260, 24 + size * 1.8)), speed: size * 1.5, life: 0.9 + size / 90, size: size * 0.5, colors,
            });
        };

        const unsubscribe = [
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size, capital, color }) => {
                explode(position, size, color);
                if (!capital) return;
                // Big ships tear themselves apart over a couple of seconds.
                for (let i = 0; i < 7; i++) {
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
            world.events.on(GAME_EVENTS.WARP_FLASH, ({ position, size }) => {
                startFlash(position, size * 1.4, 0.5, WARP_COLOR);
                system.emit(position, { count: 30, speed: size * 2, life: 0.6, size: size * 0.2, colors: [WARP_COLOR] });
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
                system.emit(blast.position, { count: 60, speed: blast.size * 1.6, life: 1.1, size: blast.size * 0.5, colors: FIRE_COLORS });
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
        </>
    );
}
