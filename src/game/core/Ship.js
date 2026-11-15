import { Vector3, Quaternion } from 'three';
import { PLAYER } from '../config/gameConfig.js';
import { clamp } from './math.js';

let nextShipId = 1;

const scratchLocal = new Vector3();
const scratchCandidate = new Vector3();
const AXES = ['x', 'y', 'z'];

/** Builds the list of hit boxes ({ centre, half } in the ship's own axes) from a class definition. */
function createBoxes(cls) {
    if (cls.hitBoxes) {
        return cls.hitBoxes.map(([cx, cy, cz, hx, hy, hz]) => ({ centre: new Vector3(cx, cy, cz), half: new Vector3(hx, hy, hz) }));
    }
    if (cls.halfExtents) return [{ centre: new Vector3(), half: new Vector3().fromArray(cls.halfExtents) }];
    return null;
}

function overallHalfExtents(boxes) {
    const half = new Vector3();
    for (const box of boxes) {
        for (const axis of AXES) half[axis] = Math.max(half[axis], Math.abs(box.centre[axis]) + box.half[axis]);
    }
    return half;
}

/** One sphere for small craft; for box hulls a row of spheres down each box's long axis. */
function createCollisionSpheres(boxes, radius) {
    if (!boxes) return [{ centre: new Vector3(), radius }];
    const spheres = [];
    for (const { centre, half } of boxes) {
        const sphereRadius = Math.max(half.x, half.y);
        const count = Math.max(1, Math.ceil(half.z / sphereRadius));
        for (let i = 0; i < count; i++) {
            const along = count === 1 ? 0 : -half.z + sphereRadius + (i * (2 * half.z - 2 * sphereRadius)) / (count - 1);
            spheres.push({ centre: new Vector3(centre.x, centre.y, centre.z + along), radius: sphereRadius });
        }
    }
    return spheres;
}

function clampToBox(point, box, out) {
    for (const axis of AXES) {
        out[axis] = clamp(point[axis], box.centre[axis] - box.half[axis], box.centre[axis] + box.half[axis]);
    }
    return out;
}

/** Slab test: distance along a ray (in the ship's axes) to a box, or Infinity. */
function raycastBox(origin, direction, box) {
    let near = -Infinity;
    let far = Infinity;
    for (const axis of AXES) {
        const start = origin[axis] - box.centre[axis];
        const step = direction[axis];
        if (Math.abs(step) < 1e-9) {
            if (Math.abs(start) > box.half[axis]) return Infinity;
            continue;
        }
        const t1 = (-box.half[axis] - start) / step;
        const t2 = (box.half[axis] - start) / step;
        near = Math.max(near, Math.min(t1, t2));
        far = Math.min(far, Math.max(t1, t2));
        if (near > far) return Infinity;
    }
    return far < 0 ? Infinity : Math.max(near, 0);
}
const scratchInverse = new Quaternion();
const scratchDirection = new Vector3();

/**
 * One ship (or ship-like object) in the simulation. It is a plain data holder: behaviour
 * lives in core/systems/*, and rendering reads these fields every frame.
 */
export class Ship {
    /**
     * @param {string} classId key in SHIP_CLASSES
     * @param {object} cls the class definition
     * @param {object} [options] per-instance overrides (see World.spawnShip)
     */
    constructor(classId, cls, options = {}) {
        this.id = nextShipId++;
        this.classId = classId;
        this.cls = cls;
        this.faction = options.faction ?? cls.faction;
        this.nameKey = options.nameKey ?? cls.nameKey;
        /** Proper name shown instead of the class name (e.g. "Harrier"). */
        this.callsign = options.callsign ?? null;
        this.group = options.group ?? null;
        this.tags = new Set(options.tags ?? []);
        /** Persistent ships are written into checkpoints and restored on load. */
        this.persistent = options.persistent ?? false;
        this.isPlayer = cls.behavior === 'player';
        this.isProjectile = false;

        this.position = new Vector3();
        this.quaternion = new Quaternion();
        this.velocity = new Vector3();
        this.speed = 0;
        this.throttle = this.isPlayer ? PLAYER.startThrottle : 1;

        /**
         * Hit shape. Small craft are spheres of `radius`. Larger ships are one or more boxes
         * that turn with the ship: `halfExtents` [x, y, z] is a single box around the centre,
         * `hitBoxes` [[cx, cy, cz, hx, hy, hz], ...] is several (hull, blades, towers...).
         */
        this.radius = cls.radius;
        this.boxes = createBoxes(cls);
        /** Half size of the whole ship (x = half width, y = half height, z = half length), or null for spheres. */
        this.halfExtents = this.boxes ? overallHalfExtents(this.boxes) : null;
        /** Radius of the sphere that encloses the whole hit shape (markers, effects, spacing). */
        this.boundingRadius = this.halfExtents ? this.halfExtents.length() : cls.radius;
        /** Spheres (local centre + radius) that stand in for the hull when the player rams things. */
        this.collisionSpheres = createCollisionSpheres(this.boxes, cls.radius);

        this.maxHull = cls.hull;
        this.hull = cls.hull * clamp(options.hullFraction ?? 1, 0.01, 1);
        /** Damage can never take the hull below this (used for story-protected ships). */
        this.minHull = 0;
        this.maxShield = cls.shield;
        this.shield = cls.shield;
        this.shieldCooldown = 0;

        this.alive = true;
        this.invulnerable = options.invulnerable ?? cls.invulnerable ?? false;
        this.targetable = options.targetable ?? cls.targetable ?? true;

        /** Weapon runtime states, created by systems/weapons.js. */
        this.weapons = [];
        this.weaponsOnline = options.weaponsOnline ?? true;
        /** Current target: a Ship, or a Projectile for point-defence weapons. */
        this.target = null;

        this.ai = {
            mode: options.aiMode ?? cls.ai?.mode ?? 'normal',
            state: 'attack',
            stateTimer: 0,
            retargetTimer: 0,
            forcedTargetTag: options.targetTag ?? null,
            /** Hostiles further away than this (metres) are ignored until they attack; Infinity = hunt anything in the sector. */
            engageRange: options.engageRange ?? Infinity,
            wantsFire: false,
            firedThisFrame: false,
            breakDirection: new Vector3(),
            /** Personal preference noise so a squadron does not all pick the same target. */
            bias: 1,
        };

        /** Modules are mounted on a parent ship at a fixed local offset. */
        this.parent = null;
        this.mountOffset = null;

        this.spawnTime = 0;
        /** Seconds left of the warp-in animation (see `arriving`), and its total length. */
        this.warpTimer = 0;
        this.warpDuration = 1;
        this.lastDamagedAt = -Infinity;
        /** World time of the last hit absorbed by shields (drives the shield shimmer). */
        this.lastShieldHitAt = -Infinity;
        this.lastAttacker = null;
        this.hitEffectTimer = 0;
        /** Set when the ship is told to leave; it is removed once this reaches zero. */
        this.despawnTimer = null;

        // Player-only state.
        /**
         * Who flies this ship in a multiplayer match (a player id), or null in single player.
         * Every player ship is `isPlayer`; `world.player` is the one flown on this device.
         */
        this.pilotId = options.pilotId ?? null;
        /** Refit levels this ship was built with ({ rating: levels }, core/refit.js). */
        this.upgrades = options.upgrades ?? null;
        /** Held controls (see IDLE_CONTROLS), refreshed every frame by whoever has the helm. */
        this.controls = null;
        /** Assist: the beams fire by themselves when something hostile is in the ring. */
        this.autoFire = false;
        /** Whether a ship-mounted cannon is on this ship this step: 0 no, 1 tracking, 2 locked. */
        this.cannonLock = 0;
        /** True while the ship is past the sector's edge and the helm is being nudged back. */
        this.outOfBounds = false;
        this.energy = PLAYER.energyMax;
        this.energyRegenDelay = 0;
        this.boost = 1;
        this.boosting = false;
        this.powerMode = 'balanced';
        this.angularVelocity = new Vector3();
        this.beamFiring = false;
    }

