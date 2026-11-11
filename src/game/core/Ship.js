import { Vector3, Quaternion } from 'three';
import { PLAYER } from '../config/gameConfig.js';
import { clamp, forwardOf } from './math.js';

let nextShipId = 1;

const scratchAxisPoint = new Vector3();
const scratchForward = new Vector3();

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

        this.radius = cls.radius;
        this.halfLength = cls.halfLength ?? 0;

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
        this.lastDamagedAt = -Infinity;
        /** World time of the last hit absorbed by shields (drives the shield shimmer). */
        this.lastShieldHitAt = -Infinity;
        this.lastAttacker = null;
        this.hitEffectTimer = 0;
        /** Set when the ship is told to leave; it is removed once this reaches zero. */
        this.despawnTimer = null;

        // Player-only state.
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

    /** Closest point to `point` on the ship's nose-to-tail axis segment. */
    closestAxisPoint(point, out) {
        if (this.halfLength <= 0) return out.copy(this.position);
        forwardOf(this.quaternion, scratchForward);
        const along = clamp(out.copy(point).sub(this.position).dot(scratchForward), -this.halfLength, this.halfLength);
        return out.copy(this.position).addScaledVector(scratchForward, along);
    }

    /** Signed distance from `point` to the hull capsule (negative when inside). */
    distanceToPoint(point) {
        return this.closestAxisPoint(point, scratchAxisPoint).distanceTo(point) - this.radius;
    }

    /** Approximate point on the hull surface facing `from` (used as a beam impact point). */
    surfacePointTowards(from, out) {
        this.closestAxisPoint(from, scratchAxisPoint);
        out.copy(from).sub(scratchAxisPoint);
        const distance = out.length();
        if (distance < 1e-4) return out.copy(scratchAxisPoint);
        return out.multiplyScalar(Math.min(this.radius, distance) / distance).add(scratchAxisPoint);
    }
}
