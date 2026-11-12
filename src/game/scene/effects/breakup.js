import * as THREE from 'three';
import { EFFECTS } from '../../config/gameConfig.js';

/**
 * How a destroyed capital ship behaves between the killing blow and its final explosion.
 * The simulation has already removed it; the scene keeps its hull, powerless, drifting and
 * slowly starting to tumble while it burns. ShipsLayer (the hull) and ExplosionsLayer (the
 * fires) both use these functions, so the flames stay on the hull.
 */

const scratchSpin = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();

/** Seconds from death to the final explosion. */
export function breakupSeconds(ship) {
    return ship.boundingRadius * 1.3 > EFFECTS.hugeExplosionSize ? EFFECTS.hugeBreakupSeconds : EFFECTS.breakupSeconds;
}

/**
 * Where the dying hull is `elapsed` seconds after its death. With no attitude control the
 * tumble starts imperceptibly and keeps building; each ship rolls its own way.
 */
export function breakupPose(ship, elapsed, position, quaternion) {
    const seconds = breakupSeconds(ship);
    const progress = Math.min(1, elapsed / seconds);
    const way = (salt) => (((ship.id * 9301 + salt * 49297) % 233280) / 233280 < 0.5 ? -1 : 1);
    position.copy(ship.position).addScaledVector(ship.velocity, elapsed);
    // Sinks away slightly as it goes.
    position.y -= ship.boundingRadius * 0.05 * progress * progress;
    const turn = EFFECTS.breakupTumble * progress * progress;
    scratchEuler.set(turn * 0.45 * way(1), turn * 0.3 * way(2), turn * way(3));
    quaternion.copy(ship.quaternion).multiply(scratchSpin.setFromEuler(scratchEuler));
}
