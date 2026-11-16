import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { EnergyRibbons } from './effects/EnergyRibbons.js';
import { INSIDE_FLARE_SCALE, seenFromInside, shownImpact } from './effects/impactPoint.js';
import { MAX_SHARDS, MAX_SPLASHES, ShieldImpacts } from './effects/ShieldImpacts.js';
import { shieldShells } from './effects/ShieldShell.js';
import { TorpedoEffects } from './effects/TorpedoEffects.js';
import { viewPose } from './viewPose.js';

const MAX_BOLTS = 400;
/** A bolt is drawn as a tracer this long (m), its glow this far from its axis, with a soft light at its head. */
const BOLT_LENGTH = 17;
const BOLT_HALF_WIDTH = 1.15;
const BOLT_HEAD = 1.5;
/** Colours above 1.0 feed the bloom pass. */
const BOLT_BRIGHTNESS = 1.9;
/** Shots breaking on shields further away than this are not worth drawing. */
const IMPACT_RANGE = 3000;
/**
 * How a shot breaks on a shield, by weapon type: the size of the burst (m), how many shards
 * fly and how fast (m/s). Beams land several times a second, so each landing is small.
 */
const IMPACTS = Object.freeze({
    bolt: { size: 5.5, shards: 9, speed: 85 },
    beam: { size: 4, shards: 4, speed: 60 },
    lance: { size: 16, shards: 8, speed: 140 },
});
const DEFAULT_SHOT_COLOR = '#ff6a5a';
const DEFAULT_SHIELD_COLOR = new THREE.Color('#7fd8ff');

const direction = new THREE.Vector3();
const tail = new THREE.Vector3();
const scratchPoint = new THREE.Vector3();
const colorCache = new Map();

/** Parses each weapon colour once; bolts ask for the same few colours thousands of times. */
function weaponColor(hex) {
    if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
    return colorCache.get(hex);
}

/**
 * What hit: the weapon's type and colour, and where it came from. The hit says so itself
 * where the simulation runs on this device; a multiplayer guest only hears that a hit landed,
 * so there it is read off the beams and bolts in flight.
 */
function describeShot(world, { target, position, source, weapon }) {
    if (weapon) return { type: weapon.type, color: weapon.color, from: source?.position ?? null };
    const beam = world.beams.find((candidate) => candidate.to === target);
    if (beam) return { type: 'beam', color: beam.color, from: beam.start };
    let nearest = null;
    let nearestDistance = 60 * 60;
    for (const projectile of world.projectiles) {
        const distance = projectile.position.distanceToSquared(position);
        if (projectile.kind === 'bolt' && distance < nearestDistance) [nearest, nearestDistance] = [projectile, distance];
    }
    return { type: 'bolt', color: nearest?.color ?? DEFAULT_SHOT_COLOR, from: nearest?.owner?.position ?? null };
}

/**
 * Draws all bolts as tracers and what shields do to the shots that hit them (one draw call,
 * effects/EnergyRibbons.js), and photon torpedoes with their wakes, launch flashes and impact
 * bursts (TorpedoEffects, three draw calls).
 */
export default function ProjectilesLayer({ session }) {
    // A tracer and the light at its head for every bolt, plus the shield impacts.
    const ribbons = useMemo(() => new EnergyRibbons(MAX_BOLTS * 2 + MAX_SPLASHES + MAX_SHARDS), []);
    const impacts = useMemo(() => new ShieldImpacts(), []);
    const torpedoFx = useMemo(() => new TorpedoEffects(), []);

    useEffect(() => {
        const { world } = session;
        const unsubscribe = [
            // After a jump nothing from the old sector should hang in the new sky.
            world.events.on(GAME_EVENTS.SECTOR_CHANGED, () => {
                torpedoFx.reset();
                impacts.clear();
            }),
            // A shot stopped by a shield melts into it and breaks up (hull hits spark instead: ExplosionsLayer).
            world.events.on(GAME_EVENTS.HIT, (hit) => {
                const { target, position, shield } = hit;
                if (!shield || !target?.position || position.distanceToSquared(viewPose.position) > IMPACT_RANGE * IMPACT_RANGE) return;
                const shot = describeShot(world, hit);
                const power = IMPACTS[shot.type];
                if (!power) return;   // torpedoes have their own impact (TorpedoEffects)
                shownImpact(session, target, position, true, scratchPoint);
                if (shot.from) direction.copy(position).sub(shot.from).normalize();
                else direction.copy(target.position).sub(position).normalize();
                const shieldColor = shieldShells.get(target)?.uniforms.tint.value ?? DEFAULT_SHIELD_COLOR;
                impacts.strike(target, scratchPoint, direction, weaponColor(shot.color), shieldColor, power, seenFromInside(session, target) ? INSIDE_FLARE_SCALE : 1);
            }),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session, torpedoFx, impacts]);
    useEffect(() => () => {
        torpedoFx.dispose();
        ribbons.dispose();
    }, [torpedoFx, ribbons]);

    useFrame(() => {
        const world = session.world;
        let boltCount = 0;
        ribbons.begin();
        for (const projectile of world.projectiles) {
            if (projectile.kind !== 'bolt') continue;
            if (boltCount >= MAX_BOLTS) break;
            boltCount += 1;
            const color = weaponColor(projectile.color);
            direction.copy(projectile.velocity).normalize();
            tail.copy(projectile.position).addScaledVector(direction, -BOLT_LENGTH);
            ribbons.bolt(tail, projectile.position, color, BOLT_BRIGHTNESS, BOLT_HALF_WIDTH, 1.6, projectile.id);
            // The light at its head, so a bolt coming straight at the eye is still seen.
            ribbons.glow(projectile.position, color, 0.9, BOLT_HEAD, 0.7, projectile.id);
        }
        impacts.update(session.effectsDelta);
        impacts.draw(ribbons);
        ribbons.finish(world.time);
        torpedoFx.update(world, session.effectsDelta);
    });

    return (
        <>
            <primitive object={ribbons.mesh} />
            <primitive object={torpedoFx.group} />
        </>
    );
}
