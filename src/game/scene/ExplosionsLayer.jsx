import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ABILITIES, ABILITY_PHASE, PASSIVES } from '../config/abilities.js';
import { EFFECTS, FACTION } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { areHostile } from '../core/systems/damage.js';
import { breakupPose, breakupSeconds } from './effects/breakup.js';
import { DebrisSystem } from './effects/DebrisSystem.js';
import { FireballSystem } from './effects/FireballSystem.js';
import { shownImpact } from './effects/impactPoint.js';
import { ParticleSystem, randomDirection } from './effects/ParticleSystem.js';
import { HULL_WRECKAGE, ROCK_WRECKAGE, SHIP_WRECKAGE } from './effects/wreckageShapes.js';
import { ModelErrorBoundary, useHullTextures } from './models/ShipModel.jsx';
import { viewPose } from './viewPose.js';

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
const MAX_CHUNKS = 420;
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
const HULL_SPARK = new THREE.Color('#ffb061');
const WARP_COLOR = new THREE.Color('#a8d8ff');
const ROCK_SPARKS = [new THREE.Color('#b08a5a'), new THREE.Color('#ffd9a0')];
const ROCK_COLORS = ['#6e645b', '#5a524b', '#7d7268'];
/** The paints of each fleet (hull, secondary panels), so wreckage matches the ship it came from. */
const WRECKAGE_COLORS = Object.freeze({
    [FACTION.DAWN]: ['#a3acb8', '#a3acb8', '#5d6c7e'],
    [FACTION.UMBRA]: ['#4a4654', '#4a4654', '#5a2535'],
    [FACTION.NEUTRAL]: ['#6b6c72', '#55565c'],
});
const wreckageColors = (ship) => WRECKAGE_COLORS[ship.faction] ?? WRECKAGE_COLORS[FACTION.NEUTRAL];
const WHITE = new THREE.Color(1, 1, 1);
/** A breach warhead's blast (the colour of the torpedo, config/weapons.js) and a cloak switching on or off. */
const BREACH_COLOR = new THREE.Color('#ffa24a');
const CLOAK_COLOR = new THREE.Color('#8ff2ff');
/** A reactor going up (the Bulwark's passive): the blue-white of its first flash, and the size (metres) of the fireball that follows. */
const REACTOR_COLOR = new THREE.Color('#cfe6ff');
const REACTOR_FIREBALL = 90;

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
const scratchHullPosition = new THREE.Vector3();
const scratchHullQuaternion = new THREE.Quaternion();
const ZERO = new THREE.Vector3();

/** A random point inside a ship's hull (its hit boxes), in the ship's own axes. */
function randomHullPoint(ship, out) {
    if (!ship.boxes) return randomDirection(out).multiplyScalar(ship.radius * 0.6 * Math.random());
    const box = ship.boxes[Math.floor(Math.random() * ship.boxes.length)];
    return out.set((Math.random() * 2 - 1) * box.half.x, (Math.random() * 2 - 1) * box.half.y, (Math.random() * 2 - 1) * box.half.z)
        .multiplyScalar(0.85).add(box.centre);
}

