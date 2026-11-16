import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EnergyRibbons } from './effects/EnergyRibbons.js';
import { INSIDE_FLARE_SCALE, seenFromInside, shownImpact } from './effects/impactPoint.js';

const MAX_BEAMS = 48;
const WHITE = new THREE.Color(1, 1, 1);

/**
 * How each kind of beam is drawn: the brightness of its halo and of its white core, how far
 * the halo reaches (as a multiple of the beam's width), and the size of the flares where it
 * leaves and where it lands (multiples of its width; 0 = none).
 */
const BEAM_STYLES = Object.freeze({
    beam: { glow: 1.5, core: 1.5, reach: 1.1, muzzle: 1.6, impact: 4.5 },
    lanceCharge: { glow: 0.8, core: 0, reach: 1.1, muzzle: 0, impact: 0 },
    lance: { glow: 2.0, core: 2.2, reach: 0.9, muzzle: 0, impact: 0 },
    cannon: { glow: 2.2, core: 2.4, reach: 1.1, muzzle: 2.0, impact: 5.5 },
    tractor: { glow: 0.9, core: 0, reach: 1.2, muzzle: 0, impact: 1.6 },
});

const color = new THREE.Color();
const scratchEnd = new THREE.Vector3();

/**
 * Draws `world.beams` (rebuilt by the simulation every frame) as light: a white-hot core in
 * a halo of the beam's colour with energy running along it, a flare at the emitter and a
 * larger one where it lands (effects/EnergyRibbons.js, one draw call for all of them).
 * A beam aimed at a shielded ship ends on its shield, not on the hull beneath.
 */
export default function BeamsLayer({ session }) {
    // A beam and its two flares each.
    const ribbons = useMemo(() => new EnergyRibbons(MAX_BEAMS * 3), []);
    useEffect(() => () => ribbons.dispose(), [ribbons]);

    useFrame(() => {
        const world = session.world;
        const count = Math.min(world.beams.length, MAX_BEAMS);
        ribbons.begin();
        for (let i = 0; i < count; i++) {
            const beam = world.beams[i];
            const style = BEAM_STYLES[beam.kind] ?? BEAM_STYLES.beam;
            const end = beam.to ? shownImpact(session, beam.to, beam.end, beam.to.shield > 0, scratchEnd) : beam.end;
            if (beam.start.distanceToSquared(end) < 1e-6) continue;
            const seed = i * 2.1;
            const flicker = 1 + 0.12 * Math.sin(world.time * 55 + seed);
            color.set(beam.color);
            ribbons.beam(beam.start, end, color, style.glow, beam.width * style.reach * flicker, style.core, seed);
            if (style.muzzle > 0) ribbons.flare(beam.start, color, 1.2, beam.width * style.muzzle * flicker, 1.2, seed);
            if (style.impact > 0) {
                const size = beam.width * style.impact * flicker * (seenFromInside(session, beam.to) ? INSIDE_FLARE_SCALE : 1);
                ribbons.flare(end, color.lerp(WHITE, 0.15), 1.5, size, style.core, seed + 1);
            }
        }
        ribbons.finish(world.time);
    });

    return <primitive object={ribbons.mesh} />;
}
