import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import AnyModel from '../../modelComponents/AnyModel';
import { bucketURL } from '../../Settings';
import { SECTORS } from '../config/sectors.js';
import { createRng } from '../core/math.js';
import { useGameStore } from '../state/gameStore.js';

/** Radius of the sky dome that backdrop objects sit on. It follows the camera, so nothing on it can be reached. */
const SKY_DISTANCE = 20000;
const STAR_DISTANCE = 52000;
const NEBULA_RADIUS = 60000;
const STAR_COUNT = 2800;
const DEFAULT_SECTOR = 'collapse';

const NEBULA_VERTEX_SHADER = /* glsl */ `
    varying vec3 vDirection;
    void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
        <points geometry={geometry} frustumCulled={false}>
            <pointsMaterial size={1.5} sizeAttenuation={false} vertexColors depthWrite={false} toneMapped={false} />
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
        depthWrite: false,
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

/** One of the site's GLB models hung in the sky (planet, black hole...). */
function BackdropObject({ config }) {
    const position = useMemo(
        () => new THREE.Vector3().fromArray(config.direction).normalize().multiplyScalar(SKY_DISTANCE).toArray(),
        [config],
    );
    const animationNames = useMemo(() => (config.animation ? [config.animation] : []), [config]);
    return (
        <group position={position} rotation={config.rotation ?? [0, 0, 0]}>
            <AnyModel
                modelURL={config.model}
                scale={config.size / config.modelSize}
                animationNames={animationNames}
                animationAutoStart={Boolean(config.animation)}
                animationSpeeds={config.animationSpeed ?? 1}
            />
        </group>
    );
}

/**
 * Everything that is "infinitely far away": stars, nebula, planets, plus the sector's
 * lighting. All sectors' models stay mounted (only the current one is visible) so a warp
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
            <hemisphereLight args={['#a9c4ff', '#2a2038', 0.6]} />
            {/* Same low-resolution studio reflections the site's Project Dawn scene lights this ship with. */}
            <Environment files={bucketURL + 'pic/studio.hdr'} resolution={4} background={false} environmentIntensity={0.9} />
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
