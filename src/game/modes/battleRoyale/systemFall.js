import { Quaternion, Vector3 } from 'three';
import { createRng, lookRotation } from '../../core/math.js';

/**
 * The last of a battle royale's ending, after the gate (gateCeremony.js): the black hole
 * takes the system and everything that did not get out of it.
 *
 * Seen from beside the dead gate, looking back the way everybody came. The ships of the
 * sides that lost have been there since the ending began - crowding at the gate that did not
 * open for them - noses to it, engines burning, and now going backwards all the same: the hole drags them in, draws each one out and tears it apart -
 * the farthest first, so the ruin comes towards the eye - while it grows from a hole in the
 * sky to the whole sky.
 *
 * Like the ceremony this is only the choreography; the presenter puts it on the stage.
 */

const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** The view looks mostly at the hole and a little towards the station under it. */
const LOOK_AT_STATION = 0.55;
/** The view itself is dragged in too, this much as hard as the ships are. */
const VIEW_DRAG = 0.16;
/** How fast the hole grows: 1 would be steadily, more is slow at first and then all at once. */
const GROWTH = 2.1;
/** How much of the sky it has when the picture comes up. */
const FIRST_SIZE = 0.03;

export class SystemFall {
    /**
     * @param {object} options
     * @param {{ position: Vector3, quaternion: Quaternion, lane: Vector3 }} options.gate where the gate stands (station.js `gatePose`)
     * @param {Vector3} options.station where the station it stands off is
     * @param {object} options.timing BATTLE_ROYALE.outro.fall
     * @param {number} options.ships how many ships are torn apart on the stage
     */
    constructor({ gate, station, timing, ships }) {
        this.seconds = timing.seconds;
        this.timing = timing;
        const right = new Vector3(1, 0, 0).applyQuaternion(gate.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(gate.quaternion);
        const inGateAxes = ([x, y, z]) => new Vector3().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(gate.lane, z);

        /** Unit direction everything falls in: towards the hole. */
        this.pull = inGateAxes(timing.from).normalize();
        this.seat = gate.position.clone().add(inGateAxes([timing.seat[0], timing.seat[1], -timing.seat[2]]));
        const look = this.pull.clone().addScaledVector(station.clone().sub(this.seat).normalize(), LOOK_AT_STATION).normalize();
        this.view = lookRotation(look, new Quaternion());
        /** A ship that is still trying to get away: nose straight out of the hole. */
        this.fleeing = lookRotation(this.pull.clone().negate(), new Quaternion());
        this.stationAt = timing.station * timing.seconds;
        this.ownAt = timing.own * timing.seconds;

        // The ships: scattered through the view, each to its own depth. Always the same scatter.
        const rng = createRng(4099);
        const viewRight = new Vector3(1, 0, 0).applyQuaternion(this.view);
        const viewUp = new Vector3(0, 1, 0).applyQuaternion(this.view);
        const [near, far] = timing.depth;
        const [first, last] = timing.tearing;
        /** Each ship's start and the second it is torn apart, nearest first. */
        this.ships = Array.from({ length: Math.max(0, ships) }, (_, index) => {
            const share = ships > 1 ? index / (ships - 1) : 0.5;
            const depth = near + (far - near) * share;
            const start = this.seat.clone().addScaledVector(look, depth)
                .addScaledVector(viewRight, (rng() - 0.5) * 0.8 * depth)
                .addScaledVector(viewUp, (rng() - 0.5) * 0.5 * depth);
            // They were here before the hole came, crowding at the gate: but not on the winners' road to it.
            const offAxis = start.clone().sub(gate.position);
            offAxis.addScaledVector(gate.lane, -offAxis.dot(gate.lane));
            const distance = offAxis.length();
            if (distance < timing.road) start.addScaledVector(distance > 1 ? offAxis.divideScalar(distance) : right, timing.road - distance);
            return { start, tornAt: timing.seconds * (last - (last - first) * share) };
        });
    }

    /** Where the view is (a watcher's own ship, or the winners' eye): dragged in slowly, like everything. */
    placeViewer(elapsed, position, quaternion) {
        position.copy(this.seat).addScaledVector(this.pull, 0.5 * this.timing.pull * VIEW_DRAG * elapsed * elapsed);
        quaternion.copy(this.view);
    }

    /**
     * Where a ship is, written into `position` and `quaternion`.
     * @returns {{ tidal: number, torn: boolean }} how far it is drawn out (0..1), and whether it has been torn apart
     */
    placeShip(index, elapsed, position, quaternion) {
        const ship = this.ships[index];
        position.copy(ship.start).addScaledVector(this.pull, 0.5 * this.timing.pull * elapsed * elapsed);
        quaternion.copy(this.fleeing);
        return { tidal: smooth((elapsed - (ship.tornAt - this.timing.stretch)) / this.timing.stretch), torn: elapsed >= ship.tornAt };
    }

    /** Metres per second a ship is falling at, `elapsed` seconds in: what its wreck keeps. */
    speed(elapsed) {
        return this.timing.pull * elapsed;
    }

    /** 0..1 how much of the sky the hole has. */
    size(elapsed) {
        const share = Math.min(1, Math.max(0, elapsed / this.seconds));
        return FIRST_SIZE + (1 - FIRST_SIZE) * share ** GROWTH;
    }

    /** 0..1 how dark the screen is: up from black as the picture comes, and into black for good at the end. */
    fade(elapsed) {
        const { cut, dark } = this.timing;
        return Math.max(Math.max(0, 1 - elapsed / cut), smooth((elapsed - (this.seconds - dark)) / dark));
    }
}