    hasTag(tag) {
        return this.tags.has(tag);
    }

    get hullFraction() {
        return this.maxHull > 0 ? this.hull / this.maxHull : 0;
    }

    get shieldFraction() {
        return this.maxShield > 0 ? this.shield / this.maxShield : 0;
    }

    /** Half the ship's length along its nose axis (0 for spherical small craft). */
    get halfLength() {
        return this.halfExtents ? this.halfExtents.z : 0;
    }

    /** True while the ship is still dropping out of warp: it cannot act or be hit yet. */
    get arriving() {
        return this.warpTimer > 0;
    }

    /** Writes `point` in the ship's own axes into `out`. */
    worldToLocal(point, out) {
        return out.copy(point).sub(this.position).applyQuaternion(scratchInverse.copy(this.quaternion).invert());
    }

    /**
     * The point of the hull closest to `point`. For a point inside the hull this is the
     * point itself, so the result is always "somewhere on or in the ship".
     */
    closestPoint(point, out) {
        if (!this.boxes) {
            out.copy(point).sub(this.position);
            const distance = out.length();
            if (distance > this.radius) out.multiplyScalar(this.radius / distance);
            return out.add(this.position);
        }
        this.worldToLocal(point, scratchLocal);
        let bestDistanceSq = Infinity;
        for (const box of this.boxes) {
            clampToBox(scratchLocal, box, scratchCandidate);
            const distanceSq = scratchCandidate.distanceToSquared(scratchLocal);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                out.copy(scratchCandidate);
            }
        }
        return out.applyQuaternion(this.quaternion).add(this.position);
    }

    /** Signed distance from `point` to the hull surface (negative when inside). */
    distanceToPoint(point) {
        if (!this.boxes) return this.position.distanceTo(point) - this.radius;
        this.worldToLocal(point, scratchLocal);
        let best = Infinity;
        for (const box of this.boxes) {
            const dx = Math.abs(scratchLocal.x - box.centre.x) - box.half.x;
            const dy = Math.abs(scratchLocal.y - box.centre.y) - box.half.y;
            const dz = Math.abs(scratchLocal.z - box.centre.z) - box.half.z;
            const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
            best = Math.min(best, outside + Math.min(Math.max(dx, dy, dz), 0));
        }
        return best;
    }

    /**
     * Distance along a ray (unit `direction`) to where it first meets the hull,
     * or Infinity if it misses. A ray that starts inside the hull returns 0.
     */
    raycast(origin, direction) {
        if (!this.boxes) {
            scratchLocal.copy(this.position).sub(origin);
            const along = scratchLocal.dot(direction);
            const offAxisSq = scratchLocal.lengthSq() - along * along;
            const radiusSq = this.radius * this.radius;
            if (offAxisSq > radiusSq) return Infinity;
            const entry = along - Math.sqrt(radiusSq - offAxisSq);
            if (entry >= 0) return entry;
            return along + Math.sqrt(radiusSq - offAxisSq) >= 0 ? 0 : Infinity;
        }
        this.worldToLocal(origin, scratchLocal);
        scratchDirection.copy(direction).applyQuaternion(scratchInverse);
        let best = Infinity;
        for (const box of this.boxes) best = Math.min(best, raycastBox(scratchLocal, scratchDirection, box));
        return best;
    }
}
