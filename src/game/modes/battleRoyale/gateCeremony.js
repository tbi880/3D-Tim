import { Quaternion, Vector3 } from 'three';
import { lookRotation } from '../../core/math.js';

/**
 * The ending of a battle royale, as each device stages it at the stargate.
 *
 * Whoever is on the winning side flies it: a run straight at the gate, faster and faster,
 * with the rest of the side's pilots in a wedge just ahead, and through as the ending runs
 * out. Everybody else sits off to one side and watches the gate open for the winners, the
 * winners' ships pull away from beside them and go through, and the gate die. If nobody won,
 * nothing opens and the gate just dies.
 *
 * This is only the choreography - where each ship is and how the gate shows at any moment -
 * so that it can be checked without a screen. The presenter puts it on the stage.
 */

const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** How quickly the flash of a ship going through the gate dies away (1/s). */
const PULSE_DECAY = 2.6;
/** A watcher's ships to fly past start this far ahead of them, each rank a little further (metres). */
const FLYBY_LEAD = 160;

const scratch = new Vector3();

/** One ship's straight run: from `start` to `end`, there at `arrive` seconds, accelerating all the way. */
class Run {
    constructor(start, end, arrive, acceleration) {
        this.start = start;
        this.end = end;
        this.arrive = arrive;
        this.acceleration = acceleration;
        this.quaternion = lookRotation(scratch.copy(end).sub(start).normalize(), new Quaternion());
    }

    /** Share of the way covered `elapsed` seconds in (1 = there). */
    progress(elapsed) {
        return Math.min(1, Math.max(0, elapsed / this.arrive)) ** this.acceleration;
    }

    /** Writes where the ship is and how it is turned; returns true once it has arrived. */
    place(elapsed, position, quaternion) {
        position.lerpVectors(this.start, this.end, this.progress(elapsed));
        quaternion.copy(this.quaternion);
        return elapsed >= this.arrive;
    }
}

export class GateCeremony {
    /**
     * @param {object} options
     * @param {{ position: Vector3, quaternion: Quaternion, lane: Vector3 }} options.gate where the gate stands (station.js `gatePose`)
     * @param {object} options.timing BATTLE_ROYALE.outro
     * @param {boolean} options.won whether this device's player is on the winning side
     * @param {boolean} options.opens whether anybody won at all
     * @param {number} options.others ships that go through besides this player's: the rest of the winning side
     */
    constructor({ gate, timing, won, opens, others }) {
        this.seconds = timing.seconds;
        this.timing = timing;
        this.won = won && opens;
        this.opens = opens;
        const { lane } = gate;
        const right = new Vector3(1, 0, 0).applyQuaternion(gate.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(gate.quaternion);
        const at = (sideways, above, back) => gate.position.clone()
            .addScaledVector(right, sideways).addScaledVector(up, above).addScaledVector(lane, -back);

        if (this.won) {
            this.viewer = new Run(at(0, 0, timing.approach), gate.position.clone(), timing.seconds, timing.acceleration);
        } else {
            // In the gallery, turned to the gate, creeping towards what is no longer theirs.
            const seat = at(...timing.gallery);
            const towards = gate.position.clone().sub(seat).normalize();
            this.viewer = new Run(seat, seat.clone().addScaledVector(towards, timing.drift * timing.seconds), timing.seconds, 1);
        }

        /** The other ships' runs, in the order they go through. */
        this.flyers = [];
        const count = opens ? Math.max(0, others) : 0;
        const forward = new Vector3(0, 0, -1).applyQuaternion(this.viewer.quaternion);
        const viewerRight = new Vector3(1, 0, 0).applyQuaternion(this.viewer.quaternion);
        const viewerUp = new Vector3(0, 1, 0).applyQuaternion(this.viewer.quaternion);
        // The last of them is through as the player is (a winner) or as the gate starts to close (a watcher).
        const last = this.won ? timing.seconds - timing.stagger : timing.close[0] * timing.seconds;
        for (let index = 0; index < count; index++) {
            const rank = Math.floor(index / 2) + 1;
            const side = index % 2 === 0 ? -1 : 1;
            // A wedge ahead of the viewer: where they can be seen from the cockpit as they pull away.
            const start = this.viewer.start.clone()
                .addScaledVector(viewerRight, side * timing.spacing * rank)
                .addScaledVector(viewerUp, timing.spacing * (this.won ? -0.3 : 0.45) * rank)
                .addScaledVector(forward, FLYBY_LEAD + timing.spacing * rank);
            // They close up as they go in: the gate is wide, but the middle is the way through.
            const end = gate.position.clone().addScaledVector(right, side * timing.spacing * rank * 0.4);
            const arrive = Math.max(timing.seconds * 0.25, last - timing.stagger * (count - 1 - index));
            this.flyers.push(new Run(start, end, arrive, timing.acceleration));
        }
    }

    /** Where this device's own ship is; `position` and `quaternion` are written. */
    placeViewer(elapsed, position, quaternion) {
        this.viewer.place(elapsed, position, quaternion);
    }

    /** Where another ship is. Returns true once it has gone through the gate (and is gone). */
    placeFlyer(index, elapsed, position, quaternion) {
        return this.flyers[index].place(elapsed, position, quaternion);
    }

    /**
     * How the gate shows `elapsed` seconds in, written into `field` (World `gateField`):
     * it opens for whoever won, flashes as each ship goes through, and for the watchers
     * closes behind the last of them.
     */
    field(elapsed, field) {
        const { timing, seconds } = this;
        const share = elapsed / seconds;
        let pulse = 0;
        for (const flyer of this.flyers) {
            if (elapsed >= flyer.arrive) pulse = Math.max(pulse, Math.exp(-(elapsed - flyer.arrive) * PULSE_DECAY));
        }
        if (!this.opens) {
            // Nobody to open for: what charge it had gutters out.
            field.open = 0;
            field.shut = smooth((share - 0.15) / 0.6);
            field.charge = 0.7 * (1 - field.shut);
        } else {
            const closing = this.won ? 0 : smooth((share - timing.close[0]) / (timing.close[1] - timing.close[0]));
            field.open = smooth(share / timing.open) * (1 - closing);
            field.shut = closing;
            field.charge = 1 - closing;
        }
        field.pulse = pulse;
        return field;
    }

    /** 0..1 strength of the warp streaks: the winners' jump builds for the whole run. */
    warp(elapsed) {
        if (!this.won) return 0;
        const share = Math.min(1, elapsed / this.seconds);
        return share * share;
    }

    /** 0..1 how dark the screen is: up from black as the picture cuts to the gate, and down again on the watchers. */
    fade(elapsed) {
        const { timing, seconds } = this;
        const cut = Math.max(0, 1 - elapsed / timing.cut);
        const dusk = this.won ? 0 : timing.fade[1] * smooth((elapsed / seconds - timing.fade[0]) / (1 - timing.fade[0]));
        return Math.max(cut, dusk);
    }
}
