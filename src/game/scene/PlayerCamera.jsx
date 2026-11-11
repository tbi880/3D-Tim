import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { GAME_EVENTS } from '../core/EventBus.js';
import { SESSION_EVENTS } from '../state/GameSession.js';
import Cockpit from './Cockpit.jsx';

const BASE_FOV = 68;
const BOOST_FOV = 9;
const WARP_FOV = 40;
/** Runs after the simulation (-2) and before the views (0). */
const CAMERA_PRIORITY = -1;
const TRAUMA_DECAY = 1.5;
const MAX_SHAKE_OFFSET = 1.1;
const MAX_SHAKE_ROLL = 0.035;

/**
 * First-person camera: it sits in the Kestrel's cockpit, so it simply copies the player
 * ship's transform. Hits and explosions add "trauma", which decays into camera shake.
 */
export default function PlayerCamera({ session }) {
    const cameraRef = useRef(null);
    const trauma = useRef(0);

    useEffect(() => {
        const world = session.world;
        const addTrauma = (amount) => { trauma.current = Math.min(1, trauma.current + amount); };
        const unsubscribe = [
            world.events.on(GAME_EVENTS.HIT, ({ target, amount, shield }) => {
                if (target?.isPlayer) addTrauma((shield ? 0.1 : 0.22) + amount / 120);
            }),
            world.events.on(GAME_EVENTS.PLAYER_COLLISION, () => addTrauma(0.7)),
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size }) => {
                const distance = world.player ? world.player.position.distanceTo(position) : Infinity;
                addTrauma(Math.max(0, 1 - distance / (size * 12)) * 0.6);
            }),
            world.events.on(GAME_EVENTS.LANCE_FIRING, () => addTrauma(0.35)),
            session.events.on(SESSION_EVENTS.CUE, ({ id }) => { if (id === 'dawnCannon') addTrauma(1); }),
            session.events.on(SESSION_EVENTS.WARP, ({ stage }) => { if (stage === 'arrive') addTrauma(0.7); }),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session]);

    useFrame(() => {
        const camera = cameraRef.current;
        const { world, effectsDelta: dt } = session;
        const player = world.player;
        if (!camera || !player) return;

        camera.position.copy(player.position);
        camera.quaternion.copy(player.quaternion);

        trauma.current = Math.max(0, trauma.current - TRAUMA_DECAY * dt);
        const shake = trauma.current * trauma.current;
        if (shake > 0.0005 && dt > 0) {
            camera.translateX((Math.random() - 0.5) * shake * MAX_SHAKE_OFFSET);
            camera.translateY((Math.random() - 0.5) * shake * MAX_SHAKE_OFFSET);
            camera.rotateZ((Math.random() - 0.5) * shake * MAX_SHAKE_ROLL);
        }

        const targetFov = BASE_FOV + (player.boosting ? BOOST_FOV : 0) + world.warpFactor * WARP_FOV;
        if (Math.abs(targetFov - camera.fov) > 0.01) {
            camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
            camera.updateProjectionMatrix();
        }
    }, CAMERA_PRIORITY);

    return (
        <PerspectiveCamera ref={cameraRef} makeDefault fov={BASE_FOV} near={0.3} far={90000}>
            <Cockpit session={session} />
        </PerspectiveCamera>
    );
}
