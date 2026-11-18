import { Euler, Quaternion } from 'three';

/**
 * VR, third-person (chase) view: the camera swung round the pilot's ship.
 *
 * While the right grip is held, the right stick moves the camera round the ship instead of
 * steering it (xr/XRGamepadInput.js): the ship flies on as it was. Let go, the camera stays
 * where it was left and the stick steers again. A quick squeeze of the grip on its own swings
 * the camera back behind the ship. The whole chase rig - where the camera sits and where it
 * looks - turns about the ship's centre (scene/PlayerCamera.jsx), so the ship stays in view
 * from any side. A pilot who is down and watching somebody orbits that ship the same way.
 *
 * `yaw`: radians round the ship's up axis (+ = the view turns left, the camera goes round to
 * the ship's right); `pitch`: radians about its right axis (+ = the view tilts up, the camera
 * goes under the ship). 0 / 0 = straight behind.
 */
export const ORBIT = Object.freeze({
    /** Radians per second at full stick. */
    speed: 1.6,
    /** Furthest the camera tilts over or under the ship. */
    maxPitch: 1.35,
    /** How quickly (1/s) a squeeze of the grip swings the camera back behind the ship. */
    returnRate: 6,
    /** This close to straight behind, the swing back is over. */
    settle: 0.002,
    /** The grip let go within this many seconds, with the stick left alone, was a squeeze (back behind the ship). */
    tapSeconds: 0.35,
});

export const createOrbit = () => ({ yaw: 0, pitch: 0, returning: false });

/** The page's orbit: moved by the controllers, read by the camera. */
export const vrOrbit = createOrbit();

const TAU = Math.PI * 2;
const wrapAngle = (angle) => angle - TAU * Math.round(angle / TAU);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * One frame. `look` is the stick ({ x: + = look right, y: + = look up }, -1..1), or null when
 * the camera is not being moved.
 */
export function stepOrbit(orbit, look, dt) {
    if (look && (look.x !== 0 || look.y !== 0)) {
        orbit.returning = false;
        orbit.yaw = wrapAngle(orbit.yaw - look.x * ORBIT.speed * dt);
        orbit.pitch = clamp(orbit.pitch + look.y * ORBIT.speed * dt, -ORBIT.maxPitch, ORBIT.maxPitch);
        return;
    }
    if (!orbit.returning) return;
    // The yaw is kept within half a turn, so easing it to 0 always goes the short way round.
    const keep = Math.exp(-ORBIT.returnRate * dt);
    orbit.yaw *= keep;
    orbit.pitch *= keep;
    if (Math.abs(orbit.yaw) < ORBIT.settle && Math.abs(orbit.pitch) < ORBIT.settle) resetOrbit(orbit);
}

/** Swings the camera back behind the ship, over a moment. */
export function recentreOrbit(orbit) {
    if (orbit.yaw !== 0 || orbit.pitch !== 0) orbit.returning = true;
}

/** Straight behind the ship, at once (a new view, a new session). */
export function resetOrbit(orbit) {
    orbit.yaw = 0;
    orbit.pitch = 0;
    orbit.returning = false;
}

const scratchEuler = new Euler(0, 0, 0, 'YXZ');
const scratchTurn = new Quaternion();

/**
 * The chase rig's orientation: the ship's, turned by the orbit about the ship's own up and
 * right axes. The camera's offset, its look-ahead point and its up all go through this.
 * @param {Quaternion} shipQuaternion  @param {{ yaw: number, pitch: number }} orbit  @param {Quaternion} out
 */
export function orbitQuaternion(shipQuaternion, orbit, out) {
    scratchTurn.setFromEuler(scratchEuler.set(orbit.pitch, orbit.yaw, 0, 'YXZ'));
    return out.copy(shipQuaternion).multiply(scratchTurn);
}