function Effects({ session, textures }) {
    const sparks = useMemo(() => new ParticleSystem(MAX_SPARKS), []);
    const fire = useMemo(() => new FireballSystem(MAX_PUFFS), []);
    const debris = useMemo(() => new DebrisSystem(MAX_CHUNKS, textures), [textures]);
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
    /** Capital ships in the middle of breaking up, and the function (made in the effect below) that advances one. */
    const breakups = useRef([]);
    const advanceBreakUpRef = useRef(null);
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

        /**
         * The slow death of a capital ship. For a few seconds the powerless hull drifts and
         * starts to tumble (see effects/breakup.js) while it burns: fires that stay with the
         * hull, blasts that walk along it, showers of sparks. Then the main explosion replaces
         * it with wreckage.
         */
        const breakUp = (ship, size) => {
            const huge = size > EFFECTS.hugeExplosionSize;
            const seconds = breakupSeconds(ship);
            const fires = Array.from({ length: huge ? 9 : 6 }, () => ({
                local: randomHullPoint(ship, new THREE.Vector3()), size: size * (0.035 + Math.random() * 0.035), startsAt: Math.random() * seconds * 0.6,
            }));
            const blastCount = huge ? 18 : 10;
            // Sparse at first, then faster and bigger as the hull gives way.
            const blasts = Array.from({ length: blastCount }, (_, index) => ({
                at: (index / blastCount) ** 0.8 * seconds * 0.96 + Math.random() * 0.15,
                local: randomHullPoint(ship, new THREE.Vector3()), size: size * (0.09 + Math.random() * 0.13) * (0.7 + 0.6 * index / blastCount),
            }));
            breakups.current.push({ ship, size, huge, seconds, elapsed: 0, fires, blasts, nextFlame: 0, colors: wreckageColors(ship) });
        };

        /** Runs one dying hull for a frame; returns false once it has exploded. */
        const advanceBreakUp = (state, dt) => {
            const { ship, size, huge, colors } = state;
            state.elapsed += dt;
            breakupPose(ship, state.elapsed, scratchHullPosition, scratchHullQuaternion);
            const toWorld = (local, out) => out.copy(local).applyQuaternion(scratchHullQuaternion).add(scratchHullPosition);
            const drift = ship.velocity;

            if (state.elapsed < state.seconds) {
                // Fires: a steady stream of small flames from each burning point.
                state.nextFlame -= dt;
                if (state.nextFlame <= 0) {
                    state.nextFlame = 0.09;
                    for (const flame of state.fires) {
                        if (state.elapsed < flame.startsAt) continue;
                        toWorld(flame.local, scratchVector);
                        randomDirection(scratchVelocity).multiplyScalar(flame.size * 0.5).add(drift);
                        fire.spawn(scratchVector, scratchVelocity, { radius: flame.size, growth: 2.6, life: 1.5 + Math.random() * 0.8, heat: 0.95 });
                        if (Math.random() < 0.3) {
                            sparks.emit(scratchVector, { count: 8, speed: flame.size * 5, life: 0.9, size: THREE.MathUtils.clamp(flame.size * 0.12, 0.8, 9), colors: SPARK_COLORS });
                        }
                    }
                }
                // Blasts walking along the hull, each throwing off a little wreckage.
                while (state.blasts.length > 0 && state.blasts[0].at <= state.elapsed) {
                    const next = state.blasts.shift();
                    blast(toWorld(next.local, new THREE.Vector3()), next.size, {
                        drift, lit: state.blasts.length % 3 === 0,
                        chunks: { count: 6, size: Math.min(30, size * 0.028), speed: size * 0.16, life: 10, shapes: SHIP_WRECKAGE, colors, heat: 1, spread: next.size * 0.3 },
                    });
                }
                return true;
            }

            // The end: one great blast, and the hull is replaced by what is left of it.
            const centre = scratchHullPosition.clone();
            blast(centre, size * 0.6, { drift });
            startRing(centre, size * 3.2, huge ? 3.6 : 2, FIRE);
            // Plates and hull sections from all along the ship: big, slow, long-lived...
            for (let i = 0; i < (huge ? 12 : 7); i++) {
                debris.emit(toWorld(randomHullPoint(ship, scratchVector), scratchVector), {
                    count: huge ? 7 : 6, size: Math.min(170, size * 0.085), speed: size * 0.05, life: 22, shapes: HULL_WRECKAGE, colors, heat: 0.6,
                    spread: size * 0.06, drift,
                });
            }
            // ...and a cloud of small fragments blown far out from the middle.
            debris.emit(centre, { count: 70, size: Math.min(22, size * 0.018), speed: size * 0.4, life: 12, shapes: SHIP_WRECKAGE, colors, heat: 1, spread: size * 0.25, drift });
            return false;
        };

        advanceBreakUpRef.current = advanceBreakUp;

        const unsubscribe = [
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size, capital, color, ship }) => {
                if (capital && ship) {
                    breakUp(ship, size);
                    return;
                }
                const tint = color ? new THREE.Color(color).lerp(WHITE, 0.35) : WHITE;
                const chunks = ship
                    ? { count: Math.round(Math.min(30, 12 + size * 0.3)), size: size * 0.11, speed: size * 1.1, life: 11, heat: 1, spread: size * 0.2,
                        shapes: SHIP_WRECKAGE, colors: wreckageColors(ship) }
                    : null;
                const drift = ship ? ship.velocity.clone().multiplyScalar(0.5) : ZERO;
                blast(position, size, { tint, chunks, drift });
                if (ship) {
                    // A second, smaller detonation a beat later (fuel, magazines) makes a kill feel like one.
                    const offset = randomDirection(new THREE.Vector3()).multiplyScalar(size * 0.5).add(position);
                    pending.current.push({ delay: 0.16 + Math.random() * 0.12, run: () => blast(offset, size * 0.65, { drift, lit: false }) });
                }
            }),
            // Sparks where a shot bites into bare hull. (One stopped by a shield melts into it
            // and breaks up instead: ProjectilesLayer.)
            world.events.on(GAME_EVENTS.HIT, ({ target, position, shield }) => {
                if (shield || world.time - lastSparkAt.current < SPARK_COOLDOWN) return;
                lastSparkAt.current = world.time;
                // From the cockpit the pilot's own hull sparks out on its skin, not round the seat.
                sparks.emit(shownImpact(session, target, position, false, scratchVector), { count: 6, speed: 34, life: 0.45, size: 1.6, colors: [HULL_SPARK] });
            }),
            world.events.on(GAME_EVENTS.WARP_FLASH, ({ position, size, quaternion }) => {
                // Capped, or a dreadnought dropping out of warp would white out the whole view.
                startFlash(position, Math.min(size * 1.8, MAX_WARP_FLASH * 2), 0.45, WARP_COLOR);
                startRing(position, size * 2.6, 0.9, WARP_COLOR, quaternion);
                sparks.emit(position, { count: 36, speed: size * 1.6, life: 0.7, size: Math.min(30, size * 0.08), colors: [WARP_COLOR] });
            }),
            // Abilities (config/abilities.js). A breach warhead: a hard flash, and a ring that races out
            // to exactly where its blast reaches. A dying Bulwark's reactor: a blue-white flash, a
            // fireball the size of a frigate's and two rings out to where it reaches. A cloak going
            // on or off and a dash starting: a small flash and ring at the ship. All from the pools
            // above, so they cost nothing new.
            world.events.on(GAME_EVENTS.ABILITY, ({ ship, ability, phase, position, radius }) => {
                if (phase === ABILITY_PHASE.BLAST && PASSIVES[ability]?.kind === 'deathBlast') {
                    startFlash(position, MAX_FLASH, 0.7, REACTOR_COLOR);
                    startLight(position, REACTOR_FIREBALL, REACTOR_COLOR);
                    startRing(position, radius, 1.3, REACTOR_COLOR);
                    // The fire comes a beat after the flash, with the second, slower ring.
                    pending.current.push({
                        delay: 0.12,
                        run: () => {
                            blast(position, REACTOR_FIREBALL, { lit: false });
                            startRing(position, radius, 2, FIRE);
                        },
                    });
                    return;
                }
                if (phase === ABILITY_PHASE.BLAST) {
                    startFlash(position, MAX_FLASH, 0.5, BREACH_COLOR);
                    startLight(position, 60, BREACH_COLOR);
                    startRing(position, radius, 1.1, BREACH_COLOR);
                    startRing(position, radius * 0.45, 0.7, WHITE);
                    sparks.emit(position, { count: 40, speed: 420, life: 0.8, size: 9, colors: [BREACH_COLOR] });
                    return;
                }
                const kind = ABILITIES[ability]?.kind;
                if (!ship?.alive || (kind !== 'cloak' && kind !== 'overdrive')) return;
                // A hostile cloak going on is not announced with a flash where the ship is hiding.
                if (kind === 'cloak' && ship !== world.player && world.player && areHostile(world.player, ship) && phase === ABILITY_PHASE.START) return;
                const size = ship.boundingRadius;
                if (kind === 'cloak') {
                    startFlash(ship.position, size * 5, 0.35, CLOAK_COLOR);
                    startRing(ship.position, size * 4, 0.6, CLOAK_COLOR);
                } else if (phase === ABILITY_PHASE.START) {
                    startFlash(ship.position, size * 4, 0.3, WARP_COLOR);
                    startRing(ship.position, size * 5, 0.5, WARP_COLOR, ship.quaternion);
                }
            }),
            // After a jump nothing from the old sector should hang in the new sky.
            world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => {
                for (const flash of flashes.current) flash.life = 0;
                for (const ring of rings.current) ring.life = 0;
                for (const light of lights.current) light.life = 0;
                pending.current = [];
                breakups.current = [];
                sparks.clear();
                fire.clear();
                debris.clear();
            }),
            world.events.on(GAME_EVENTS.OBSTACLE_DESTROYED, ({ position, radius }) => {
                // Rock does not burn, but it goes with a bang: a hard flash, a brief hot core,
                // a rolling cloud of dust, grit and a spray of tumbling fragments.
                startFlash(position, radius * 4.5, 0.32, ROCK_SPARKS[1]);
                startLight(position, radius * 0.8, ROCK_SPARKS[1]);
                fire.spawn(position, ZERO, { radius: radius * 0.7, growth: 1.9, life: 0.7, heat: 0.85 });
                for (let i = 0; i < 9; i++) {
                    randomDirection(scratchVector);
                    scratchVelocity.copy(scratchVector).multiplyScalar(radius * (0.5 + Math.random() * 0.7));
                    fire.spawn(scratchVector.multiplyScalar(radius * 0.5).add(position), scratchVelocity, {
                        radius: radius * (0.5 + Math.random() * 0.4), growth: 2.8, life: 2.6 + Math.random() * 1.4, heat: 0.14,
                    });
                }
                sparks.emit(position, { count: Math.round(Math.min(120, 30 + radius * 2)), speed: radius * 3.2, life: 1.4, size: Math.max(0.9, radius * 0.08), colors: ROCK_SPARKS });
                debris.emit(position, {
                    count: Math.round(Math.min(34, 12 + radius * 0.5)), size: radius * 0.2, speed: radius * 0.9, life: 11, shapes: ROCK_WRECKAGE, colors: ROCK_COLORS,
                    spread: radius * 0.6,
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

    useFrame(() => {
        const dt = session.effectsDelta;
        // The eye's pose, not state.camera: in VR that camera's pose is relative to the seat.
        const camera = viewPose;
        sparks.setPixelScale(viewPose.pixelHeight, viewPose.fov);
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

        if (breakups.current.length > 0) breakups.current = breakups.current.filter((state) => advanceBreakUpRef.current(state, dt));

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
            {debris.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
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

function TexturedEffects({ session }) {
    return <Effects session={session} textures={useHullTextures()} />;
}

/** All explosion effects; without the plating textures the wreckage is simply plain metal. */
export default function ExplosionsLayer({ session }) {
    return (
        <ModelErrorBoundary fallback={<Effects session={session} textures={null} />}>
            <Suspense fallback={null}>
                <TexturedEffects session={session} />
            </Suspense>
        </ModelErrorBoundary>
    );
}
