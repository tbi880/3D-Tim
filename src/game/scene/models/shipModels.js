import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FACTION } from '../../config/gameConfig.js';

/**
 * Procedural ship models, built from primitives in code.
 *
 * Why code instead of GLB files: the site serves models from a remote bucket, so new files
 * would need uploading before the game could run. These ships need no assets at all, weigh
 * nothing to download, and every one is two draw calls (hull + emissive "glow" layer).
 * Captain Tim's Dawnbreaker and all scenery still use the site's existing GLB models.
 *
 * Orientation: nose towards -Z, +Y up. Sizes match `radius` / `halfLength` in
 * config/shipClasses.js. To add a ship, add a builder to MODEL_BUILDERS.
 */

const HALF_PI = Math.PI / 2;
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();

/** Positions a primitive inside the model. Geometry is flattened so different primitives can be merged. */
function place(geometry, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const placed = geometry.index ? geometry.toNonIndexed() : geometry;
    placed.deleteAttribute('uv');
    scratchMatrix.compose(
        scratchPosition.fromArray(at),
        scratchQuaternion.setFromEuler(scratchEuler.fromArray(rot)),
        scratchScale.fromArray(scale),
    );
    return placed.applyMatrix4(scratchMatrix);
}

// Primitives, already turned so their length runs along Z (front = -Z).
const box = (width, height, depth) => new THREE.BoxGeometry(width, height, depth);
const nose = (radius, length, sides = 8) => new THREE.ConeGeometry(radius, length, sides).rotateX(-HALF_PI);
const tube = (frontRadius, backRadius, length, sides = 10) => new THREE.CylinderGeometry(frontRadius, backRadius, length, sides).rotateX(-HALF_PI);
const ball = (radius, detail = 1) => new THREE.IcosahedronGeometry(radius, detail);
const ring = (radius, thickness, sides = 24) => new THREE.TorusGeometry(radius, thickness, 8, sides);

// ---- Model definitions --------------------------------------------------------------------
// Each builder returns { hull: [...], glow: [...] } lists of placed primitives.

function buildDrone() {
    return {
        hull: [
            place(nose(2.2, 11, 6), { at: [0, 0, -1.5] }),
            place(box(7, 0.4, 3.5), { at: [-4.2, 0, 2.2], rot: [0, 0.45, 0.18] }),
            place(box(7, 0.4, 3.5), { at: [4.2, 0, 2.2], rot: [0, -0.45, -0.18] }),
            place(box(0.4, 3.2, 3), { at: [0, 1.4, 3] }),
        ],
        glow: [
            place(ball(1.3), { at: [0, 0, 4.6] }),
            place(box(0.5, 0.5, 4), { at: [0, 0.9, -2] }),
        ],
    };
}

function buildRaider() {
    return {
        hull: [
            place(tube(0.8, 2.2, 15, 6), { at: [-3.6, 0, 0] }),
            place(tube(0.8, 2.2, 15, 6), { at: [3.6, 0, 0] }),
            place(box(6.5, 1.6, 6), { at: [0, 0, 1.5] }),
            place(box(0.5, 4.5, 4), { at: [-3.6, 2.4, 4.5], rot: [0, 0, 0.3] }),
            place(box(0.5, 4.5, 4), { at: [3.6, 2.4, 4.5], rot: [0, 0, -0.3] }),
            place(nose(1.4, 5, 5), { at: [0, 0.3, -3.5] }),
        ],
        glow: [
            place(ball(1.5), { at: [-3.6, 0, 7.6] }),
            place(ball(1.5), { at: [3.6, 0, 7.6] }),
            place(box(4, 0.4, 0.6), { at: [0, 0.9, -0.5] }),
        ],
    };
}

function buildLancer() {
    return {
        hull: [
            place(box(8, 3, 14), { at: [0, 0, 2] }),
            place(nose(4.6, 9, 4), { at: [0, 0, -9.5], rot: [0, 0, Math.PI / 4], scale: [1, 0.55, 1] }),
            place(box(18, 0.7, 6), { at: [0, 0.4, 4] }),
            place(tube(1.5, 1.5, 11, 8), { at: [-6, -2, 1] }),
            place(tube(1.5, 1.5, 11, 8), { at: [6, -2, 1] }),
        ],
        glow: [
            place(ball(1.4), { at: [-6, -2, -4.8] }),
            place(ball(1.4), { at: [6, -2, -4.8] }),
            place(box(5, 1.6, 0.8), { at: [0, 0, 9.2] }),
        ],
    };
}

