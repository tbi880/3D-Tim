import { Quaternion, Vector3, Euler } from 'three';
import { PLAYER, POWER_MODES, WORLD } from '../../config/gameConfig.js';
import { approach, clamp, forwardOf } from '../math.js';

const scratchEuler = new Euler();
const scratchDelta = new Quaternion();
const scratchForward = new Vector3();
const scratchDesiredVelocity = new Vector3();
const scratchToCentre = new Vector3();
const scratchLocal = new Vector3();
const scratchInverse = new Quaternion();

/** Control state with nothing pressed (used while the helm is locked by the story). */
export const IDLE_CONTROLS = Object.freeze({
    yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false,
});

/**
 * Past the edge of the sector the helm is gently overridden so the nose swings back to
 * the centre. It keeps the fight in one place without an invisible wall.
 */
function applyBoundaryAssist(world, ship, turn) {
    const distance = ship.position.length();
    world.outOfBounds = distance > WORLD.arenaRadius;
    if (!world.outOfBounds) return;

    const strength = clamp((distance - WORLD.arenaRadius) / 600, 0, 1);
    scratchToCentre.copy(ship.position).multiplyScalar(-1 / distance);
    // Express "towards the centre" in the ship's own axes to derive pitch / yaw commands.
    scratchInverse.copy(ship.quaternion).invert();
    scratchLocal.copy(scratchToCentre).applyQuaternion(scratchInverse);
    const assistYaw = clamp(scratchLocal.x * 2, -1, 1);
    const assistPitch = clamp(scratchLocal.y * 2, -1, 1);
    // If the centre is directly behind, the local x / y components vanish: pick a side.
    const behind = scratchLocal.z > 0.9 ? 1 : 0;
    turn.yaw = turn.yaw * (1 - strength) + (assistYaw + behind) * strength;
    turn.pitch = turn.pitch * (1 - strength) + assistPitch * strength;
}

const turnCommand = { yaw: 0, pitch: 0 };

/**
 * Arcade flight model for the player's ship.
 * `controls.yaw` / `pitch` / `roll` are -1..1 stick deflections (yaw + = nose right,
 * pitch + = nose up, roll + = roll right); `controls.throttle` is -1..1 (S / W) and
 * `controls.throttleTarget`, when not null, is an absolute 0..1 throttle setting.
 */
/** Multipliers every player ship starts from; a ship class overrides the ones it changes. */
const DEFAULT_HANDLING = Object.freeze({ turn: 1, acceleration: 1, boostDuration: 1, boostMultiplier: 1 });

export function updatePlayerFlight(world, ship, controls, dt) {
    const mode = POWER_MODES[ship.powerMode];

    // --- Rotation ------------------------------------------------------------------------
    turnCommand.yaw = controls.yaw;
    turnCommand.pitch = controls.pitch;
    applyBoundaryAssist(world, ship, turnCommand);

    // The chosen ship bends the baseline handling (see `handling` in config/shipClasses.js).
    const handling = { ...DEFAULT_HANDLING, ...ship.cls.handling };
    const response = 1 - Math.exp(-PLAYER.turnResponse * dt);
    const angular = ship.angularVelocity;
    angular.x += (turnCommand.pitch * PLAYER.pitchRate * handling.turn - angular.x) * response;
    angular.y += (-turnCommand.yaw * PLAYER.yawRate * handling.turn - angular.y) * response;
    angular.z += (-controls.roll * PLAYER.rollRate * handling.turn - angular.z) * response;

    scratchEuler.set(angular.x * dt, angular.y * dt, angular.z * dt, 'YXZ');
    ship.quaternion.multiply(scratchDelta.setFromEuler(scratchEuler)).normalize();

    // --- Throttle and boost --------------------------------------------------------------
    if (controls.throttleTarget != null) {
        // A touch slider sets the throttle outright; ease towards it so it never jerks.
        ship.throttle = approach(ship.throttle, clamp(controls.throttleTarget, 0, 1), PLAYER.throttleRate * 2 * dt);
    } else {
        ship.throttle = clamp(ship.throttle + controls.throttle * PLAYER.throttleRate * dt, 0, 1);
    }

    const wantsBoost = controls.boost && ship.boost > 0;
    // After running dry the boost must recharge a little before it can be re-engaged.
    if (ship.boost <= 0) ship.boostLockout = true;
    if (ship.boost > 0.25) ship.boostLockout = false;
    ship.boosting = wantsBoost && !ship.boostLockout;
    ship.boost = clamp(
        ship.boost + (ship.boosting ? -dt / (PLAYER.boostDuration * handling.boostDuration) : dt / PLAYER.boostRecharge),
        0, 1,
    );

    const cruiseSpeed = ship.cls.maxSpeed * mode.engine;
    const targetSpeed = ship.boosting ? cruiseSpeed * PLAYER.boostMultiplier * handling.boostMultiplier : cruiseSpeed * ship.throttle;
    const acceleration = PLAYER.acceleration * handling.acceleration * (ship.boosting ? 2.5 : 1);
    ship.speed = approach(ship.speed, targetSpeed, acceleration * dt);

    // --- Velocity follows the nose with a little drift -----------------------------------
    forwardOf(ship.quaternion, scratchForward);
    scratchDesiredVelocity.copy(scratchForward).multiplyScalar(ship.speed);
    ship.velocity.lerp(scratchDesiredVelocity, 1 - Math.exp(-PLAYER.driftDamping * dt));
}
