import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import { SECTORS } from '../config/sectors.js';
import { createRng } from '../core/math.js';
import { useGameStore } from '../state/gameStore.js';
import GltfModel from './models/GltfModel.jsx';

/**
 * How far from the camera distant bodies are drawn (see BackdropObject): far enough that
 * even a planet filling half the sky stays well beyond the edge of the battle.
 */
const SKY_DISTANCE = 400_000;
const STAR_DISTANCE = 800_000;
const NEBULA_RADIUS = 1_400_000;
const STAR_COUNT = 2800;
const DEFAULT_SECTOR = 'collapse';

const NEBULA_VERTEX_SHADER = /* glsl */ `
    varying vec3 vDirection;
    void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // The dome sits so close to the far plane that 32-bit rounding can push a vertex
        // just past it, and the far plane then clips whole triangles out of the sky (black,
        // straight-edged holes in the nebula). It is a pure background that ignores depth,
        // so park it in the middle of the depth range where nothing can clip it.
        gl_Position.z = 0.0;
    }
`;

/** Layered value noise: soft clouds in two colours, fading to black between them. */
const NEBULA_FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 colorA;
    uniform vec3 colorB;
    uniform float intensity;
    varying vec3 vDirection;

    float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
    }
    float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 4; i++) {
            value += amplitude * noise(p);
            p *= 2.03;
            amplitude *= 0.5;
        }
        return value;
    }
    void main() {
        vec3 dir = normalize(vDirection);
        float clouds = fbm(dir * 2.2 + 3.0);
        float wisps = fbm(dir * 5.5 - 7.0);
        float density = smoothstep(0.42, 0.85, clouds) * (0.55 + 0.45 * wisps);
        vec3 color = mix(colorA, colorB, smoothstep(0.3, 0.75, wisps)) * density * intensity;
        gl_FragColor = vec4(color, 1.0);
    }
