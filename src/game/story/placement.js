import { Quaternion, Vector3 } from 'three';
import { forwardOf, randomInCone, randomUnitVector, rightOf, upOf } from '../core/math.js';

const scratchDirection = new Vector3();
const scratchAxis = new Vector3();
const IDENTITY = Object.freeze(new Quaternion());

/**
 * Turns a story "placement" into a world position.
 *
 * A placement is either an absolute `[x, y, z]` or an object:
 *   anchor   - 'player', 'origin' or a ship tag (default 'origin')
 *   bearing  - 'ahead' | 'behind' | 'left' | 'right' | 'above' | 'below' | 'around',
 *              measured in the anchor's own frame ('around' = any direction near its horizon)
 *   distance - how far from the anchor
 *   offset   - extra world-space `[x, y, z]`
 */
export function resolvePlacement(world, placement, out = new Vector3()) {
    if (Array.isArray(placement)) return out.fromArray(placement);

    const anchorShip = placement.anchor === 'player' ? world.player
        : placement.anchor && placement.anchor !== 'origin' ? world.findByTag(placement.anchor)
            : null;
    out.set(0, 0, 0);
    if (anchorShip) out.copy(anchorShip.position);

    const distance = placement.distance ?? 0;
    if (distance > 0) {
        const rng = world.rng;
        const quaternion = anchorShip?.quaternion ?? IDENTITY;
        switch (placement.bearing) {
            case 'ahead': forwardOf(quaternion, scratchAxis); randomInCone(rng, scratchAxis, 0.35, scratchDirection); break;
            case 'behind': forwardOf(quaternion, scratchAxis).negate(); randomInCone(rng, scratchAxis, 0.35, scratchDirection); break;
            case 'left': rightOf(quaternion, scratchAxis).negate(); randomInCone(rng, scratchAxis, 0.4, scratchDirection); break;
            case 'right': rightOf(quaternion, scratchAxis); randomInCone(rng, scratchAxis, 0.4, scratchDirection); break;
            case 'above': upOf(quaternion, scratchAxis); randomInCone(rng, scratchAxis, 0.3, scratchDirection); break;
            case 'below': upOf(quaternion, scratchAxis).negate(); randomInCone(rng, scratchAxis, 0.3, scratchDirection); break;
            default:
                randomUnitVector(rng, scratchDirection);
                scratchDirection.y *= 0.35;
                scratchDirection.normalize();
        }
        out.addScaledVector(scratchDirection, distance);
    }
    if (placement.offset) out.add(scratchAxis.fromArray(placement.offset));
    return out;
}

/** Spreads the members of a formation around its centre so ships do not spawn inside each other. */
export function formationOffset(world, index, count, spacing, out = new Vector3()) {
    if (count <= 1) return out.set(0, 0, 0);
    randomUnitVector(world.rng, out);
    out.y *= 0.4;
    return out.multiplyScalar(spacing * (0.6 + 0.4 * world.rng()) * Math.cbrt(count));
}
