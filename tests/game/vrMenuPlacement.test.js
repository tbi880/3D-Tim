import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, Object3D, Ray, Vector3 } from 'three';
import layout from '../../src/game/scene/cockpitLayout.json' with { type: 'json' };
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import {
    BEHIND_HINT, BEHIND_SIZE, MENU_MESHES, MENU_METERS, MENU_PLACE, MENU_POSES, matchMenuPlace, placeMenuMeshes, showsBehindHint,
} from '../../src/game/xr/menuPlacement.js';

/**
 * Where the VR menu panel hangs (xr/menuPlacement.js). A match's ending plays straight
 * ahead, so its words - and the result with its buttons after it - go on the cabin's rear
 * wall, over each shoulder, where the pilot looks back to read them; nothing of them is in
 * front, and the seat is not in the way.
 */

const AHEAD = new Vector3(0, 0, -1);
const S = layout.cabinScale;

/** The menu's meshes hung for `place` (the seat's frame: eye at the origin, -z ahead, +x right). */
function hung(place) {
    const meshes = Array.from({ length: MENU_MESHES }, () => new Object3D());
    placeMenuMeshes(meshes, place);
    return meshes.filter((mesh) => mesh.visible);
}

/** Points across a panel of `meters` hung like `mesh`: its corners first, then a grid over it. */
function across(mesh, meters, steps = 6) {
    mesh.updateMatrixWorld(true);
    const [w, h] = meters;
    const local = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) local.push([i / steps - 0.5, j / steps - 0.5]);
    return local.map(([x, y]) => new Vector3(x * w, y * h, 0).applyMatrix4(mesh.matrixWorld));
}

const degrees = (radians) => (radians * 180) / Math.PI;
/** Angle subtended at the eye between two points. */
const between = (a, b, eye = new Vector3()) => a.clone().sub(eye).angleTo(b.clone().sub(eye));

/**
 * The seat, as boxes round its parts (tools/game-models/vr-cockpit/build_cockpit.py
 * build_seat, cabin units, round the backrest's tilt), times the cabin's scale.
 */
const SEAT = [
    [[-0.17, 0.12, 0.34], [0.17, 0.36, 0.47]], // headrest
    [[-0.1, 0.02, 0.39], [0.1, 0.16, 0.43]], // its posts
    [[-0.29, -0.73, 0.3], [0.29, 0.08, 0.48]], // backrest
    [[-0.31, -0.7, 0.18], [0.31, -0.03, 0.42]], // bolsters
    [[-0.49, -0.6, -0.22], [0.49, -0.48, 0.27]], // armrests
].map(([min, max]) => new Box3(new Vector3(...min).multiplyScalar(S), new Vector3(...max).multiplyScalar(S)));

/** Inside the cabin's walls (build_cockpit.py: the rear wall is half an ellipse, padded up to 0.085). */
function insideCabin(point) {
    const x = point.x / S;
    const z = point.z / S;
    const y = point.y / S;
    if (y < -0.6 || y > 1.22) return false; // the waist rail, the top of the wall
    if (z <= 0.625) return Math.abs(x) < 2.375 - 0.085;
    return (x / (2.375 - 0.085)) ** 2 + ((z - 0.625) / (0.94 - 0.085)) ** 2 < 1;
}

test('menus hang in front, as they always have', () => {
    const [mesh, ...more] = hung(MENU_PLACE.FRONT);
    assert.equal(more.length, 0, 'one panel');
    assert.deepEqual(mesh.position.toArray(), [0, 0.02, -1.5]);
    assert.deepEqual([mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], [0, 0, 0]);
    assert.equal(mesh.scale.x, 1);
});

test('behind, the panel hangs over each shoulder, and none of it is in view while the pilot watches the show', () => {
    const panels = hung(MENU_PLACE.BEHIND);
    assert.equal(panels.length, 2, 'one over each shoulder');
    assert.ok(panels.some((mesh) => mesh.position.x > 1) && panels.some((mesh) => mesh.position.x < -1), 'one right, one left');
    for (const mesh of panels) {
        for (const point of across(mesh, MENU_METERS)) {
            assert.ok(point.z > 0, 'behind the eye');
            // A headset sees about 50 degrees either side of where it looks: the head can turn
            // 40 degrees while watching the show and still not see the panel.
            assert.ok(degrees(AHEAD.angleTo(point.clone().normalize())) >= 90, `${point.toArray().map((v) => v.toFixed(2))} is in view`);
        }
    }
});

test('behind, the panel faces the pilot, reads the right way round, and is not much smaller than in front', () => {
    const [front] = hung(MENU_PLACE.FRONT);
    // Across its middle: from the eye, the angle between its left and right edges.
    const width = (mesh) => {
        mesh.updateMatrixWorld(true);
        const [a, b] = [-0.5, 0.5].map((x) => new Vector3(x * MENU_METERS[0], 0, 0).applyMatrix4(mesh.matrixWorld));
        return between(a, b);
    };
    const half = width(front) / 2;
    for (const mesh of hung(MENU_PLACE.BEHIND)) {
        const toEye = mesh.position.clone().negate().normalize();
        const facing = new Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
        assert.ok(facing.dot(toEye) > 0.999, 'facing the eye');
        // Looking at it, the picture's right-hand edge is on the pilot's right and its top is up.
        const look = toEye.clone().negate();
        const right = look.clone().cross(new Vector3(0, 1, 0)).normalize();
        assert.ok(new Vector3(1, 0, 0).applyQuaternion(mesh.quaternion).dot(right) > 0.99, 'not mirrored');
        assert.ok(new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).y > 0.95, 'level and upright');
        assert.ok(Math.abs(Math.tan(width(mesh) / 2) / Math.tan(half) - BEHIND_SIZE) < 0.01, 'as big as it says');
        assert.ok(BEHIND_SIZE >= 0.7, 'its text still big enough to read');
    }
});

