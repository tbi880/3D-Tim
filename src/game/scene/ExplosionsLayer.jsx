import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EFFECTS, FACTION } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { DebrisSystem } from './effects/DebrisSystem.js';
import { FireballSystem } from './effects/FireballSystem.js';
import { ParticleSystem, randomDirection } from './effects/ParticleSystem.js';

/**
 * Explosions, impact sparks and warp flashes, all fed by simulation events.
 *
 * An explosion is built from six pooled ingredients:
 *   fireballs - boiling fire that cools into smoke (FireballSystem)
 *   sparks    - small bright points flung outwards (ParticleSystem)
 *   debris    - tumbling chunks of hull or rock (DebrisSystem)
 *   flashes   - a soft burst of light facing the camera, gone in a fraction of a second
 *   rings     - a thin shock ring racing outwards (large ships, warp arrivals)
 *   lights    - real point lights that briefly illuminate nearby hulls and rocks
 *
 * A fighter dies in one blast. A capital ship breaks up first: its hull stays on screen for
 * a few seconds (ShipsLayer keeps it) while blasts walk along it, then the main explosion
 * replaces it with wreckage.
 */

const MAX_SPARKS = 2400;
const MAX_PUFFS = 240;
const MAX_CHUNKS = 340;
const MAX_FLASHES = 12;
const MAX_RINGS = 10;
const MAX_LIGHTS = 2;
const SPARK_COOLDOWN = 0.03;
const FLASH_INDICES = Array.from({ length: MAX_FLASHES }, (_, index) => index);
const RING_INDICES = Array.from({ length: MAX_RINGS }, (_, index) => index);
const LIGHT_INDICES = Array.from({ length: MAX_LIGHTS }, (_, index) => index);

/**
 * Limits for the biggest explosions. A station is kilometres across; a fireball scaled
 * straight from that would swallow the camera in white, so past these sizes a ship dies in
 * more blasts rather than bigger ones.
 */
const MAX_FIREBALL = 420;
const MAX_FLASH = 520;
/** Largest flash (metres) a ship leaves when it drops out of warp; the ring still scales with the hull. */
const MAX_WARP_FLASH = 220;

const FIRE = new THREE.Color('#ffb04a');
const SPARK_COLORS = [new THREE.Color('#fff3c4'), new THREE.Color('#ffc46b'), new THREE.Color('#ff7a2e')];
const SHIELD_SPARK = new THREE.Color('#7fd8ff');
const HULL_SPARK = new THREE.Color('#ffb061');
const WARP_COLOR = new THREE.Color('#a8d8ff');
const ROCK_SPARKS = [new THREE.Color('#b08a5a'), new THREE.Color('#ffd9a0')];
const ROCK_COLOR = '#6e645b';
const DEBRIS_COLORS = Object.freeze({
    [FACTION.DAWN]: '#8f98a4',
    [FACTION.UMBRA]: '#3c3542',
    [FACTION.NEUTRAL]: '#6b6c72',
});
const WHITE = new THREE.Color(1, 1, 1);