function buildWarden() {
    const turret = (x, y, z) => place(ball(5, 0), { at: [x, y, z] });
    return {
        hull: [
            place(box(30, 22, 120), { at: [0, 0, 10] }),
            place(nose(21, 50, 4), { at: [0, 0, -75], rot: [0, 0, Math.PI / 4] }),
            place(box(46, 10, 60), { at: [0, -3, 40] }),
            place(box(10, 16, 34), { at: [0, 18, 30] }),
            place(ring(48, 4.5, 28), { at: [0, 0, -5] }),
            place(box(96, 3, 8), { at: [0, 0, -5] }),
            place(box(3, 96, 8), { at: [0, 0, -5] }),
            turret(0, 13, -30), turret(0, -13, -20), turret(16, 0, 50), turret(-16, 0, 50),
        ],
        glow: [
            place(ring(48, 0.9, 40), { at: [0, 0, -9.8] }),
            place(box(20, 12, 3), { at: [0, 0, 71] }),
            place(box(1.2, 1.2, 90), { at: [15.4, 6, 5] }),
            place(box(1.2, 1.2, 90), { at: [-15.4, 6, 5] }),
        ],
    };
}

function buildEclipse() {
    const hull = [
        // Spine and armoured prow.
        place(tube(95, 130, 620, 8), { at: [0, 0, 40] }),
        place(nose(95, 190, 8), { at: [0, 0, -365] }),
        place(tube(130, 90, 130, 8), { at: [0, 0, 415] }),
        // Crescent blades flanking the bow: the ship's silhouette.
        place(box(36, 250, 430), { at: [-190, 0, -150], rot: [0, 0.22, 0.12] }),
        place(box(36, 250, 430), { at: [190, 0, -150], rot: [0, -0.22, -0.12] }),
        place(box(170, 30, 120), { at: [-110, 0, 20] }),
        place(box(170, 30, 120), { at: [110, 0, 20] }),
        // Dorsal citadel and ventral keel.
        place(box(90, 90, 220), { at: [0, 135, 150] }),
        place(box(50, 60, 90), { at: [0, 200, 190] }),
        place(box(60, 110, 300), { at: [0, -140, 80] }),
    ];
    const glow = [
        // Lance emitter at the bow.
        place(ball(26, 1), { at: [0, 0, -452] }),
        place(ring(44, 5, 24), { at: [0, 0, -420] }),
        // Trench lights along the blades and spine.
        place(box(4, 4, 400), { at: [-209, 60, -150], rot: [0, 0.22, 0.12] }),
        place(box(4, 4, 400), { at: [209, 60, -150], rot: [0, -0.22, -0.12] }),
        place(box(6, 6, 520), { at: [0, 128, 0] }),
        // Engines.
        place(ball(34, 1), { at: [-50, 0, 482] }),
        place(ball(34, 1), { at: [50, 0, 482] }),
        place(ball(24, 1), { at: [0, 55, 482] }),
        place(ball(24, 1), { at: [0, -55, 482] }),
    ];
    return { hull, glow };
}

function buildShieldGenerator() {
    return {
        hull: [
            place(tube(9, 16, 34, 6).rotateX(HALF_PI), { at: [0, -14, 0] }),
            place(ring(24, 3, 20).rotateX(HALF_PI), { at: [0, 6, 0] }),
        ],
        glow: [
            place(ball(15, 1), { at: [0, 8, 0] }),
        ],
    };
}

function buildHarrier() {
    return {
        hull: [
            place(tube(9, 15, 80, 10), { at: [0, 0, 0], scale: [1.5, 0.75, 1] }),
            place(nose(13.5, 34, 10), { at: [0, 0, -57], scale: [1, 0.5, 1] }),
            place(box(10, 8, 22), { at: [0, 9, 8] }),
            // Nacelles on swept pylons.
            place(tube(5, 5, 62, 10), { at: [-34, 8, 26] }),
            place(tube(5, 5, 62, 10), { at: [34, 8, 26] }),
            place(box(26, 2, 14), { at: [-20, 4, 26], rot: [0, 0, -0.3] }),
            place(box(26, 2, 14), { at: [20, 4, 26], rot: [0, 0, 0.3] }),
        ],
        glow: [
            place(ball(5.2, 1), { at: [-34, 8, -5.5] }),
            place(ball(5.2, 1), { at: [34, 8, -5.5] }),
            place(box(4, 3, 30), { at: [-34, 12.5, 30] }),
            place(box(4, 3, 30), { at: [34, 12.5, 30] }),
            place(box(18, 6, 2), { at: [0, 0, 40.5] }),
            place(ball(3, 1), { at: [0, -2, -72] }),
        ],
    };
}

