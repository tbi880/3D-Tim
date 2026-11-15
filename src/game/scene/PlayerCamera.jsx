import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { SESSION_EVENTS } from '../state/GameSession.js';
import { cameraModeOf, vr } from '../xr/vrState.js';
import { vrRig } from '../xr/VRCameraRig.jsx';
import Cockpit from './Cockpit.jsx';
import { viewPose } from './viewPose.js';
import WarpTunnel from './WarpTunnel.jsx';

const BASE_FOV = 68;
const BOOST_FOV = 9;
const WARP_FOV = 42;
/** Runs after the simulation (-2) and before the views (0). */
const CAMERA_PRIORITY = -1;
const TRAUMA_DECAY = 1.5;
const MAX_SHAKE_OFFSET = 1.1;
const MAX_SHAKE_ROLL = 0.035;

/** Pilot's eye relative to the ship's centre (inside the Kestrel's canopy). */
const COCKPIT_EYE = new THREE.Vector3(0, 1.25, -3.4);
/** Chase camera position relative to the ship: above and behind. */
const CHASE_OFFSET = new THREE.Vector3(0, 8.5, 40);
/** The chase camera looks at a point this far ahead of the ship, so the ship sits low in frame. */
const CHASE_LOOK_AHEAD = 140;
/** How quickly the chase camera swings round to follow a turn (1/s). Lower = more swing. */
const CHASE_ROTATION_FOLLOW = 4.5;
/** A jump this large in one frame (warp, reload) snaps the chase camera instead of easing it. */
const TELEPORT_DISTANCE = 600;

const scratchOffset = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchScale = new THREE.Vector3();

/**
 * The player's camera, with two views switched by `settings.cameraMode`:
 *  - 'cockpit': first person from the pilot's seat, cockpit interior visible;
 *  - 'chase':   third person behind the ship, which swings in frame as it turns.
 * Hits and explosions add "trauma", which decays into camera shake in both views.
 *
 * In VR this camera is the pilot's seat rather than the lens: the headset's own camera hangs
 * under it (xr/VRCameraRig.jsx), so the head moves freely inside the cockpit. For comfort
 * the seat is fixed to the ship there - no shake, no field-of-view changes and, in the chase
 * view, no swing - since anything that moves the picture without the head moving makes people
 * sick in a headset. `children` hang off the camera too (that VR rig).
 */
