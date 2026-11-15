import { Quaternion, Vector3 } from 'three';
import { POSE_STRIDE, SHIP_FLAG } from '../codec/snapshotPacket.js';
import { NET } from '../netConfig.js';

/** How far past the newest snapshot ships may be carried on along their last heading (seconds). */
const MAX_EXTRAPOLATION = 0.05;

const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const scratchFromRotation = new Quaternion();
const scratchToRotation = new Quaternion();

/**
 * The last few snapshots from the host, and a clock that runs a fixed, small delay behind
 * the newest one. Other players' ships and the enemy are drawn at that clock, blended
 * between the two snapshots around it, so they move smoothly however unevenly packets arrive.
 */
export class SnapshotTimeline {
    constructor() {
        this.snapshots = [];
        /** Host time being shown right now, or null before the first snapshot. */
        this.clock = null;
        /** Seconds since the newest snapshot arrived. */
        this.sinceLatest = 0;
    }

    get latest() {
        return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
    }

    reset() {
        this.snapshots.length = 0;
        this.clock = null;
        this.sinceLatest = 0;
    }

    /**
     * Adds a snapshot. Unreliable packets can arrive out of order: one that is not newer
     * than what is already here is stale and is dropped.
     * @returns {boolean} whether it was kept
     */
    push(snapshot) {
        const latest = this.latest;
        if (latest && snapshot.seq <= latest.seq) return false;
        this.snapshots.push(snapshot);
        if (this.snapshots.length > NET.snapshotBufferSize) this.snapshots.shift();
        this.sinceLatest = 0;
        return true;
    }

    /** Moves the clock on by `dt`, easing it towards "newest snapshot, minus the delay". */
    advance(dt) {
        const latest = this.latest;
        if (!latest) return;
        this.sinceLatest += dt;
        const target = latest.time + this.sinceLatest - NET.interpolationDelay;
        if (this.clock === null) {
            this.clock = target;
            return;
        }
        this.clock += dt;
        const error = target - this.clock;
        if (Math.abs(error) > NET.clockSnapSeconds) this.clock = target;
        else this.clock += error * NET.clockCorrection;
    }

    /**
     * The two snapshots to blend at the current clock and how far between them it is:
     * `{ from, to, alpha }`, or null before the first snapshot. `alpha` goes a little over 1
     * when the next snapshot is late.
     */
    sample() {
        const { snapshots, clock } = this;
        if (snapshots.length === 0) return null;
        if (snapshots.length === 1 || clock <= snapshots[0].time) return { from: snapshots[0], to: snapshots[0], alpha: 0 };
        let index = snapshots.length - 1;
        while (index > 1 && snapshots[index - 1].time > clock) index -= 1;
        const from = snapshots[index - 1];
        const to = snapshots[index];
        const span = to.time - from.time;
        if (span <= 1e-6) return { from: to, to, alpha: 0 };
        const limit = 1 + MAX_EXTRAPOLATION / span;
        return { from, to, alpha: Math.min(limit, Math.max(0, (clock - from.time) / span)) };
    }
}

function readPose(snapshot, index, position, rotation) {
    const at = index * POSE_STRIDE;
    const { poses } = snapshot;
    position.set(poses[at], poses[at + 1], poses[at + 2]);
    rotation.set(poses[at + 3], poses[at + 4], poses[at + 5], poses[at + 6]);
}

/**
 * Copies a blended snapshot into the ships of a client's world.
 * @param {import('../../core/World.js').World} world
 * @param {Map<number, import('../../core/Ship.js').Ship>} shipsById the host's ids -> this device's ships
 * @param {{ from: object, to: object, alpha: number }} sample from SnapshotTimeline.sample
 * @param {import('../../core/Ship.js').Ship | null} ownShip left where it is: the player's own ship is predicted, not blended
 */
export function applySnapshotSample(world, shipsById, { from, to, alpha }, ownShip) {
    const span = to.time - from.time;
    for (let i = 0; i < to.count; i++) {
        const ship = shipsById.get(to.ids[i]);
        if (!ship || !ship.alive) continue;
        const flags = to.flags[i];
        ship.hull = to.hull[i] * ship.maxHull;
        ship.shield = to.shield[i] * ship.maxShield;
        ship.invulnerable = Boolean(flags & SHIP_FLAG.INVULNERABLE);
        ship.targetable = Boolean(flags & SHIP_FLAG.TARGETABLE);
        if (ship === ownShip) continue;
        ship.boosting = Boolean(flags & SHIP_FLAG.BOOSTING);

        if (!(flags & SHIP_FLAG.POSE)) {
            if (ship.parent) world.followParent(ship);
            continue;
        }
        readPose(to, i, scratchTo, scratchToRotation);
        const earlier = from === to ? undefined : from.indexOf.get(to.ids[i]);
        if (earlier === undefined || !(from.flags[earlier] & SHIP_FLAG.POSE)) {
            // First sighting: nothing to blend from.
            ship.position.copy(scratchTo);
            ship.quaternion.copy(scratchToRotation);
            continue;
        }
        readPose(from, earlier, scratchFrom, scratchFromRotation);
        ship.position.lerpVectors(scratchFrom, scratchTo, alpha);
        // Rotation never overshoots: a ship carried past the newest snapshot keeps its last heading.
        ship.quaternion.slerpQuaternions(scratchFromRotation, scratchToRotation, Math.min(1, alpha));
        if (span > 1e-6) {
            ship.velocity.subVectors(scratchTo, scratchFrom).multiplyScalar(1 / span);
            ship.speed = ship.velocity.length();
        }
    }
}