function buildDart() {
    return {
        hull: [
            place(nose(1.9, 13, 8), { at: [0, 0, -2], scale: [1, 0.7, 1] }),
            place(nose(7.5, 9, 3), { at: [0, -0.2, 3.5], rot: [0, 0, Math.PI], scale: [1, 0.12, 1] }),
            place(box(0.4, 2.6, 3), { at: [0, 1.4, 5.5] }),
        ],
        glow: [
            place(ball(1.2), { at: [0, 0, 5.2] }),
            place(box(0.5, 0.4, 3), { at: [0, 0.8, -2.5] }),
        ],
    };
}

function buildBuoy() {
    return {
        hull: [
            place(new THREE.OctahedronGeometry(6, 0)),
            place(box(0.5, 20, 0.5)),
            place(box(16, 0.5, 0.5)),
            place(box(0.5, 0.5, 16)),
        ],
        glow: [
            place(ball(1.6), { at: [0, 10.5, 0] }),
            place(ball(1.2), { at: [0, -10.5, 0] }),
        ],
    };
}

const MODEL_BUILDERS = Object.freeze({
    drone: buildDrone,
    raider: buildRaider,
    lancer: buildLancer,
    warden: buildWarden,
    eclipse: buildEclipse,
    shieldGenerator: buildShieldGenerator,
    harrier: buildHarrier,
    dart: buildDart,
    buoy: buildBuoy,
});

// ---- Materials and caching ----------------------------------------------------------------

/** Emissive colours are pushed past 1.0 so the bloom pass makes them glow. */
function glowMaterial(color, intensity) {
    const material = new THREE.MeshBasicMaterial({ color });
    material.color.multiplyScalar(intensity);
    material.toneMapped = false;
    return material;
}

let palettes = null;
function getPalettes() {
    palettes ??= {
        [FACTION.UMBRA]: {
            hull: new THREE.MeshStandardMaterial({ color: '#6a5878', metalness: 0.45, roughness: 0.5, flatShading: true }),
            glow: glowMaterial('#ff2a6d', 2.4),
        },
        [FACTION.DAWN]: {
            hull: new THREE.MeshStandardMaterial({ color: '#d3dce6', metalness: 0.4, roughness: 0.45, flatShading: true }),
            glow: glowMaterial('#45cfff', 2.2),
        },
        [FACTION.NEUTRAL]: {
            hull: new THREE.MeshStandardMaterial({ color: '#a9adb5', metalness: 0.4, roughness: 0.5, flatShading: true }),
            glow: glowMaterial('#ffd36b', 2.4),
        },
    };
    return palettes;
}

const geometryCache = new Map();
function getGeometries(modelId) {
    if (!geometryCache.has(modelId)) {
        const builder = MODEL_BUILDERS[modelId];
        if (!builder) throw new Error(`No model builder for "${modelId}"`);
        const parts = builder();
        geometryCache.set(modelId, {
            hull: mergeGeometries(parts.hull, false),
            glow: mergeGeometries(parts.glow, false),
        });
    }
    return geometryCache.get(modelId);
}

export function hasShipModel(modelId) {
    return modelId in MODEL_BUILDERS;
}

/**
 * Creates a renderable ship. Geometry and materials are shared between all ships of the
 * same model / faction, so creating many is cheap.
 * @returns {THREE.Group} with `userData.glow` pointing at the emissive mesh
 */
export function createShipModel(modelId, faction) {
    const geometries = getGeometries(modelId);
    const palette = getPalettes()[faction] ?? getPalettes()[FACTION.NEUTRAL];
    const group = new THREE.Group();
    const hull = new THREE.Mesh(geometries.hull, palette.hull);
    const glow = new THREE.Mesh(geometries.glow, palette.glow);
    group.add(hull, glow);
    group.userData.glow = glow;
    return group;
}

/** A lumpy rock used (instanced) for asteroid fields. Radius is roughly 1. */
export function createAsteroidGeometry() {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        // Cheap deterministic "noise" from the vertex direction keeps shared vertices welded.
        const bump = Math.sin(vertex.x * 5.1) * Math.cos(vertex.y * 4.3) * Math.sin(vertex.z * 3.7 + 1.3);
        vertex.multiplyScalar(0.82 + bump * 0.22);
        positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
    return geometry;
}
