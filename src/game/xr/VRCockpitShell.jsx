import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useGameStore } from '../state/gameStore.js';

/**
 * The back half of the cockpit, for VR only: a luxury cabin behind the pilot.
 *
 * cockpit.glb was built for a flat screen, where only what lies ahead is ever seen (canopy
 * frame, dashboard, side consoles), and it is open behind and below the pilot. In a headset
 * the pilot can turn round, so this adds, in the cockpit model's own frame (eye at the
 * origin, -z ahead, metres):
 *  - a sculpted seat: quilted saddle-leather centre, black leather bolsters, a floating
 *    headrest, armrests with satin-metal caps, on a metal pedestal;
 *  - a curved rear wall (an ellipse that meets the canopy's rear arch) lined with quilted
 *    black leather between a satin-metal waist rail and a piano-black band, a fabric
 *    headliner, carpet on the floor;
 *  - ambient lighting: thin light lines along the waist rail, the roof edge and the floor
 *    (under the consoles), each with a soft halo. Their colour follows the power mode -
 *    blue balanced, cyan defense, red attack - and fades between them. Kept dim on purpose.
 *
 * Everything is merged into one mesh per material (eight draw calls), and the one fill
 * light (which was already there) takes the ambient colour instead of adding a light.
 */

/** Ambient-light colours per power mode. */
const AMBIENT_COLOURS = Object.freeze({
    balanced: new THREE.Color('#3f7bff'),
    defense: new THREE.Color('#25d6d0'),
    attack: new THREE.Color('#ff3346'),
});
/** Brightness of the light lines (they are not tone mapped, so 1 = full colour). */
const LINE_BRIGHTNESS = 0.8;
const HALO_OPACITY = 0.16;
const FILL_INTENSITY = 0.3;
/** How fast the colour follows a mode change (1/s). */
const COLOUR_FOLLOW = 3.5;

// ---- The rear wall: half an ellipse in plan, meeting the canopy arch at z = 0.5 ----------
const WALL_CENTRE_Z = 0.5;
const WALL_DEPTH = 0.75;
const WALL_HALF_WIDTH = 1.9;
const WALL_STRETCH = WALL_HALF_WIDTH / WALL_DEPTH;

/** A strip of the rear wall between heights y0 and y1, inset by `inset` metres. */
function wallBand(y0, y1, { inset = 0, arc = Math.PI, segments = 48 } = {}) {
    const radius = WALL_DEPTH - inset;
    const geometry = new THREE.CylinderGeometry(radius, radius, y1 - y0, segments, 1, true, -arc / 2, arc);
    geometry.scale((WALL_HALF_WIDTH - inset) / radius, 1, 1);
    geometry.translate(0, (y0 + y1) / 2, WALL_CENTRE_Z);
    return flipInwards(geometry);
}

/** A point on the wall's ellipse at angle `theta` (0 = straight behind), inset by `inset`. */
function wallPoint(theta, y, inset) {
    return new THREE.Vector3(Math.sin(theta) * (WALL_HALF_WIDTH - inset), y, WALL_CENTRE_Z + Math.cos(theta) * (WALL_DEPTH - inset));
}

/** Turns a surface built facing outwards to face the inside of the cabin. */
function flipInwards(geometry) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const attribute of Object.values(flat.attributes)) {
        const { array, itemSize } = attribute;
        for (let tri = 0; tri < attribute.count; tri += 3) {
            for (let k = 0; k < itemSize; k++) {
                const a = (tri + 1) * itemSize + k;
                const b = (tri + 2) * itemSize + k;
                [array[a], array[b]] = [array[b], array[a]];
            }
        }
    }
    const normals = flat.attributes.normal.array;
    for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
    return flat;
}

function box(sx, sy, sz, x, y, z, { radius = 0, rotationX = 0 } = {}) {
    const geometry = radius > 0 ? new RoundedBoxGeometry(sx, sy, sz, 3, radius) : new THREE.BoxGeometry(sx, sy, sz);
    if (rotationX) geometry.rotateX(rotationX);
    geometry.translate(x, y, z);
    return geometry;
}

/** A thin tube along `points` (a light line), and a wider one for its halo. */
function lightLine(points, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
    const segments = Math.max(8, Math.round(curve.getLength() * 20));
    return {
        core: new THREE.TubeGeometry(curve, segments, 0.006, 6, closed),
        halo: new THREE.TubeGeometry(curve, segments, 0.022, 8, closed),
    };
}

/** Points along the wall's ellipse from -arc/2 to +arc/2. */
function wallArc(y, inset, arc, count = 32) {
    return Array.from({ length: count + 1 }, (_, i) => wallPoint(-arc / 2 + (arc * i) / count, y, inset));
}

