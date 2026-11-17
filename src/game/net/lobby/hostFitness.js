import { FACTION } from '../../config/gameConfig.js';
import { World } from '../../core/World.js';

const STEPS = 40;
const STEP_SECONDS = 1 / 30;
const SHIPS_A_SIDE = 6;

/**
 * How fast this device simulates: milliseconds per step of a small standard battle (two
 * squadrons shooting it out). The device that runs a match steps a simulation like this for
 * every planet with players at it, thirty-odd times a second, so the number says what the
 * device would be like as a host: a tenth of a millisecond on a good computer, several on a
 * slow phone. The lobby server and the match's host weigh it against the device's round
 * trips to the other players when they choose who hosts (NET.stepCostWeight).
 *
 * It takes a few milliseconds and is measured once per visit.
 * @param {() => number} [now] clock in milliseconds
 */
export function measureStepCost(now = () => performance.now()) {
    const world = new World({ seed: 1 });
    world.setSector('cinder');
    for (let i = 0; i < SHIPS_A_SIDE; i++) {
        world.spawnShip('dart', { faction: FACTION.DAWN, position: [i * 60 - 150, 0, 300], facing: [0, 0, -1] });
        world.spawnShip('raider', { faction: FACTION.UMBRA, position: [i * 60 - 150, 0, -300], facing: [0, 0, 1] });
    }
    // A few steps first, so what is timed is the running game and not its start.
    for (let step = 0; step < 5; step++) world.update(STEP_SECONDS);
    const started = now();
    for (let step = 0; step < STEPS; step++) world.update(STEP_SECONDS);
    return Math.max(0.001, Math.round(((now() - started) / STEPS) * 1000) / 1000);
}