const FLASH_VERTEX_SHADER = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vCorner;
    void main() {
        vCorner = position.xy * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

/** A soft burst: blinding in the middle, fading smoothly to nothing at the edge. */
const FLASH_FRAGMENT_SHADER = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float strength;
    varying vec2 vCorner;
    void main() {
        #include <logdepthbuf_fragment>
        float r = length( vCorner );
        float glow = pow( max( 0.0, 1.0 - r ), 2.6 );
        gl_FragColor = vec4( tint * glow * strength, 1.0 );
    }
`;

/** One pooled flash: its own material, so each can have its own colour and strength. */
class FlashBurst {
    constructor() {
        this.material = new THREE.ShaderMaterial({
            vertexShader: FLASH_VERTEX_SHADER,
            fragmentShader: FLASH_FRAGMENT_SHADER,
            uniforms: { tint: { value: new THREE.Color() }, strength: { value: 0 } },
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
        });
    }

    setTint(color) {
        this.material.uniforms.tint.value.copy(color);
    }

    setStrength(strength) {
        this.material.uniforms.strength.value = strength;
    }

    dispose() {
        this.material.dispose();
    }
}

const scratchVector = new THREE.Vector3();
const scratchVelocity = new THREE.Vector3();
const scratchColor = new THREE.Color();
const ZERO = new THREE.Vector3();

/** A random point inside a ship's hull (its hit boxes), in world space. */
function randomHullPoint(ship, out) {
    if (!ship.boxes) return randomDirection(out).multiplyScalar(ship.radius * 0.6 * Math.random()).add(ship.position);
    const box = ship.boxes[Math.floor(Math.random() * ship.boxes.length)];
    out.set((Math.random() * 2 - 1) * box.half.x, (Math.random() * 2 - 1) * box.half.y, (Math.random() * 2 - 1) * box.half.z)
        .multiplyScalar(0.85).add(box.centre);
    return out.applyQuaternion(ship.quaternion).add(ship.position);
}

export default function ExplosionsLayer({ session }) {
    const sparks = useMemo(() => new ParticleSystem(MAX_SPARKS), []);
    const fire = useMemo(() => new FireballSystem(MAX_PUFFS), []);
    const debris = useMemo(() => new DebrisSystem(MAX_CHUNKS), []);
    const bursts = useMemo(() => FLASH_INDICES.map(() => new FlashBurst()), []);

    const flashRefs = useRef([]);
    const flashes = useRef(FLASH_INDICES.map(() => ({ life: 0, maxLife: 1, size: 1 })));
    const flashCursor = useRef(0);
    const ringRefs = useRef([]);
    const rings = useRef(RING_INDICES.map(() => ({ life: 0, maxLife: 1, size: 1, faceCamera: true })));
    const ringCursor = useRef(0);
    const lightRefs = useRef([]);
    const lights = useRef(LIGHT_INDICES.map(() => ({ life: 0, maxLife: 1, peak: 0 })));
    const lightCursor = useRef(0);
    /** Things that happen a moment later: { delay, run() }. */
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
            bursts[index].setTint(color);
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

        /** Lights everything within a few blast radii for a moment. */
        const startLight = (position, size, color) => {
            const index = lightCursor.current;
            lightCursor.current = (index + 1) % MAX_LIGHTS;
            const light = lightRefs.current[index];
            if (!light) return;
            const reach = size * 7;
            light.position.copy(position);
            light.color.copy(color);
            light.distance = reach;
            // With inverse-square falloff the intensity must grow with the square of the reach.
            Object.assign(lights.current[index], { life: 0.9, maxLife: 0.9, peak: 5 * (size * 1.6) ** 2 });
        };

        /**
         * One blast of radius `size` metres: flash, fire, sparks, and wreckage if `chunks` is given.
         * `tint` colours the fire (torpedoes burn in their faction's colour).
         */
        const blast = (position, size, { tint = WHITE, chunks = null, lit = true, drift = ZERO } = {}) => {
            const radius = Math.min(size, MAX_FIREBALL);
            startFlash(position, Math.min(size * 3.2, MAX_FLASH), 0.28 + Math.min(0.3, size / 600), scratchColor.copy(FIRE).lerp(tint, 0.5));
            if (lit && size > 6) startLight(position, radius, FIRE);

            // A hot core plus a shell of billowing puffs around it.
            const puffs = Math.round(Math.min(12, 5 + size / 14));
            const seconds = Math.min(4, 1.5 + size / 80);
            fire.spawn(position, drift, { radius: radius * 0.75, growth: 2.1, life: seconds * 0.7, heat: 1.25, tint });
            for (let i = 0; i < puffs; i++) {
                randomDirection(scratchVector);
                scratchVelocity.copy(scratchVector).multiplyScalar(radius * (0.25 + Math.random() * 0.5)).add(drift);
                scratchVector.multiplyScalar(radius * 0.4 * Math.random()).add(position);
                fire.spawn(scratchVector, scratchVelocity, {
                    radius: radius * (0.4 + Math.random() * 0.45), growth: 2.4, life: seconds * (0.7 + Math.random() * 0.6),
                    heat: 0.75 + Math.random() * 0.4, tint,
                });
            }
            sparks.emit(position, {
                count: Math.round(Math.min(200, 26 + size * 1.6)),
                speed: Math.min(size * 3.2, 900),
                life: Math.min(2.2, 0.7 + size / 120),
                size: THREE.MathUtils.clamp(size * 0.09, 0.7, 26),
                colors: SPARK_COLORS,
            });
            if (chunks) debris.emit(position, { ...chunks, drift });
        };

        /** The slow death of a capital ship: blasts along the hull, then the main explosion. */
        const breakUp = (ship, size) => {
            const huge = size > EFFECTS.hugeExplosionSize;
            const seconds = huge ? EFFECTS.hugeBreakupSeconds : EFFECTS.breakupSeconds;
            const color = DEBRIS_COLORS[ship.faction] ?? DEBRIS_COLORS[FACTION.NEUTRAL];
            const drift = ship.velocity.clone();
            const blasts = huge ? 16 : 8;
            for (let i = 0; i < blasts; i++) {
                pending.current.push({
                    delay: (i / blasts) * seconds * 0.95 + Math.random() * 0.12,
                    run: () => {
                        const chunkSize = Math.min(34, size * 0.03);
                        blast(randomHullPoint(ship, new THREE.Vector3()), size * (0.1 + Math.random() * 0.14), {
                            drift, lit: i % 3 === 0,
                            chunks: { count: 5, size: chunkSize, speed: size * 0.2, life: 9, color, heat: 1, spread: size * 0.04 },
                        });
                    },
                });
            }
            pending.current.push({
                delay: seconds,
                run: () => {
                    const centre = ship.position.clone();
                    blast(centre, size * 0.55, { drift });
                    startRing(centre, size * 3.2, huge ? 3.4 : 1.8, FIRE);
                    // The hull itself comes apart: big plates from all along it, small pieces from the middle.
                    for (let i = 0; i < (huge ? 10 : 5); i++) {
                        debris.emit(randomHullPoint(ship, scratchVector), {
                            count: huge ? 9 : 7, size: Math.min(150, size * 0.075), speed: size * 0.12, life: 15, color, heat: 0.7,
                            spread: size * 0.08, drift,
                        });
                    }
                    debris.emit(centre, { count: 40, size: Math.min(26, size * 0.02), speed: size * 0.45, life: 10, color, heat: 1, spread: size * 0.2, drift });
                },
            });
        };

        const unsubscribe = [
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size, capital, color, ship }) => {
                if (capital && ship) {
                    breakUp(ship, size);
                    return;
                }
                const tint = color ? new THREE.Color(color).lerp(WHITE, 0.35) : WHITE;
                const chunks = ship
                    ? { count: Math.round(Math.min(26, 9 + size * 0.25)), size: size * 0.07, speed: size * 1.5, life: 8, heat: 1, spread: size * 0.2,
                        color: DEBRIS_COLORS[ship.faction] ?? DEBRIS_COLORS[FACTION.NEUTRAL] }
                    : null;
                const drift = ship ? ship.velocity.clone().multiplyScalar(0.5) : ZERO;
                blast(position, size, { tint, chunks, drift });
                if (ship) {
                    // A second, smaller detonation a beat later (fuel, magazines) makes a kill feel like one.
                    const offset = randomDirection(new THREE.Vector3()).multiplyScalar(size * 0.5).add(position);
                    pending.current.push({ delay: 0.16 + Math.random() * 0.12, run: () => blast(offset, size * 0.65, { drift, lit: false }) });
                }
            }),
            world.events.on(GAME_EVENTS.HIT, ({ position, shield }) => {
                if (world.time - lastSparkAt.current < SPARK_COOLDOWN) return;
                lastSparkAt.current = world.time;
                sparks.emit(position, { count: 6, speed: 34, life: 0.45, size: 1.6, colors: [shield ? SHIELD_SPARK : HULL_SPARK] });
            }),
            world.events.on(GAME_EVENTS.WARP_FLASH, ({ position, size, quaternion }) => {
                // Capped, or a dreadnought dropping out of warp would white out the whole view.
                startFlash(position, Math.min(size * 1.8, MAX_WARP_FLASH * 2), 0.45, WARP_COLOR);
                startRing(position, size * 2.6, 0.9, WARP_COLOR, quaternion);
                sparks.emit(position, { count: 36, speed: size * 1.6, life: 0.7, size: Math.min(30, size * 0.08), colors: [WARP_COLOR] });
            }),
            // After a jump nothing from the old sector should hang in the new sky.
            world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => {
                for (const flash of flashes.current) flash.life = 0;
                for (const ring of rings.current) ring.life = 0;
                for (const light of lights.current) light.life = 0;
                pending.current = [];
                sparks.clear();
                fire.clear();
                debris.clear();
            }),
            world.events.on(GAME_EVENTS.OBSTACLE_DESTROYED, ({ position, radius }) => {
                // Rock does not burn: a puff of dust, grit and tumbling fragments.
                startFlash(position, radius * 2.2, 0.25, ROCK_SPARKS[1]);
                for (let i = 0; i < 5; i++) {
                    randomDirection(scratchVector);
                    scratchVelocity.copy(scratchVector).multiplyScalar(radius * 0.5);
                    fire.spawn(scratchVector.multiplyScalar(radius * 0.4).add(position), scratchVelocity, {
                        radius: radius * 0.5, growth: 2.6, life: 2.2 + Math.random(), heat: 0.12,
                    });
                }
                sparks.emit(position, { count: Math.round(14 + radius), speed: radius * 2.4, life: 1.1, size: Math.max(0.8, radius * 0.07), colors: ROCK_SPARKS });
                debris.emit(position, {
                    count: Math.round(Math.min(18, 6 + radius * 0.25)), size: radius * 0.16, speed: radius * 0.9, life: 9, color: ROCK_COLOR, spread: radius * 0.5,
                });
            }),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session, sparks, fire, debris, bursts]);

    useEffect(() => () => {
        sparks.dispose();
        fire.dispose();
        debris.dispose();
        bursts.forEach((burst) => burst.dispose());
    }, [sparks, fire, debris, bursts]);

    useFrame(({ size, camera }) => {
        const dt = session.effectsDelta;
        sparks.setPixelScale(size.height, camera.fov);
        if (dt <= 0) return;

        if (pending.current.length > 0) {
            const due = [];
            pending.current = pending.current.filter((item) => {
                item.delay -= dt;
                if (item.delay <= 0) due.push(item);
                return item.delay > 0;
            });
            for (const item of due) item.run();
        }

        sparks.update(dt);
        fire.update(dt);
        debris.update(dt);

        for (let i = 0; i < MAX_FLASHES; i++) {
            const flash = flashes.current[i];
            const mesh = flashRefs.current[i];
            if (!mesh) continue;
            flash.life -= dt;
            mesh.visible = flash.life > 0;
            if (!mesh.visible) continue;
            const progress = 1 - flash.life / flash.maxLife;
            mesh.scale.setScalar(flash.size * (0.5 + 0.5 * Math.sqrt(progress)));
            mesh.quaternion.copy(camera.quaternion);
            bursts[i].setStrength(7 * (1 - progress) ** 2);
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
            mesh.material.opacity = 0.55 * (1 - progress) ** 1.5;
            if (ring.faceCamera) mesh.quaternion.copy(camera.quaternion);
        }

        for (let i = 0; i < MAX_LIGHTS; i++) {
            const state = lights.current[i];
            const light = lightRefs.current[i];
            if (!light) continue;
            state.life = Math.max(0, state.life - dt);
            light.intensity = state.peak * (state.life / state.maxLife) ** 2;
        }
    });

    return (
        <>
            <points geometry={sparks.geometry} material={sparks.material} frustumCulled={false} />
            <mesh geometry={fire.geometry} material={fire.material} frustumCulled={false} renderOrder={2} />
            <primitive object={debris.mesh} />
            {FLASH_INDICES.map((index) => (
                <mesh key={index} ref={(mesh) => { flashRefs.current[index] = mesh; }} material={bursts[index].material} visible={false} renderOrder={3}>
                    <planeGeometry args={[1, 1]} />
                </mesh>
            ))}
            {RING_INDICES.map((index) => (
                <mesh key={index} ref={(mesh) => { ringRefs.current[index] = mesh; }} visible={false}>
                    <ringGeometry args={[0.972, 1, 128]} />
                    <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
                </mesh>
            ))}
            {/* Always mounted (at zero intensity when idle) so the number of lights never changes mid-battle. */}
            {LIGHT_INDICES.map((index) => (
                <pointLight key={index} ref={(light) => { lightRefs.current[index] = light; }} intensity={0} decay={2} distance={1} />
            ))}
        </>
    );
}