test('behind, the panel is on the cabin\'s rear wall, and seen past the seat, not through it', () => {
    for (const mesh of hung(MENU_PLACE.BEHIND)) {
        const side = Math.sign(mesh.position.x);
        // The eye where it is when the pilot faces ahead, and where it gets to when they look
        // back over that shoulder (the head turns about the neck, a little behind the eyes).
        const eyes = [new Vector3(0, 0, 0), new Vector3(0.06 * side, 0, 0.08), new Vector3(0.03 * side, 0.04, 0.04)];
        // Its middle is over the rear wall (which starts level with the canopy's rear arch).
        assert.ok(mesh.position.z > 0.625 * S);
        for (const point of across(mesh, MENU_METERS)) {
            assert.ok(insideCabin(point), `${point.toArray().map((v) => v.toFixed(2))} is inside the cabin`);
            for (const eye of eyes) {
                const ray = new Ray(eye, point.clone().sub(eye).normalize());
                const hit = SEAT.find((box) => ray.intersectsBox(box));
                assert.equal(hit, undefined, `the seat is between the eye ${eye.toArray()} and ${point.toArray().map((v) => v.toFixed(2))}`);
            }
        }
    }
});

test('a match\'s ending and the result after it go behind; everything else stays in front', () => {
    const playing = { phase: MATCH_PHASE.PLAYING, winner: null };
    const over = { phase: MATCH_PHASE.OVER, winner: 'dawn' };
    assert.equal(matchMenuPlace({ match: null, matchOutro: null }, false), MENU_PLACE.FRONT);
    assert.equal(matchMenuPlace({ match: playing, matchOutro: null }, false), MENU_PLACE.FRONT, 'the map, the intro, a pilot who is down');
    for (const act of ['gate', 'fall']) {
        for (const outro of [{ winner: 'dawn', won: true }, { winner: 'dawn', won: false }, { winner: null, won: false }]) {
            assert.equal(matchMenuPlace({ match: over, matchOutro: { ...outro, act } }, false), MENU_PLACE.BEHIND, `${act} ${JSON.stringify(outro)}`);
        }
    }
    assert.equal(matchMenuPlace({ match: over, matchOutro: null }, true), MENU_PLACE.BEHIND, 'won or lost');
    assert.equal(matchMenuPlace({ match: { phase: MATCH_PHASE.OVER, winner: null }, matchOutro: null }, true), MENU_PLACE.BEHIND, 'nobody made it');
    assert.equal(matchMenuPlace({ match: { phase: MATCH_PHASE.DISCONNECTED }, matchOutro: null }, true), MENU_PLACE.FRONT,
        'no ending was played: the lost link is said in front');
});

test('the line in front only comes up once the result waits behind, and keeps below the line of sight', () => {
    assert.equal(showsBehindHint(MENU_PLACE.BEHIND, false), false, 'never over the show');
    assert.equal(showsBehindHint(MENU_PLACE.BEHIND, true), true);
    assert.equal(showsBehindHint(MENU_PLACE.FRONT, true), false);

    const mesh = new Object3D();
    mesh.position.fromArray(BEHIND_HINT.position);
    mesh.rotation.set(BEHIND_HINT.tilt, 0, 0);
    const points = across(mesh, BEHIND_HINT.meters);
    for (const point of points) assert.ok(point.y < -0.2 && point.z < -1, 'ahead and below the eye');
    assert.ok(degrees(between(points[0], points[3])) < 7, 'a single line, not a panel');
    const facing = new Vector3(0, 0, 1).applyEuler(mesh.rotation);
    assert.ok(facing.dot(mesh.position.clone().negate().normalize()) > 0.999, 'tipped back to face the eye');
    // Its canvas has the panel's own proportions, so the text is not stretched.
    assert.ok(Math.abs(BEHIND_HINT.texture[0] / BEHIND_HINT.texture[1] - BEHIND_HINT.meters[0] / BEHIND_HINT.meters[1]) < 1e-9);
});

test('hidden, every copy of the panel is hidden', () => {
    const meshes = Array.from({ length: MENU_MESHES }, () => new Object3D());
    placeMenuMeshes(meshes, MENU_PLACE.BEHIND);
    assert.ok(meshes.every((mesh) => mesh.visible));
    placeMenuMeshes(meshes, MENU_PLACE.FRONT);
    assert.deepEqual(meshes.map((mesh) => mesh.visible), [true, ...Array(MENU_MESHES - 1).fill(false)]);
    placeMenuMeshes(meshes, MENU_PLACE.BEHIND, false);
    assert.ok(meshes.every((mesh) => !mesh.visible));
});
