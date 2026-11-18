import { MATCH_PHASE } from '../net/match/matchState.js';

/**
 * Where the VR menu panel hangs (xr/VRCameraRig.jsx). Every menu is in front of the pilot,
 * except a match's ending: the show at the stargate and the system's fall play straight
 * ahead, so what it says - and the result with its buttons once it is over - goes on the
 * cabin's rear wall, the dark glass panels behind the seat. The sticks and triggers work the
 * menu wherever the head is turned. Once the result is up (the show has gone dark by then) a
 * short line in front says where it is.
 *
 * Square behind the eye there is the seat: its headrest and backrest fill the middle of the
 * view, a panel there would be drawn through them, and a pilot on a chair that does not
 * swivel cannot turn that far anyway. So the panel hangs on the rear wall over each
 * shoulder, the same picture twice: a look back over either shoulder finds it. Between the
 * seat's edge, close beside a head turned that way, and the side of the view while the
 * pilot watches the show there is room for it at three quarters of its size in front
 * (tests/game/vrMenuPlacement.test.js checks both).
 *
 * Positions are in the seat's frame (the pilot's eye at the origin, -z ahead, +x right,
 * metres), like the cabin's (scene/cockpitLayout.json).
 */

export const MENU_PLACE = Object.freeze({ FRONT: 'front', BEHIND: 'behind' });

/** The menu's picture, and its size where it hangs in front. */
export const MENU_TEXTURE = Object.freeze([1024, 768]);
export const MENU_METERS = Object.freeze([1.48, 1.11]);

const FRONT_DISTANCE = 1.5;
/**
 * Behind: how far round from straight ahead (radians), how far above the eye's level, how far
 * away - well short of the rear wall, about 3.4 m from the eye that way
 * (tools/game-models/vr-cockpit/build_cockpit.py, times the cabin's scale) - and how big,
 * as a share of how big it looks in front.
 */
const BEHIND_TURN = (114 * Math.PI) / 180;
const BEHIND_ELEVATION = (15 * Math.PI) / 180;
const BEHIND_DISTANCE = 2.4;
export const BEHIND_SIZE = 0.75;

/**
 * A panel `distance` metres from the eye, `turn` radians round from straight ahead (to the
 * right) and `elevation` above the eye's level, turned to face the eye with its edges level,
 * looking `size` times as big as in front.
 */
function facingEye(turn, elevation, distance, size) {
    return Object.freeze({
        position: Object.freeze([
            distance * Math.sin(turn) * Math.cos(elevation),
            distance * Math.sin(elevation),
            -distance * Math.cos(turn) * Math.cos(elevation),
        ]),
        // Turn about the vertical, then tip about the panel's own horizontal (three.js Euler order 'YXZ').
        rotation: Object.freeze([elevation, -turn, 0]),
        scale: (size * distance) / FRONT_DISTANCE,
    });
}

/** Where the panel hangs for each place: one pose, or (behind) one over each shoulder. */
export const MENU_POSES = Object.freeze({
    [MENU_PLACE.FRONT]: Object.freeze([Object.freeze({ position: Object.freeze([0, 0.02, -FRONT_DISTANCE]), rotation: Object.freeze([0, 0, 0]), scale: 1 })]),
    [MENU_PLACE.BEHIND]: Object.freeze([
        facingEye(BEHIND_TURN, BEHIND_ELEVATION, BEHIND_DISTANCE, BEHIND_SIZE),
        facingEye(-BEHIND_TURN, BEHIND_ELEVATION, BEHIND_DISTANCE, BEHIND_SIZE),
    ]),
});

/** How many meshes the menu needs to be shown in every place. */
export const MENU_MESHES = Math.max(...Object.values(MENU_POSES).map((poses) => poses.length));

/**
 * The line in front that says the result is behind: low in the view, small, and only once the
 * result is up - never over the show itself.
 */
export const BEHIND_HINT = Object.freeze({
    texture: Object.freeze([1024, 160]),
    meters: Object.freeze([1.0, 0.15625]),
    position: Object.freeze([0, -0.32, -1.5]),
    /** Turn about the x axis that tips it back to face the eye from below the line of sight. */
    tilt: -Math.atan2(0.32, 1.5),
});

/**
 * Where a match's own menu goes: the ending, and the result after it, behind the pilot. A
 * result without an ending - the link to the host was lost - stays in front.
 * @param {{ match?: object | null, matchOutro?: object | null }} state the game store
 * @param {boolean} over the result is up (the session is in its MATCH_OVER phase)
 */
export function matchMenuPlace(state, over) {
    if (!state.match) return MENU_PLACE.FRONT;
    if (over) return state.match.phase === MATCH_PHASE.DISCONNECTED ? MENU_PLACE.FRONT : MENU_PLACE.BEHIND;
    return state.matchOutro ? MENU_PLACE.BEHIND : MENU_PLACE.FRONT;
}

/** The line in front is up while the result waits behind the pilot. */
export function showsBehindHint(place, over) {
    return place === MENU_PLACE.BEHIND && over;
}

/**
 * Hangs the menu's meshes (all showing the same picture) where `place` says; those it has no
 * use for are hidden. Call it with `visible` false to hide them all.
 * @param {import('three').Object3D[]} meshes MENU_MESHES of them
 */
export function placeMenuMeshes(meshes, place, visible = true) {
    const poses = MENU_POSES[place] ?? MENU_POSES[MENU_PLACE.FRONT];
    meshes.forEach((mesh, index) => {
        const pose = poses[index];
        mesh.visible = visible && Boolean(pose);
        if (!pose) return;
        mesh.position.fromArray(pose.position);
        mesh.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], 'YXZ');
        mesh.scale.setScalar(pose.scale);
    });
}
