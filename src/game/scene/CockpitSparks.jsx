import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { ParticleSystem } from './effects/ParticleSystem.js';
import { isHullHitOnPlayer } from './effects/playerFeedback.js';
import { viewPose } from './viewPose.js';

/**
 * Sparks inside the cockpit when the ship is hit with its shield down: something behind a
 * panel shorts out and showers sparks into the cabin, which arc and fall.
 *
 * Lives in the cockpit's own space (a child of the camera), so "down" is the cabin floor
 * and the sparks ride with the ship. One point cloud, one draw call, nothing while idle.
 */

const MAX_SPARKS = 320;
/** At most one shower this often (s), however fast the hits come. */
const SHOWER_COOLDOWN = 0.16;
/** Sparks in a shower: a base number, more for harder hits (per point of damage), up to a limit. */
const SPARKS_BASE = 22;
const SPARKS_PER_DAMAGE = 4;
const SPARKS_LIMIT = 70;
const COLORS = [new THREE.Color('#ffffff'), new THREE.Color('#ffe9a8'), new THREE.Color('#ffb347'), new THREE.Color('#ff7a2e')].map((color) => color.multiplyScalar(1.8));
const POP_COLORS = [new THREE.Color('#fff6dc').multiplyScalar(2.2)];

const scratchOrigin = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();

/**
 * @param {number[][]} emitters places a shower can come from, each [x, y, z, dx, dy, dz]: where
 *   (metres, cockpit axes: -z ahead, +y up) and which way it sprays
 * @param {number} scale how large the cockpit is drawn (the VR cabin is larger than life):
 *   spark speeds, sizes and their fall scale with it
 */
export default function CockpitSparks({ session, emitters, scale = 1 }) {
    const sparks = useMemo(() => new ParticleSystem(MAX_SPARKS, { gravity: new THREE.Vector3(0, -3.4 * scale, 0), drag: 1.4 }), [scale]);
    const state = useRef({ lastShowerAt: -Infinity, pending: [] });
    useEffect(() => () => sparks.dispose(), [sparks]);

    useEffect(() => {
        const { world } = session;
        const shower = (strength) => {
            const [x, y, z, dx, dy, dz] = emitters[Math.floor(Math.random() * emitters.length)];
            scratchOrigin.set(x, y, z);
            scratchDirection.set(dx, dy, dz).normalize();
            // A white pop where it shorts, then the spray.
            sparks.emit(scratchOrigin, { count: 2, speed: 0.02 * scale, life: 0.09, size: 0.07 * scale, colors: POP_COLORS });
            sparks.emit(scratchOrigin, {
                count: Math.round(Math.min(SPARKS_LIMIT, SPARKS_BASE + strength * SPARKS_PER_DAMAGE)),
                speed: 1.5 * scale, life: 0.7, size: 0.0055 * scale, colors: COLORS, direction: scratchDirection, spread: 0.6,
            });
        };
        const offs = [
            world.events.on(GAME_EVENTS.HIT, (hit) => {
                if (!isHullHitOnPlayer(world, hit) || world.time - state.current.lastShowerAt < SHOWER_COOLDOWN) return;
                state.current.lastShowerAt = world.time;
                shower(hit.amount);
                // Often something else lets go a moment later.
                if (Math.random() < 0.4) state.current.pending.push({ delay: 0.12 + Math.random() * 0.3, strength: hit.amount * 0.5 });
            }),
            world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => {
                sparks.clear();
                state.current.pending = [];
            }),
        ];
        state.current.shower = shower;
        return () => offs.forEach((off) => off());
    }, [session, sparks, emitters, scale]);

    useFrame(() => {
        const dt = session.effectsDelta;
        sparks.setPixelScale(viewPose.pixelHeight, viewPose.fov);
        if (dt <= 0) return;
        const local = state.current;
        if (local.pending.length > 0) {
            local.pending = local.pending.filter((item) => {
                item.delay -= dt;
                if (item.delay <= 0) local.shower(item.strength);
                return item.delay > 0;
            });
        }
        sparks.update(dt);
    });

    return <points geometry={sparks.geometry} material={sparks.material} frustumCulled={false} renderOrder={4} />;
}
