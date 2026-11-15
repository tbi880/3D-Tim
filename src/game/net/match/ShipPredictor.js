import { Quaternion, Vector3 } from 'three';
import { WORLD } from '../../config/gameConfig.js';
import { updatePlayerFlight } from '../../core/systems/playerFlight.js';
import { createControls } from '../codec/inputPacket.js';
import { NET } from '../netConfig.js';

const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
const scratchCorrected = new Quaternion();

/**
 * Flies the player's own ship on a client without waiting for the host.
 *
 * Every frame the client sends its controls to the host and, at once, flies its ship with
 * them using the same flight model the host uses (`step`). The host's answer comes back a
 * few milliseconds later: where it had the ship after the input numbered `ack`. `reconcile`
 * starts again from that, replays the inputs sent since, and eases the ship from where it was
 * drawn to where it should be. The pilot feels no delay, and the host still has the last word:
 * a client that flew its ship anywhere else is simply pulled back.
 */
export class ShipPredictor {
    /** @param {import('../../core/World.js').World} world */
    constructor(world) {
        this.world = world;
        /** Inputs flown here but not yet confirmed by the host, oldest first: { seq, dt, controls }. */
        this.pending = [];
        /** Spare input records, so a frame allocates nothing. */
        this.pool = [];
    }

    reset() {
        this.pool.push(...this.pending.splice(0));
    }

    /** Flies `ship` for one frame with `controls` and remembers the input as number `seq`. */
    step(ship, seq, controls, dt) {
        const step = Math.min(dt, WORLD.maxStep);
        const record = this.pool.pop() ?? { seq: 0, dt: 0, controls: createControls() };
        record.seq = seq;
        record.dt = step;
        Object.assign(record.controls, controls);
        this.pending.push(record);
        if (this.pending.length > NET.maxPendingInputs) this.pool.push(this.pending.shift());
        this.fly(ship, record.controls, step);
    }

    fly(ship, controls, dt) {
        updatePlayerFlight(this.world, ship, controls, dt);
        ship.position.addScaledVector(ship.velocity, dt);
    }

    /**
     * @param {import('../../core/Ship.js').Ship} ship the player's ship
     * @param {object} own the host's state of that ship (snapshot `own`)
     * @param {number} ack number of the newest input the host had flown
     * @param {number} elapsed seconds since the previous reconcile (for the easing)
     */
    reconcile(ship, own, ack, elapsed) {
        scratchPosition.copy(ship.position);
        scratchRotation.copy(ship.quaternion);

        ship.position.copy(own.position);
        ship.quaternion.copy(own.quaternion);
        ship.velocity.copy(own.velocity);
        ship.angularVelocity.copy(own.angularVelocity);
        ship.speed = own.speed;
        ship.throttle = own.throttle;
        ship.boost = own.boost;
        ship.boosting = own.boosting;
        ship.boostLockout = own.boostLockout;
        ship.powerMode = own.powerMode;

        while (this.pending.length > 0 && this.pending[0].seq <= ack) this.pool.push(this.pending.shift());
        for (const input of this.pending) this.fly(ship, input.controls, input.dt);

        // `ship` is now where the host's state plus the unconfirmed inputs put it; the scratch
        // values are where it was being drawn.
        const distance = scratchPosition.distanceTo(ship.position);
        const angle = scratchRotation.angleTo(ship.quaternion);
        if (distance > NET.predictionSnapMetres || angle > NET.predictionSnapRadians) return;
        if (distance < NET.predictionDeadbandMetres && angle < NET.predictionDeadbandRadians) {
            ship.position.copy(scratchPosition);
            ship.quaternion.copy(scratchRotation);
            return;
        }
        const blend = 1 - Math.exp(-NET.predictionCorrectionRate * elapsed);
        ship.position.lerpVectors(scratchPosition, ship.position, blend);
        scratchCorrected.copy(ship.quaternion);
        ship.quaternion.slerpQuaternions(scratchRotation, scratchCorrected, blend);
    }
}
