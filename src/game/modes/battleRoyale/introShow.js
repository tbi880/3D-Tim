import { Quaternion, Vector3 } from 'three';
import { SHIP_CLASSES } from '../../config/shipClasses.js';
import { createRng, lookRotation } from '../../core/math.js';

/**
 * The story before a battle royale, as each device stages it while the host counts the
 * seconds down (BATTLE_ROYALE.intro). Two acts, the ending's two in reverse (gateCeremony.js,
 * systemFall.js): first the dying sun, with the ships of every side running from it and one
 * that did not get away; then the stargate at the last planet, asleep, and the fleets that
 * guard it - and the streaks of the jump that brings everybody into the system.
 *
 * Nobody is in the system yet: there is no ship of the player's own, only an eye that drifts
 * slowly and never turns (a view that turns by itself is what makes people sick in a headset;
 * the head is free to look round).
 *
 * This is only the choreography - which act is on, where everything is, how the gate shows -
 * so that it can be checked without a screen. The presenter puts it on the stage (introStage.js).
 */

export const INTRO_ACT = Object.freeze({ FALL: 'fall', GATE: 'gate' });

const smooth = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/**
 * Where the story stands `elapsed` seconds in.
 * @param {number} elapsed
 * @param {object} timing BATTLE_ROYALE.intro
 * @returns {{ act: string, at: number, line: number, sides: boolean }} the act that is on and the seconds
 *   into it, the line of the story that is up (0 the first), and whether the sides are shown yet
 */
export function introMoment(elapsed, timing) {
    const time = Math.min(timing.seconds, Math.max(0, elapsed));
    const second = time >= timing.fall.seconds;
    let line = 0;
    for (let index = 0; index < timing.lines.length; index++) {
        if (time >= timing.lines[index]) line = index;
    }
    return { act: second ? INTRO_ACT.GATE : INTRO_ACT.FALL, at: second ? time - timing.fall.seconds : time, line, sides: time >= timing.sides };
}

/**
 * The device's own clock of the story. The host says how many whole seconds are left, a few
 * times a second; between its words this clock runs by itself, so the picture moves smoothly,
 * and each word pulls it back if it has strayed - a device that was slow to draw, or whose
 * page was in the background, shows what everybody else is looking at.
 */
export class IntroClock {
    /**
     * @param {number} seconds the story's length (BATTLE_ROYALE.intro.seconds)
     * @param {number} [slack] seconds this clock may be off the host's word before it is put right
     */
    constructor(seconds, slack = 0.3) {
        this.seconds = seconds;
        this.slack = slack;
        this.elapsed = 0;
    }

    /** The host says `left` seconds are left, rounded up to a whole one: so the story is between `seconds - left` and a second more in. */
    hear(left) {
        if (!Number.isFinite(left)) return;
        const earliest = this.seconds - left;
        this.elapsed = Math.min(this.seconds, Math.max(0, Math.min(earliest + 1 + this.slack, Math.max(earliest - this.slack, this.elapsed))));
    }

    advance(dt) {
        this.elapsed = Math.min(this.seconds, this.elapsed + Math.max(0, dt));
    }
}

const scratch = new Vector3();

/**
 * Act one: the dying sun. The eye looks at the black hole and drifts towards it; the ships
 * come out of the depth, straight at it and past, under full burn; and far ahead one hangs
 * nose-out with its engines burning, goes backwards all the same, is drawn out and torn apart.
 */