export default function PlayerCamera({ session, children }) {
    const cameraRef = useRef(null);
    const cockpitRef = useRef(null);
    const trauma = useRef(0);
    const chase = useRef({ orientation: new THREE.Quaternion(), lastPosition: new THREE.Vector3(), ready: false });

    useEffect(() => {
        const world = session.world;
        const addTrauma = (amount) => { trauma.current = Math.min(1, trauma.current + amount); };
        const unsubscribe = [
            world.events.on(GAME_EVENTS.HIT, ({ target, amount, shield }) => {
                if (target?.isPlayer) addTrauma((shield ? 0.1 : 0.22) + amount / 120);
            }),
            world.events.on(GAME_EVENTS.PLAYER_COLLISION, () => addTrauma(0.7)),
            world.events.on(GAME_EVENTS.EXPLOSION, ({ position, size }) => {
                const distance = world.player ? world.player.position.distanceTo(position) : Infinity;
                addTrauma(Math.max(0, 1 - distance / (size * 10)) * 0.6);
            }),
            world.events.on(GAME_EVENTS.LANCE_FIRING, () => addTrauma(0.35)),
            // A big ship dropping out of warp close by shoves space aside.
            world.events.on(GAME_EVENTS.WARP_FLASH, ({ ship, position, size }) => {
                if (!ship || !world.player || ship.cls.kind === 'fighter') return;
                const distance = world.player.position.distanceTo(position);
                addTrauma(Math.max(0, 1 - distance / (size * 10 + 1200)) * Math.min(0.75, size / 900));
            }),
            session.events.on(SESSION_EVENTS.CUE, ({ id }) => { if (id === 'dawnCannon') addTrauma(1); }),
            session.events.on(SESSION_EVENTS.WARP, ({ stage }) => { if (stage === 'arrive') addTrauma(0.8); }),
        ];
        return () => unsubscribe.forEach((off) => off());
    }, [session]);

    useFrame(({ size, gl }) => {
        const camera = cameraRef.current;
        const { world, effectsDelta: dt } = session;
        const player = world.player;
        if (!camera || !player) return;
        const isCockpit = cameraModeOf(session) !== 'chase';
        const rig = chase.current;

        if (vr.active) {
            placeVRSeat(camera, player, isCockpit);
            rig.ready = false;
            rig.lastPosition.copy(player.position);
            if (cockpitRef.current) cockpitRef.current.visible = isCockpit && player.alive;
            trauma.current = 0;
            syncVRViewPose(camera, gl.xr.getCamera());
            return;
        }

        if (isCockpit) {
            camera.quaternion.copy(player.quaternion);
            camera.position.copy(COCKPIT_EYE).applyQuaternion(player.quaternion).add(player.position);
            rig.ready = false;
        } else {
            // The rig's orientation trails the ship's, so the ship visibly banks and swings.
            const teleported = rig.lastPosition.distanceTo(player.position) > TELEPORT_DISTANCE;
            if (!rig.ready || teleported) rig.orientation.copy(player.quaternion);
            else rig.orientation.slerp(player.quaternion, 1 - Math.exp(-CHASE_ROTATION_FOLLOW * dt));
            rig.ready = true;
            const pullBack = 1 + Math.min(1.2, player.speed / player.cls.maxSpeed) * 0.22;
            // Big hulls (the Bulwark) get a camera a little further back, clear of their exhaust.
            const hullScale = Math.max(1, player.cls.radius / 15);
            scratchOffset.copy(CHASE_OFFSET).multiplyScalar(pullBack * hullScale).applyQuaternion(rig.orientation);
            camera.position.copy(player.position).add(scratchOffset);
            scratchTarget.set(0, 0, -CHASE_LOOK_AHEAD).applyQuaternion(rig.orientation).add(player.position);
            scratchUp.set(0, 1, 0).applyQuaternion(rig.orientation);
            camera.quaternion.setFromRotationMatrix(scratchMatrix.lookAt(camera.position, scratchTarget, scratchUp));
        }
        rig.lastPosition.copy(player.position);
        if (cockpitRef.current) cockpitRef.current.visible = isCockpit && player.alive;

        trauma.current = Math.max(0, trauma.current - TRAUMA_DECAY * dt);
        // Spooling up the warp drive rattles the ship too.
        const shake = Math.max(trauma.current * trauma.current, world.warpFactor * 0.06);
        if (shake > 0.0005 && dt > 0) {
            camera.translateX((Math.random() - 0.5) * shake * MAX_SHAKE_OFFSET);
            camera.translateY((Math.random() - 0.5) * shake * MAX_SHAKE_OFFSET);
            camera.rotateZ((Math.random() - 0.5) * shake * MAX_SHAKE_ROLL);
        }

        const targetFov = BASE_FOV + (player.boosting ? BOOST_FOV : 0) + world.warpFactor * WARP_FOV;
        if (Math.abs(targetFov - camera.fov) > 0.01) {
            camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
            camera.updateProjectionMatrix();
        }
        viewPose.position.copy(camera.position);
        viewPose.quaternion.copy(camera.quaternion);
        viewPose.fov = camera.fov;
        viewPose.pixelHeight = size.height;
    }, CAMERA_PRIORITY);

    return (
        <PerspectiveCamera ref={cameraRef} makeDefault fov={BASE_FOV} near={0.1} far={3_000_000}>
            {children}
            <group ref={cockpitRef}>
                <Cockpit baseFov={BASE_FOV} />
            </group>
            <WarpTunnel session={session} />
        </PerspectiveCamera>
    );
}

/**
 * VR: puts the seat (this camera) at the pilot's eye, or rigidly behind and above the ship
 * for the chase view. Its field of view is left at the base value: the cockpit model is laid
 * out for it, and the headset draws with its own lenses' projection anyway.
 */
function placeVRSeat(camera, player, isCockpit) {
    if (isCockpit) {
        camera.quaternion.copy(player.quaternion);
        camera.position.copy(COCKPIT_EYE).applyQuaternion(player.quaternion).add(player.position);
    } else {
        const hullScale = Math.max(1, player.cls.radius / 15);
        scratchOffset.copy(CHASE_OFFSET).multiplyScalar(hullScale).applyQuaternion(player.quaternion);
        camera.position.copy(player.position).add(scratchOffset);
        scratchTarget.set(0, 0, -CHASE_LOOK_AHEAD).applyQuaternion(player.quaternion).add(player.position);
        scratchUp.set(0, 1, 0).applyQuaternion(player.quaternion);
        camera.quaternion.setFromRotationMatrix(scratchMatrix.lookAt(camera.position, scratchTarget, scratchUp));
    }
    if (camera.fov !== BASE_FOV) {
        camera.fov = BASE_FOV;
        camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
}

/**
 * VR: the eye in world space = seat x re-centring offset x the head's pose this frame (the
 * headset camera's matrix is relative to its parent, the rig's origin).
 */
function syncVRViewPose(seat, xrCamera) {
    const origin = vrRig.origin;
    scratchMatrix.copy(seat.matrixWorld);
    if (origin) scratchMatrix.multiply(origin.matrix);
    scratchMatrix.multiply(xrCamera.matrix);
    scratchMatrix.decompose(viewPose.position, viewPose.quaternion, scratchScale);
    const eye = xrCamera.cameras?.[0];
    if (eye) {
        // Vertical field of view and pixel height of one eye's view, for point-sprite sizes.
        const focal = eye.projectionMatrix.elements[5];
        if (focal > 0) viewPose.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / focal));
        if (eye.viewport?.w > 0) viewPose.pixelHeight = eye.viewport.w;
    }
}
