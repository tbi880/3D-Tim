import { Suspense, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Stars } from '@react-three/drei';
import * as THREE from 'three';
import CockpitCabin, { CABIN_SCALE } from '../../../src/game/scene/CockpitCabin.jsx';
import { FlightStickModel } from '../../../src/game/xr/VRFlightStick.jsx';
import { ambientLight } from '../../../src/game/scene/cabinLighting.js';
import layout from '../../../src/game/scene/cockpitLayout.json';
import { useGameStore } from '../../../src/game/state/gameStore.js';

/**
 * Shows the cockpit cabin from the pilot's eye at a headset's field of view, lit roughly like a sector of the
 * game (one sun, a little ambient light, a dim sky to reflect), with a test card where the
 * game draws the flight display and a flight stick where each hand would hold one.
 * `?yaw=..&pitch=..&mode=..&x=..&y=..&z=..` set the view; `?stick=1` shows a stick close up.
 */
const query = new URLSearchParams(location.search);
const view = {
    yaw: Number(query.get('yaw') ?? 0), pitch: Number(query.get('pitch') ?? -15),
    head: ['x', 'y', 'z'].map((axis) => Number(query.get(axis) ?? 0)),
};
const hud = { alive: true, hull: 1, powerMode: query.get('mode') ?? 'balanced', boosting: false };
/** Each hand's grip, as a controller held upright and tipped a little forward. */
const HANDS = [[-0.24, -0.33, -0.42], [0.24, -0.33, -0.42]];
const GRIP_ROTATION = [Math.PI / 2 - 0.45, 0, 0];
const publish = () => useGameStore.setState({ hud: { ...hud } });
window.__preview = { view, hud, publish };

function Eye() {
    const { camera, gl } = useThree();
    useEffect(() => {
        const canvas = gl.domElement;
        const drag = (event) => {
            if (!event.buttons) return;
            view.yaw += event.movementX * 0.25;
            view.pitch = Math.max(-89, Math.min(89, view.pitch + event.movementY * 0.25));
        };
        const key = (event) => {
            const mode = { 1: 'balanced', 2: 'defense', 3: 'attack' }[event.key];
            if (mode) hud.powerMode = mode;
            if (event.key === 'b') hud.boosting = !hud.boosting;
            if (event.key === 'h') hud.hull = hud.hull < 0.3 ? 1 : 0.2;
            publish();
        };
        canvas.addEventListener('pointermove', drag);
        window.addEventListener('keydown', key);
        return () => { canvas.removeEventListener('pointermove', drag); window.removeEventListener('keydown', key); };
    }, [gl]);
    useFrame((_, delta) => {
        ambientLight.update(hud, delta);
        camera.position.fromArray(view.head).multiplyScalar(CABIN_SCALE);
        camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ');
    });
    return null;
}

/** A test card exactly where VRHud puts the instrument panel. */
function DisplayCard() {
    const texture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 384;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(4, 14, 26, 0.78)';
        ctx.fillRect(6, 6, 1012, 372);
        ctx.strokeStyle = 'rgba(89, 208, 255, 0.8)';
        ctx.lineWidth = 4;
        ctx.strokeRect(8, 8, 1008, 368);
        ctx.fillStyle = '#bfe6ff';
        ctx.font = '600 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('FLIGHT DISPLAY', 512, 205);
        const map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        return map;
    }, []);
    return (
        <mesh position={layout.display.position.map((v) => v * CABIN_SCALE)} rotation={[layout.display.tilt, 0, 0]} scale={CABIN_SCALE} renderOrder={1002}>
            <planeGeometry args={layout.display.meters} />
            <meshBasicMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}

function Preview() {
    useEffect(publish, []);
    return (
        <Canvas gl={{ logarithmicDepthBuffer: true, antialias: true, preserveDrawingBuffer: true }} camera={{ fov: Number(query.get('fov') ?? 95), near: 0.02, far: 5000 }}>
            <color attach="background" args={['#020308']} />
            <Stars radius={900} depth={200} count={3000} factor={12} fade={false} />
            <ambientLight intensity={0.2} />
            <directionalLight position={[-0.4, 0.5, -0.8]} color="#cfd9ff" intensity={3} />
            <Environment resolution={64} frames={1} background={false}>
                <color attach="background" args={['#05070c']} />
                <Lightformer form="circle" intensity={6} color="#cfd9ff" position={[-4, 5, -8]} scale={3} />
                <Lightformer form="rect" intensity={0.4} color="#4a6aa8" position={[6, -2, 4]} scale={[10, 6, 1]} />
            </Environment>
            <Eye />
            <Suspense fallback={null}>
                <CockpitCabin />
                {HANDS.map((position, index) => (
                    <group key={index} position={position} rotation={GRIP_ROTATION}>
                        <FlightStickModel getTrigger={() => view.trigger ?? 0} />
                    </group>
                ))}
                {query.get('stick') && (
                    <group position={[0, -0.02, -0.3]} rotation={[Math.PI / 2 - 0.3, Number(query.get('stick')) || 0, 0]}>
                        <FlightStickModel getTrigger={() => view.trigger ?? 0} />
                    </group>
                )}
            </Suspense>
            {query.get('card') !== '0' && <DisplayCard />}
        </Canvas>
    );
}

createRoot(document.getElementById('root')).render(<Preview />);