export class Exodus {
    /**
     * @param {object} timing BATTLE_ROYALE.intro.fall
     */
    constructor(timing) {
        this.seconds = timing.seconds;
        this.timing = timing;
        /** Unit direction of the black hole: the line of sight, and the way everything falls. */
        this.hole = new Vector3().fromArray(timing.hole).normalize();
        this.seat = new Vector3().fromArray(timing.seat);
        this.view = lookRotation(this.hole, new Quaternion());
        /** A ship running from the hole: nose straight out of it. */
        this.fleeing = lookRotation(this.hole.clone().negate(), new Quaternion());
        const right = new Vector3(1, 0, 0).applyQuaternion(this.view);
        const up = new Vector3(0, 1, 0).applyQuaternion(this.view);

        // The runners: each on its own line beside the line of sight, passing the eye in turn. Always the same scatter.
        const rng = createRng(7919);
        const count = timing.cast.length;
        const [nearest, farthest] = timing.clear;
        const [first, last] = timing.passes;
        this.ships = timing.cast.map(([classId], index) => {
            const share = count > 1 ? index / (count - 1) : 0.5;
            // Round the line of sight by the golden angle, so no two come down the same side one after the other.
            const angle = index * 2.39996 + rng() * 0.6;
            const aside = nearest + (farthest - nearest) * rng() + SHIP_CLASSES[classId].radius;
            return {
                offset: new Vector3().addScaledVector(right, Math.cos(angle) * aside).addScaledVector(up, Math.sin(angle) * aside * 0.7),
                passesAt: timing.seconds * (first + (last - first) * share),
            };
        });

        const [sideways, above, ahead] = timing.straggler.from;
        this.straggler = this.seat.clone().addScaledVector(right, sideways).addScaledVector(up, above).addScaledVector(this.hole, ahead);
        this.tornAt = timing.straggler.torn * timing.seconds;
    }

    /** Where the eye is: creeping towards the hole, like everything. */
    placeViewer(elapsed, position, quaternion) {
        position.copy(this.seat).addScaledVector(this.hole, this.timing.drift * elapsed);
        quaternion.copy(this.view);
    }

    /**
     * Where one of the runners is. Returns true once it is well past the eye (and is gone).
     */
    placeShip(index, elapsed, position, quaternion) {
        const ship = this.ships[index];
        // Metres ahead of the eye's first place, along the line of sight; it comes down to nothing and goes on behind.
        const ahead = this.timing.speed * (ship.passesAt - elapsed);
        position.copy(this.seat).add(ship.offset).addScaledVector(this.hole, ahead);
        quaternion.copy(this.fleeing);
        return ahead < -this.timing.behind;
    }

    /**
     * Where the one that did not get away is.
     * @returns {{ tidal: number, torn: boolean }} how far it is drawn out (0..1), and whether it has been torn apart
     */
    placeStraggler(elapsed, position, quaternion) {
        const { pull, stretch } = this.timing.straggler;
        position.copy(this.straggler).addScaledVector(this.hole, 0.5 * pull * elapsed * elapsed);
        quaternion.copy(this.fleeing);
        return { tidal: smooth((elapsed - (this.tornAt - stretch)) / stretch), torn: elapsed >= this.tornAt };
    }

    /** Metres per second the straggler is falling at: what its wreck keeps. */
    fallSpeed(elapsed) {
        return this.timing.straggler.pull * elapsed;
    }

    /** 0..1 how dark the screen is: up from black as the story starts, and dark again before the next act. */
    fade(elapsed) {
        const { cut, dark } = this.timing;
        return Math.max(Math.max(0, 1 - elapsed / cut), smooth((elapsed - (this.seconds - dark)) / dark));
    }
}

/**
 * Act two: the way out. The eye sits back down the road to the stargate, a little to one side
 * and below it, and closes on it slowly. The two fleets that guard the gate wait either side
 * of the road, noses to the gate and half turned on each other; the pirates lie low under the
 * eye. The gate is asleep, and stirs once. It ends in the streaks of a jump.
 */