/** Gives every part the same attributes (hull plating also needs RGBA vertex colours), then merges. */
function merge(parts, colour = null) {
    const prepared = parts.map((part) => {
        const flat = part.index ? part.toNonIndexed() : part;
        if (flat !== part) part.dispose();
        if (colour) {
            const colours = new Float32Array(flat.attributes.position.count * 4);
            for (let i = 0; i < colours.length; i += 4) colours.set(colour, i);
            flat.setAttribute('color', new THREE.BufferAttribute(colours, 4));
        }
        return flat;
    });
    const merged = mergeGeometries(prepared);
    prepared.forEach((part) => part.dispose());
    return merged;
}

/** Diamond quilting for the leather: stitched seams on a soft base, used as colour and bump. */
function createQuiltTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, size, size);
    // Each diamond is padded: lighter in the middle, darker into the seams.
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#bdbdbd');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size, size / 2);
    ctx.lineTo(size / 2, size);
    ctx.lineTo(0, size / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6a6a6a';
    ctx.lineWidth = 7;
    ctx.stroke();
    // Stitching alongside each seam.
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    for (const offset of [-11, 11]) {
        ctx.moveTo(size / 2, offset);
        ctx.lineTo(size + offset, size / 2);
        ctx.lineTo(size / 2, size + offset);
        ctx.lineTo(offset, size / 2);
        ctx.closePath();
    }
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

function buildCabin() {
    const quilt = createQuiltTexture();
    const quiltColour = quilt.clone();
    quiltColour.colorSpace = THREE.SRGBColorSpace;
    quiltColour.repeat.set(5, 5);
    quilt.repeat.set(5, 5);

    const materials = {
        saddle: new THREE.MeshStandardMaterial({ color: '#7a4a2c', map: quiltColour, bumpMap: quilt, bumpScale: 2.5, roughness: 0.55, metalness: 0 }),
        leather: new THREE.MeshStandardMaterial({ color: '#1a1716', roughness: 0.5, metalness: 0 }),
        quiltedBlack: new THREE.MeshStandardMaterial({ color: '#2a2523', map: quiltColour, bumpMap: quilt, bumpScale: 2, roughness: 0.55, metalness: 0 }),
        metal: new THREE.MeshStandardMaterial({ color: '#c3c7cf', roughness: 0.28, metalness: 1 }),
        piano: new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.12, metalness: 0.1 }),
        fabric: new THREE.MeshStandardMaterial({ color: '#1e1f24', roughness: 1, metalness: 0 }),
        line: new THREE.MeshBasicMaterial({ color: AMBIENT_COLOURS.balanced, toneMapped: false }),
        halo: new THREE.MeshBasicMaterial({ color: AMBIENT_COLOURS.balanced, toneMapped: false, transparent: true, opacity: HALO_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    // The wall is long and low: its quilting repeats more along it so the diamonds stay square.
    const wallQuilt = quilt.clone();
    const wallQuiltColour = quiltColour.clone();
    wallQuilt.repeat.set(18, 5);
    wallQuiltColour.repeat.set(18, 5);
    materials.quiltedBlack.map = wallQuiltColour;
    materials.quiltedBlack.bumpMap = wallQuilt;
    const textures = [quilt, quiltColour, wallQuilt, wallQuiltColour];

    const pieces = {
        // The structure, in the ship's own plating so it ties into the cockpit model.
        hull: [
            box(3.9, 0.1, 3.75, 0, -1.3, -0.6),
            box(0.1, 0.62, 3.0, -1.95, -0.95, -0.95),
            box(0.1, 0.62, 3.0, 1.95, -0.95, -0.95),
            wallBand(-1.3, -0.68, { inset: 0 }),
            wallBand(0.98, 1.27, { inset: 0 }),
        ],
        // Seat centre panels.
        saddle: [
            box(0.36, 0.08, 0.5, 0, -0.73, -0.04, { radius: 0.035 }),
            box(0.34, 0.62, 0.07, 0, -0.33, 0.29, { radius: 0.03, rotationX: 0.14 }),
        ],
        leather: [
            // Cushion base and its side bolsters.
            box(0.6, 0.1, 0.58, 0, -0.81, -0.02, { radius: 0.04 }),
            box(0.12, 0.14, 0.54, -0.25, -0.73, -0.03, { radius: 0.05 }),
            box(0.12, 0.14, 0.54, 0.25, -0.73, -0.03, { radius: 0.05 }),
            // Backrest shell and bolsters.
            box(0.56, 0.78, 0.1, 0, -0.32, 0.36, { radius: 0.045, rotationX: 0.14 }),
            box(0.12, 0.66, 0.15, -0.25, -0.36, 0.3, { radius: 0.05, rotationX: 0.14 }),
            box(0.12, 0.66, 0.15, 0.25, -0.36, 0.3, { radius: 0.05, rotationX: 0.14 }),
            // Floating headrest.
            box(0.3, 0.22, 0.11, 0, 0.24, 0.4, { radius: 0.05, rotationX: 0.1 }),
            // Armrests.
            box(0.11, 0.07, 0.42, -0.42, -0.52, 0.04, { radius: 0.03 }),
            box(0.11, 0.07, 0.42, 0.42, -0.52, 0.04, { radius: 0.03 }),
            // Door-panel style upholstery on the lower side walls, behind the consoles' reach.
            box(0.04, 0.32, 1.2, -1.88, -0.92, -0.1, { radius: 0.015 }),
            box(0.04, 0.32, 1.2, 1.88, -0.92, -0.1, { radius: 0.015 }),
        ],
        quiltedBlack: [wallBand(-0.6, 0.78, { inset: 0.02 })],
        metal: [
            // Waist rail around the rear wall, headrest posts, armrest caps, seat pedestal.
            wallBand(-0.68, -0.6, { inset: 0.03 }),
            box(0.025, 0.12, 0.025, -0.08, 0.1, 0.39),
            box(0.025, 0.12, 0.025, 0.08, 0.1, 0.39),
            box(0.115, 0.075, 0.06, -0.42, -0.52, -0.19, { radius: 0.02 }),
            box(0.115, 0.075, 0.06, 0.42, -0.52, -0.19, { radius: 0.02 }),
            box(0.36, 0.38, 0.36, 0, -1.06, 0.02, { radius: 0.04 }),
        ],
        piano: [
            wallBand(0.78, 0.98, { inset: 0.025 }),
            // Gloss backs of the seat and headrest.
            box(0.5, 0.7, 0.02, 0, -0.3, 0.42, { radius: 0.008, rotationX: 0.14 }),
        ],
        fabric: [
            // Headliner (half an ellipse, facing down) and the carpet.
            (() => {
                const roof = new THREE.CircleGeometry(WALL_DEPTH, 40, 0, Math.PI);
                roof.rotateX(Math.PI / 2);
                roof.scale(WALL_STRETCH, 1, 1);
                roof.translate(0, 1.26, WALL_CENTRE_Z);
                return roof;
            })(),
            box(3.0, 0.02, 3.2, 0, -1.24, -0.55),
        ],
    };

    // Ambient light lines: under the waist rail's top edge, along the roof edge, and at the
    // floor (running forward under the consoles, so it reads as indirect footwell light).
    const lines = [
        lightLine(wallArc(-0.585, 0.045, Math.PI * 0.98)),
        lightLine(wallArc(0.965, 0.05, Math.PI * 0.75)),
        lightLine([new THREE.Vector3(-1.86, -1.215, -2.1), ...wallArc(-1.215, 0.04, Math.PI, 40), new THREE.Vector3(1.86, -1.215, -2.1)]),
    ];

    const geometries = {
        hull: merge(pieces.hull, [0.13, 0.14, 0.19, 1]),
        saddle: merge(pieces.saddle),
        leather: merge(pieces.leather),
        quiltedBlack: merge(pieces.quiltedBlack),
        metal: merge(pieces.metal),
        piano: merge(pieces.piano),
        fabric: merge(pieces.fabric),
        line: merge(lines.map((line) => line.core)),
        halo: merge(lines.map((line) => line.halo)),
    };
    return {
        materials,
        geometries,
        dispose() {
            Object.values(geometries).forEach((geometry) => geometry.dispose());
            Object.values(materials).forEach((material) => material.dispose());
            textures.forEach((texture) => texture.dispose());
        },
    };
}

export default function VRCockpitShell({ materials: shipMaterials }) {
    const cabin = useMemo(() => buildCabin(), []);
    const hullMaterial = useMemo(() => shipMaterials.resolve({ name: 'hull', metalness: 0.75, roughness: 1 }), [shipMaterials]);
    const fillRef = useRef(null);
    const colour = useMemo(() => new THREE.Color().copy(AMBIENT_COLOURS.balanced), []);

    useEffect(() => () => cabin.dispose(), [cabin]);

    useFrame((_, delta) => {
        const mode = useGameStore.getState().hud?.powerMode ?? 'balanced';
        colour.lerp(AMBIENT_COLOURS[mode] ?? AMBIENT_COLOURS.balanced, 1 - Math.exp(-COLOUR_FOLLOW * delta));
        cabin.materials.line.color.copy(colour).multiplyScalar(LINE_BRIGHTNESS);
        cabin.materials.halo.color.copy(colour);
        if (fillRef.current) fillRef.current.color.copy(colour);
    });

    const { geometries, materials } = cabin;
    return (
        <>
            <mesh geometry={geometries.hull} material={hullMaterial} frustumCulled={false} />
            {['saddle', 'leather', 'quiltedBlack', 'metal', 'piano', 'fabric'].map((name) => (
                <mesh key={name} geometry={geometries[name]} material={materials[name]} frustumCulled={false} />
            ))}
            <mesh geometry={geometries.line} material={materials.line} frustumCulled={false} />
            <mesh geometry={geometries.halo} material={materials.halo} frustumCulled={false} renderOrder={1} />
            {/* The cabin's one fill light, tinted with the ambient colour. */}
            <pointLight ref={fillRef} position={[0, 0.6, 0.75]} intensity={FILL_INTENSITY} distance={2.6} decay={1.2} />
        </>
    );
}