`;

/** Thousands of pin-point stars at a fixed pixel size. */
function StarField() {
    const geometry = useMemo(() => {
        const rng = createRng(99);
        const positions = new Float32Array(STAR_COUNT * 3);
        const colors = new Float32Array(STAR_COUNT * 3);
        const direction = new THREE.Vector3();
        for (let i = 0; i < STAR_COUNT; i++) {
            direction.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(STAR_DISTANCE);
            direction.toArray(positions, i * 3);
            const brightness = 0.18 + rng() ** 4 * 1.5;
            const warmth = rng();
            colors[i * 3] = brightness * (0.85 + warmth * 0.15);
            colors[i * 3 + 1] = brightness * 0.9;
            colors[i * 3 + 2] = brightness * (1 - warmth * 0.2);
        }
        const buffer = new THREE.BufferGeometry();
        buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        buffer.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return buffer;
    }, []);

    return (
        <points geometry={geometry} frustumCulled={false} renderOrder={-9}>
            <pointsMaterial size={1.5} sizeAttenuation={false} vertexColors depthWrite={false} depthTest={false} toneMapped={false} />
        </points>
    );
}

/** A sphere painted with procedural clouds in the sector's colours. */
function NebulaDome({ sky }) {
    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERTEX_SHADER,
        fragmentShader: NEBULA_FRAGMENT_SHADER,
        uniforms: {
            colorA: { value: new THREE.Color(sky.nebulaA) },
            colorB: { value: new THREE.Color(sky.nebulaB) },
            intensity: { value: sky.intensity },
        },
        side: THREE.BackSide,
        // Drawn first (renderOrder below) as a pure background: it neither tests nor writes depth.
        depthWrite: false,
        depthTest: false,
    }), []); // eslint-disable-line react-hooks/exhaustive-deps -- created once, then eased towards `sky` below

    const target = useMemo(() => ({ a: new THREE.Color(sky.nebulaA), b: new THREE.Color(sky.nebulaB), intensity: sky.intensity }), [sky]);

    // Ease towards the new sector's colours instead of snapping.
    useFrame((state, delta) => {
        const blend = 1 - Math.exp(-2.5 * delta);
        material.uniforms.colorA.value.lerp(target.a, blend);
        material.uniforms.colorB.value.lerp(target.b, blend);
        material.uniforms.intensity.value += (target.intensity - material.uniforms.intensity.value) * blend;
    });

    return (
        <mesh material={material} frustumCulled={false} renderOrder={-10}>
            <sphereGeometry args={[NEBULA_RADIUS, 32, 16]} />
        </mesh>
    );
}

const KM = 1000;
const scratchOffset = new THREE.Vector3();

/**
 * One of the site's GLB models as a distant body (planet, black hole...).
 *
 * The body has a true position and radius (tens of thousands of kilometres away, thousands
 * across). Numbers that large cannot go to the GPU as they are, so the body is drawn the
 * way a painter would: on the line from the eye to its real position, at a fixed 400 km,
 * shrunk by the same ratio. What reaches the screen is identical to drawing it full size at
 * full distance - same apparent size, same tiny shift as the ship crosses the sector -
 * without the precision problems.
 */
function BackdropObject({ config }) {
    const groupRef = useRef(null);
    const truePosition = useMemo(
        () => new THREE.Vector3().fromArray(config.direction).normalize().multiplyScalar(config.distanceKm * KM),
        [config],
    );

    useFrame(({ camera }) => {
        const group = groupRef.current;
        const offset = scratchOffset.copy(truePosition).sub(camera.position);
        const shrink = SKY_DISTANCE / offset.length();
        // The parent group already sits on the camera, so this is a camera-relative position.
        group.position.copy(offset).multiplyScalar(shrink);
        group.scale.setScalar((2 * config.radiusKm * KM * shrink) / config.modelSize);
    });

    return (
        <group ref={groupRef} rotation={config.rotation ?? [0, 0, 0]}>
            <GltfModel
                url={config.model}
                animation={config.animation ?? null}
                animationSpeed={config.animationSpeed ?? 1}
                brightness={config.brightness ?? 1}
                distant
            />
        </group>
    );
}

const ENVIRONMENT_VERTEX_SHADER = /* glsl */ `
    varying vec3 vDirection;
    void main() {
        vDirection = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
`;

/** A soft two-colour sky: enough to tint reflections and shadows with the sector's nebula. */
const ENVIRONMENT_FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 colorA;
    uniform vec3 colorB;
    uniform float gain;
    varying vec3 vDirection;
    void main() {
        vec3 dir = normalize( vDirection );
        float blend = smoothstep( -0.7, 0.8, dir.y + 0.35 * sin( dir.x * 2.3 + dir.z * 1.7 ) );
        float clouds = 0.55 + 0.45 * sin( dir.x * 3.1 ) * sin( dir.y * 2.3 + 1.0 ) * sin( dir.z * 2.7 + 2.0 );
        gl_FragColor = vec4( ( mix( colorA, colorB, blend ) * clouds + 0.012 ) * gain, 1.0 );
    }
`;

/** How strongly the nebula colours light the ships, and how bright the sun's reflection is. */
const SKY_FILL = 1.6;
const SUN_GLINT = 26;

/**
 * What the ships reflect. Space has no studio around it: metal should mirror a black sky,
 * the sector's nebula and one hard sun, so each sector lights its fleet in its own colours.
 * The tiny scene inside <Environment> is rendered once into a cube map when the sector changes.
 */
function SectorEnvironment({ sector }) {
    const uniforms = useMemo(() => ({
        colorA: { value: new THREE.Color(sector.sky.nebulaA) },
        colorB: { value: new THREE.Color(sector.sky.nebulaB) },
        gain: { value: sector.sky.intensity * SKY_FILL },
    }), [sector]);
    const sunPosition = useMemo(() => new THREE.Vector3().fromArray(sector.light.sunDirection).normalize().multiplyScalar(40), [sector]);
    const sunColor = useMemo(() => new THREE.Color(sector.light.sunColor).multiplyScalar(SUN_GLINT), [sector]);
    return (
        <Environment resolution={64} frames={1} background={false} environmentIntensity={1}>
            <mesh scale={80}>
                <sphereGeometry args={[1, 24, 16]} />
                <shaderMaterial vertexShader={ENVIRONMENT_VERTEX_SHADER} fragmentShader={ENVIRONMENT_FRAGMENT_SHADER} uniforms={uniforms} side={THREE.BackSide} />
            </mesh>
            <mesh position={sunPosition}>
                <sphereGeometry args={[5, 16, 12]} />
                <meshBasicMaterial color={sunColor} toneMapped={false} />
            </mesh>
        </Environment>
    );
}

/**
 * Everything beyond the battlefield: stars and nebula (infinitely far, so they simply follow
 * the camera), distant bodies, plus the sector's lighting. All sectors' models stay mounted (only the current one is visible) so a warp
 * jump never has to wait for a download.
 */
export default function SectorBackdrop() {
    const sectorId = useGameStore((state) => state.sectorId) ?? DEFAULT_SECTOR;
    const sector = SECTORS[sectorId];
    const skyRef = useRef(null);

    useFrame(({ camera }) => {
        skyRef.current?.position.copy(camera.position);
    });

    return (
        <>
            <ambientLight intensity={sector.light.ambient} />
            <directionalLight position={sector.light.sunDirection} color={sector.light.sunColor} intensity={sector.light.sunIntensity} />
            <SectorEnvironment key={sector.id} sector={sector} />
            <group ref={skyRef}>
                <StarField />
                <NebulaDome sky={sector.sky} />
                {Object.values(SECTORS).map((other) => (
                    <group key={other.id} visible={other.id === sectorId}>
                        {other.backdrop.map((config) => <BackdropObject key={config.model} config={config} />)}
                    </group>
                ))}
            </group>
        </>
    );
}