export class GateVigil {
    /**
     * @param {object} options
     * @param {{ position: Vector3, quaternion: Quaternion, lane: Vector3 }} options.gate where the gate stands (station.js `gatePose`)
     * @param {object} options.timing BATTLE_ROYALE.intro.gate
     * @param {{ asleep: number }} options.charge BATTLE_ROYALE.gate.charge
     */
    constructor({ gate, timing, charge }) {
        this.seconds = timing.seconds;
        this.timing = timing;
        this.asleep = charge.asleep;
        const { lane } = gate;
        const right = new Vector3(1, 0, 0).applyQuaternion(gate.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(gate.quaternion);
        const at = ([sideways, above, back]) => gate.position.clone()
            .addScaledVector(right, sideways).addScaledVector(up, above).addScaledVector(lane, -back);
        const inGateAxes = ([x, y, z]) => new Vector3().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(lane, z);

        this.seat = at(timing.seat);
        this.look = gate.position.clone().sub(this.seat).normalize();
        this.view = lookRotation(this.look, new Quaternion());
        /** Unit direction of the black hole, far off: back the way everybody will come. */
        this.hole = inGateAxes(timing.hole).normalize();

        // The fleets: each scattered in its own box, always the same way; the big hulls stand where the list puts them first.
        const rng = createRng(4273);
        /** Every ship of the act, in order: { faction, classId, position, quaternion }. */
        this.ships = [];
        for (const [faction, fleet] of Object.entries(timing.fleets)) {
            const [sideways] = fleet.at;
            // Nose to the gate, turned towards the road between the fleets (those on it look straight ahead).
            const turn = Math.abs(sideways) < 200 ? 0 : -Math.sign(sideways) * timing.inward;
            const heading = lane.clone().multiplyScalar(Math.cos(turn)).addScaledVector(right, Math.sin(turn)).normalize();
            const quaternion = lookRotation(heading, new Quaternion(), up);
            const classes = fleet.ships.flatMap(([classId, count]) => Array(count).fill(classId));
            classes.forEach((classId, index) => {
                const [x, y, z] = fleet.spread;
                // The first of a fleet (its biggest) holds the middle; the rest stand round it.
                const offset = index === 0 ? [0, 0, 0] : [(rng() - 0.5) * 2 * x, (rng() - 0.5) * 2 * y, (rng() - 0.5) * 2 * z];
                const position = at([fleet.at[0] + offset[0], fleet.at[1] + offset[1], fleet.at[2] + offset[2]]);
                this.ships.push({ faction, classId, position, quaternion });
            });
        }
    }

    /** Where the eye is: closing on the gate, slowly. */
    placeViewer(elapsed, position, quaternion) {
        position.copy(this.seat).addScaledVector(this.look, this.timing.drift * elapsed);
        quaternion.copy(this.view);
    }

    /** Where a ship of the fleets is: holding station, creeping forward on idling engines. */
    placeShip(index, elapsed, position, quaternion) {
        const ship = this.ships[index];
        scratch.set(0, 0, -1).applyQuaternion(ship.quaternion);
        position.copy(ship.position).addScaledVector(scratch, GateVigil.CREEP * elapsed);
        quaternion.copy(ship.quaternion);
    }

    /**
     * How the gate shows `elapsed` seconds in, written into `field` (World `gateField`): asleep,
     * but for the moment the story comes to it - then its field swells and a flash runs through it.
     */
    field(elapsed, field) {
        const { stir } = this.timing;
        const since = elapsed - stir.at * this.seconds;
        // Up quickly, down slowly.
        const swell = since < 0 ? 0 : smooth(since / 0.5) * (1 - smooth((since - 0.5) / stir.seconds));
        field.open = 0;
        field.shut = 0;
        field.charge = this.asleep + (stir.charge - this.asleep) * swell;
        field.pulse = since < 0 ? 0 : Math.exp(-since * 2.2);
        field.faction = null;
        return field;
    }

    /** 0..1 strength of the jump's streaks: nothing until the last moments, then all the way. */
    warp(elapsed) {
        const share = (elapsed - (this.seconds - this.timing.warp)) / this.timing.warp;
        return share <= 0 ? 0 : Math.min(1, share) ** 2;
    }

    /** 0..1 how dark the screen is: up from black as the picture cuts to the gate. */
    fade(elapsed) {
        return Math.max(0, 1 - elapsed / this.timing.cut);
    }
}

/** Metres per second the waiting fleets creep forward. */
GateVigil.CREEP = 6;
