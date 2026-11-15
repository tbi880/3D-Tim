import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useGameStore } from '../state/gameStore.js';

/**
 * The cockpit interior for VR: a luxury cabin built round the pilot.
 *
 * cockpit.glb was built for a flat screen (only what lies ahead is ever seen, and it is
 * steel ship plating with the long nose out in front), so in VR it is not drawn and this
 * cabin replaces it, in the cockpit model's own frame (eye at the origin, -z ahead, metres):
 *  - a wraparound dashboard that runs into the door sills: microfibre top, a satin-metal
 *    strip, open-pore walnut, cognac leather below, turbine air vents, and a piano-black
 *    housing under the flight display;
 *  - a sculpted seat: quilted cognac centre, black bolsters, floating headrest, armrests;
 *  - a curved rear wall in quilted black leather between a satin-metal waist rail and a
 *    piano-black band, a fabric headliner, carpet, and a slim piano-black canopy frame
 *    (rear arch and two roof rails) so the view ahead stays open;
 *  - ambient lighting: thin light lines round the waist (dash edge and rear rail), along the
 *    roof edge and round the footwell, each with a soft halo. Their colour follows the
 *    power mode - blue balanced, cyan defense, red attack - and fades between them.
 *
 * Everything is merged into one mesh per material (eleven draw calls), and the one fill
 * light takes the ambient colour instead of adding a light.
 */

/**
 * The whole cabin (seat included) is drawn this much larger round the pilot's eye, so it
 * sits further away in the headset. VRHud scales the instrument display the same way.
 */
export const CABIN_SCALE = 1.5;

/** Ambient-light colours per power mode. */
const AMBIENT_COLOURS = Object.freeze({
    balanced: new THREE.Color('#3f7bff'),
    defense: new THREE.Color('#25d6d0'),
    attack: new THREE.Color('#ff3346'),
});
/** Brightness of the light lines (they are not tone mapped, so 1 = full colour). */
const LINE_BRIGHTNESS = 0.8;
const HALO_OPACITY = 0.16;
const FILL_INTENSITY = 0.9;
/** Faint self-illumination of the cabin surfaces (fraction of their colour). */
const SELF_LIGHT = 0.22;
/** How fast the colour follows a mode change (1/s). */
const COLOUR_FOLLOW = 3.5;
/** Travelling pulses along the light lines. */
const PULSE_SPACING = 2.6;
const PULSE_SPEED = 0.9;
/** Fibre-optic stars in the roof. */
const STAR_COUNT = 260;
const X_AXIS = new THREE.Vector3(1, 0, 0);

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

/** A part of the seat (or anything sized to the pilot): left out of the room scaling. */
function seatBox(...args) {
    const geometry = box(...args);
    geometry.userData.seat = true;
    return geometry;
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
    const length = curve.getLength();
    const segments = Math.max(8, Math.round(length * 20));
    // u runs along the line in metres, so the travelling light pulses keep one pace everywhere.
    const metres = (geometry) => {
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length);
        return geometry;
    };
    return {
        core: metres(new THREE.TubeGeometry(curve, segments, 0.006, 6, closed)),
        halo: metres(new THREE.TubeGeometry(curve, segments, 0.022, 8, closed)),
    };
}

/** A light line that belongs to the seat (left out of the room scaling). */
function seatLine(points) {
    const line = lightLine(points);
    line.core.userData.seat = true;
    line.halo.userData.seat = true;
    return line;
}

/**
 * The material of the ambient light lines: the ambient colour with slow pulses of light
 * travelling along every line (u is metres along it), like current through a fibre.
 */
function createLightMaterial({ opacity = 1, additive = false } = {}) {
    return new THREE.ShaderMaterial({
        uniforms: {
            color: { value: new THREE.Color() },
            opacity: { value: opacity },
            time: { value: 0 },
        },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying float vAlong;
            void main() {
                vAlong = uv.x;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            uniform vec3 color;
            uniform float opacity;
            uniform float time;
            varying float vAlong;
            #include <logdepthbuf_pars_fragment>
            void main() {
                #include <logdepthbuf_fragment>
                // A pulse every ${PULSE_SPACING.toFixed(2)} m, moving at ${PULSE_SPEED.toFixed(2)} m/s, with a soft tail.
                float phase = fract(vAlong / ${PULSE_SPACING.toFixed(2)} - time * ${(PULSE_SPEED / PULSE_SPACING).toFixed(4)});
                float pulse = exp(-phase * 9.0) + exp(-(1.0 - phase) * 40.0);
                gl_FragColor = vec4(color * (0.75 + 0.65 * pulse), opacity);
                #include <colorspace_fragment>
            }`,
        transparent: additive,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !additive,
        toneMapped: false,
    });
}

/**
 * Starlight headliner: a few hundred fibre-optic points in the roof that twinkle slowly,
 * each on its own beat.
 */
function createStarMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, tint: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            attribute vec2 star;
            varying float vGlow;
            uniform float time;
            void main() {
                // star.x: phase, star.y: size and brightness (0..1).
                vGlow = (0.35 + 0.65 * star.y) * (0.55 + 0.45 * sin(time * (0.6 + star.y) + star.x));
                gl_PointSize = 1.5 + 2.5 * star.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            uniform vec3 tint;
            varying float vGlow;
            #include <logdepthbuf_pars_fragment>
            void main() {
                #include <logdepthbuf_fragment>
                vec2 p = gl_PointCoord - 0.5;
                float round = smoothstep(0.5, 0.15, length(p));
                gl_FragColor = vec4(mix(vec3(1.0, 0.95, 0.86), tint, 0.25) * vGlow * round, 1.0);
                #include <colorspace_fragment>
            }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
}

/** Fibre-optic stars scattered over the headliner and the band below it. */
function starlightGeometry() {
    let seed = 11;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const positions = [];
    const stars = [];
    // In the roof: uniform over the half-ellipse (just under the headliner).
    for (let i = 0; i < STAR_COUNT; i++) {
        const r = Math.sqrt(random()) * (WALL_DEPTH - 0.04);
        const a = (random() - 0.5) * Math.PI;
        positions.push(Math.sin(a) * r * WALL_STRETCH, 1.255, WALL_CENTRE_Z + Math.cos(a) * r);
        stars.push(random() * Math.PI * 2, random() ** 2);
    }
    // A sparser scatter on the band above the piano black.
    for (let i = 0; i < STAR_COUNT / 3; i++) {
        const point = wallPoint((random() - 0.5) * Math.PI * 0.95, 1.0 + random() * 0.24, 0.006);
        positions.push(point.x, point.y, point.z);
        stars.push(random() * Math.PI * 2, random() ** 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('star', new THREE.Float32BufferAttribute(stars, 2));
    return geometry;
}

/** Points along the wall's ellipse from -arc/2 to +arc/2. */
function wallArc(y, inset, arc, count = 32) {
    return Array.from({ length: count + 1 }, (_, i) => wallPoint(-arc / 2 + (arc * i) / count, y, inset));
}

// ---- The front: a "U" from the rear arch forward round the dashboard and back --------------
const FRONT_CENTRE_Z = -0.55;
const FRONT_DEPTH = 1.05;
const DASH_TOP_Y = -0.6;
const FLOOR_Y = -1.25;

/** Plan points of the U: {x, z, nx, nz (inward normal), w (1 dead ahead, 0 at the sides)}. */
function buildFrontPath() {
    const path = [];
    const sideSteps = 6;
    const curveSteps = 56;
    // Left sill, from the rear arch forward (stopping short of where the curve starts).
    for (let i = 0; i < sideSteps; i++) {
        path.push({ x: -WALL_HALF_WIDTH, z: WALL_CENTRE_Z + ((FRONT_CENTRE_Z - WALL_CENTRE_Z) * i) / sideSteps, nx: 1, nz: 0, w: 0 });
    }
    // The dashboard: half an ellipse ahead of the pilot.
    for (let i = 0; i <= curveSteps; i++) {
        const theta = -Math.PI / 2 + (Math.PI * i) / curveSteps;
        const nx = -Math.sin(theta) / WALL_HALF_WIDTH;
        const nz = Math.cos(theta) / FRONT_DEPTH;
        const length = Math.hypot(nx, nz);
        path.push({ x: Math.sin(theta) * WALL_HALF_WIDTH, z: FRONT_CENTRE_Z - Math.cos(theta) * FRONT_DEPTH, nx: nx / length, nz: nz / length, w: Math.cos(theta) ** 2 });
    }
    // Right sill, back to the rear arch.
    for (let i = 1; i <= sideSteps; i++) {
        path.push({ x: WALL_HALF_WIDTH, z: FRONT_CENTRE_Z + ((WALL_CENTRE_Z - FRONT_CENTRE_Z) * i) / sideSteps, nx: -1, nz: 0, w: 0 });
    }
    return path;
}
const FRONT_PATH = buildFrontPath();

/** How deep the dash top is (from the shell inwards): a sill at the sides, deep ahead. */
const dashInset = (w) => 0.03 + 0.93 * w ** 1.5;

/** A row of points along the U at height y, `inset(w)` metres in from the shell. */
function frontRow(inset, y) {
    return FRONT_PATH.map(({ x, z, nx, nz, w }) => {
        const d = typeof inset === 'function' ? inset(w) : inset;
        return new THREE.Vector3(x + nx * d, y, z + nz * d);
    });
}

/**
 * The room is built at a compact size and then widened round the pilot: x and z by
 * ROOM_SCALE, and heights above the eye too (more headroom), while everything below the eye
 * keeps its height so the floor, sills and dash stay where a seated pilot expects them.
 * The seat and the display housing are left at human size.
 */
const ROOM_SCALE = 1.25;
function scaleRoom(geometry) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    for (let i = 0; i < position.count; i++) {
        const above = position.getY(i) > 0;
        const sy = above ? ROOM_SCALE : 1;
        position.setXYZ(i, position.getX(i) * ROOM_SCALE, position.getY(i) * sy, position.getZ(i) * ROOM_SCALE);
        if (normal && !above) {
            // Inverse-transpose of the scale: x and z shrink relative to y below the eye.
            const nx = normal.getX(i) / ROOM_SCALE; const ny = normal.getY(i); const nz = normal.getZ(i) / ROOM_SCALE;
            const length = Math.hypot(nx, ny, nz) || 1;
            normal.setXYZ(i, nx / length, ny / length, nz / length);
        }
    }
    position.needsUpdate = true;
    return geometry;
}

/**
 * A strip between two rows of points, facing `towards` (a function of a point giving the
 * direction the surface should face there). u runs along the strip in metres, v across it.
 */
function ribbon(rowA, rowB, towards) {
    const count = rowA.length;
    const positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    let u = 0;
    for (let i = 0; i < count; i++) {
        if (i > 0) u += rowA[i].distanceTo(rowA[i - 1]);
        rowA[i].toArray(positions, i * 6);
        rowB[i].toArray(positions, i * 6 + 3);
        uvs.set([u, 0, u, 1], i * 4);
    }
    // Pick the winding so the strip faces the right way (checked at its middle).
    const mid = Math.floor(count / 2);
    const a = rowA[mid];
    const normal = new THREE.Vector3().subVectors(rowB[mid], a).cross(new THREE.Vector3().subVectors(rowA[mid + 1], a));
    const flip = normal.dot(towards(a)) < 0;
    const index = [];
    for (let i = 0; i < count - 1; i++) {
        const a0 = i * 2; const b0 = a0 + 1; const a1 = a0 + 2; const b1 = a0 + 3;
        if (flip) index.push(a0, a1, b0, b0, a1, b1);
        else index.push(a0, b0, a1, b0, b1, a1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
}
const UP = () => new THREE.Vector3(0, 1, 0);
const DOWN = () => new THREE.Vector3(0, -1, 0);
/** Faces the pilot (the vertical axis through the eye). */
const INWARD = (point) => new THREE.Vector3(-point.x, 0, -point.z);

/** A vertical band of the dash face between heights y0 and y1, `inset` in from the shell. */
const faceBand = (inset, y0, y1) => ribbon(frontRow(inset, y0), frontRow(inset, y1), INWARD);

/** A turbine air vent set into the dash face at path angle `theta` (0 = ahead). */
function airVent(theta, y) {
    const i = Math.round(6 + ((theta + Math.PI / 2) / Math.PI) * 56);
    const { x, z, nx, nz, w } = FRONT_PATH[i];
    const d = dashInset(w);
    const place = (geometry, out) => {
        geometry.rotateX(Math.PI / 2);
        geometry.rotateY(Math.atan2(nx, nz));
        geometry.translate(x + nx * (d + out), y, z + nz * (d + out));
        return geometry;
    };
    // A thin ring of ambient light between the bezel and the hub, facing the pilot.
    const glow = new THREE.RingGeometry(0.031, 0.04, 28);
    glow.rotateY(Math.atan2(nx, nz));
    glow.translate(x + nx * (d + 0.029), y, z + nz * (d + 0.029));
    const uv = glow.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0);
    return {
        ring: place(new THREE.CylinderGeometry(0.048, 0.044, 0.03, 28), 0.012),
        hub: place(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20), 0.018),
        glow,
    };
}

/** Open-pore walnut: dark grain lines over a warm brown, as a repeating colour map. */
function createWoodTexture() {
    const width = 512;
    const height = 128;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#74482a';
    ctx.fillRect(0, 0, width, height);
    // Deterministic pseudo-random so the grain is the same every run.
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 70; k++) {
        const y0 = random() * height;
        const amplitude = 2 + random() * 6;
        const wave = 1 + random() * 3;
        const phase = random() * Math.PI * 2;
        const shade = random();
        ctx.strokeStyle = shade < 0.6 ? `rgba(30, 16, 8, ${0.25 + random() * 0.35})` : `rgba(140, 92, 52, ${0.15 + random() * 0.25})`;
        ctx.lineWidth = 0.6 + random() * 2.2;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 8) {
            const y = y0 + Math.sin((x / width) * Math.PI * 2 * wave + phase) * amplitude;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / 1.4, 1);
    texture.anisotropy = 4;
    return texture;
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

/** The canopy frame: the rear arch, and one roof rail (mirrored for the other side). */
const CANOPY_ARCH = [
    [-1.9, FLOOR_Y], [-1.9, 0.95], [-1.72, 1.22], [-1.4, 1.28], [1.4, 1.28], [1.72, 1.22], [1.9, 0.95], [1.9, FLOOR_Y],
].map(([x, y]) => new THREE.Vector3(x, y, WALL_CENTRE_Z));
const CANOPY_RAIL = [[1.86, -0.6, -0.95], [1.8, 0.1, -0.8], [1.6, 0.75, -0.45], [1.32, 1.14, 0.05], [1.2, 1.28, WALL_CENTRE_Z]];

/** A point moved `metres` towards the pilot's eye (onto the inner face of a frame tube). */
function towardsEye(point, metres) {
    return point.clone().multiplyScalar(1 - metres / point.length());
}

function buildCabin() {
    const quilt = createQuiltTexture();
    const quiltColour = quilt.clone();
    quiltColour.colorSpace = THREE.SRGBColorSpace;
    quiltColour.repeat.set(5, 5);
    quilt.repeat.set(5, 5);
    const wood = createWoodTexture();

    const materials = {
        saddle: new THREE.MeshStandardMaterial({ color: '#7a4a2c', map: quiltColour, bumpMap: quilt, bumpScale: 2.5, roughness: 0.55, metalness: 0 }),
        cognac: new THREE.MeshStandardMaterial({ color: '#6e4128', roughness: 0.5, metalness: 0 }),
        leather: new THREE.MeshStandardMaterial({ color: '#2b2624', roughness: 0.5, metalness: 0 }),
        quiltedBlack: new THREE.MeshStandardMaterial({ color: '#3a3330', map: quiltColour, bumpMap: quilt, bumpScale: 2, roughness: 0.55, metalness: 0 }),
        wood: new THREE.MeshStandardMaterial({ color: '#ffffff', map: wood, roughness: 0.62, metalness: 0 }),
        metal: new THREE.MeshStandardMaterial({ color: '#c3c7cf', roughness: 0.28, metalness: 1 }),
        piano: new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.12, metalness: 0.1 }),
        fabric: new THREE.MeshStandardMaterial({ color: '#2e2f36', roughness: 1, metalness: 0 }),
        line: createLightMaterial(),
        halo: createLightMaterial({ opacity: HALO_OPACITY, additive: true }),
        stars: createStarMaterial(),
    };
    // The wall is long and low: its quilting repeats more along it so the diamonds stay square.
    const wallQuilt = quilt.clone();
    const wallQuiltColour = quiltColour.clone();
    wallQuilt.repeat.set(18, 5);
    wallQuiltColour.repeat.set(18, 5);
    materials.quiltedBlack.map = wallQuiltColour;
    materials.quiltedBlack.bumpMap = wallQuilt;
    const textures = [quilt, quiltColour, wallQuilt, wallQuiltColour, wood];

    // The dash face, top to bottom: metal strip, walnut, then cognac leather set back a little.
    const inner = dashInset;
    const woodTop = DASH_TOP_Y - 0.04;
    const woodBottom = DASH_TOP_Y - 0.2;
    // At the sides (w = 0) the cognac meets the shell, in line with the rear wall's.
    const recessed = (w) => inner(w) - 0.03 + 0.07 * w;
    const vents = [-0.95, -0.45, 0.45, 0.95].map((theta) => airVent(theta, (woodTop + woodBottom) / 2));

    // The flight display (VRHud's dashboard panel) sits in a piano-black housing.
    const DISPLAY_TILT = -0.6;
    const displayNormal = new THREE.Vector3(0, Math.sin(-DISPLAY_TILT), Math.cos(DISPLAY_TILT));
    const housingCentre = new THREE.Vector3(0, -0.5, -0.72).addScaledVector(displayNormal, -0.03);

    const pieces = {
        saddle: [
            // Seat centre panels.
            seatBox(0.36, 0.08, 0.5, 0, -0.73, -0.04, { radius: 0.035 }),
            seatBox(0.34, 0.62, 0.07, 0, -0.33, 0.29, { radius: 0.03, rotationX: 0.14 }),
        ],
        cognac: [
            faceBand(recessed, FLOOR_Y, woodBottom),
            // Lower rear wall, behind the seat.
            wallBand(FLOOR_Y - 0.05, -0.6, { inset: 0 }),
        ],
        leather: [
            // Cushion base and its side bolsters.
            seatBox(0.6, 0.1, 0.58, 0, -0.81, -0.02, { radius: 0.04 }),
            seatBox(0.12, 0.14, 0.54, -0.25, -0.73, -0.03, { radius: 0.05 }),
            seatBox(0.12, 0.14, 0.54, 0.25, -0.73, -0.03, { radius: 0.05 }),
            // Backrest shell and bolsters.
            seatBox(0.56, 0.78, 0.1, 0, -0.32, 0.36, { radius: 0.045, rotationX: 0.14 }),
            seatBox(0.12, 0.66, 0.15, -0.25, -0.36, 0.3, { radius: 0.05, rotationX: 0.14 }),
            seatBox(0.12, 0.66, 0.15, 0.25, -0.36, 0.3, { radius: 0.05, rotationX: 0.14 }),
            // Floating headrest.
            seatBox(0.3, 0.22, 0.11, 0, 0.24, 0.4, { radius: 0.05, rotationX: 0.1 }),
            // Armrests.
            seatBox(0.11, 0.07, 0.42, -0.42, -0.52, 0.04, { radius: 0.03 }),
            seatBox(0.11, 0.07, 0.42, 0.42, -0.52, 0.04, { radius: 0.03 }),
            // The underside of the walnut where the cognac steps back.
            ribbon(frontRow(inner, woodBottom), frontRow(recessed, woodBottom), DOWN),
        ],
        wood: [faceBand(inner, woodBottom, woodTop)],
        quiltedBlack: [wallBand(-0.6, 0.78, { inset: 0.02 })],
        metal: [
            faceBand(inner, woodTop, DASH_TOP_Y),
            // Waist rail around the rear wall, headrest posts, armrest caps, seat pedestal.
            wallBand(-0.68, -0.6, { inset: 0.03 }),
            seatBox(0.025, 0.12, 0.025, -0.08, 0.1, 0.39),
            seatBox(0.025, 0.12, 0.025, 0.08, 0.1, 0.39),
            seatBox(0.115, 0.075, 0.06, -0.42, -0.52, -0.19, { radius: 0.02 }),
            seatBox(0.115, 0.075, 0.06, 0.42, -0.52, -0.19, { radius: 0.02 }),
            seatBox(0.36, 0.38, 0.36, 0, -1.06, 0.02, { radius: 0.04 }),
            ...vents.map((vent) => vent.ring),
        ],
        piano: [
            wallBand(0.78, 0.98, { inset: 0.025 }),
            // Gloss backs of the seat and headrest.
            seatBox(0.5, 0.7, 0.02, 0, -0.3, 0.42, { radius: 0.008, rotationX: 0.14 }),
            // A low cowl along the dash's outer edge, the display housing, the vent hubs.
            faceBand(0, DASH_TOP_Y, DASH_TOP_Y + 0.05),
            seatBox(0.8, 0.33, 0.04, housingCentre.x, housingCentre.y, housingCentre.z, { radius: 0.015, rotationX: DISPLAY_TILT }),
            ...vents.map((vent) => vent.hub),
            // The canopy frame: the rear arch and two slim roof rails sweeping up from the sills.
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(CANOPY_ARCH, false, 'centripetal'), 64, 0.04, 10, false),
            ...[-1, 1].map((side) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
                CANOPY_RAIL.map(([x, y, z]) => new THREE.Vector3(x * side, y, z)), false, 'centripetal'), 48, 0.03, 8, false)),
        ],
        fabric: [
            // Headliner (half an ellipse, facing down) and the band below it, and the carpet.
            (() => {
                const roof = new THREE.CircleGeometry(WALL_DEPTH, 40, 0, Math.PI);
                roof.rotateX(Math.PI / 2);
                roof.scale(WALL_STRETCH, 1, 1);
                roof.translate(0, 1.26, WALL_CENTRE_Z);
                return roof;
            })(),
            wallBand(0.98, 1.27, { inset: 0 }),
            // Dash top in matt microfibre, from the shell to the pilot-side edge (leather this
            // wide and flat catches the starlight like a mirror).
            ribbon(frontRow(0, DASH_TOP_Y), frontRow(inner, DASH_TOP_Y), UP),
            box(3.8, 0.04, 2.95, 0, FLOOR_Y, -0.17),
        ],
    };

    // Ambient light lines, each a closed loop: round the waist (along the dash's pilot-side
    // edge and the rear waist rail), along the roof edge, and round the footwell.
    const rearArc = (y, inset, arc) => wallArc(y, inset, arc, 40).reverse();
    const lines = [
        lightLine([...frontRow((w) => inner(w) - 0.015 * w, -0.588), ...rearArc(-0.588, 0.03, Math.PI)], true),
        lightLine(wallArc(0.965, 0.05, Math.PI * 0.75)),
        lightLine([...frontRow((w) => recessed(w) + 0.04 + 0.01 * w, FLOOR_Y + 0.035), ...rearArc(FLOOR_Y + 0.035, 0.04, Math.PI)], true),
        // Along the inside of the canopy frame: the rear arch and both roof rails.
        lightLine(CANOPY_ARCH.map((point) => towardsEye(point, 0.045))),
        ...[-1, 1].map((side) => lightLine(CANOPY_RAIL.map(([x, y, z]) => towardsEye(new THREE.Vector3(x * side, y, z), 0.034)))),
        // Piping down the outer front edge of each backrest bolster and across the headrest.
        ...[-1, 1].map((side) => seatLine(Array.from({ length: 9 }, (_, i) => new THREE.Vector3(0.045 * side, -0.27 + (0.54 * i) / 8, -0.066)
            .applyAxisAngle(X_AXIS, 0.14).add(new THREE.Vector3(0.25 * side, -0.36, 0.3))))),
        seatLine([-0.1, 0, 0.1].map((x) => new THREE.Vector3(x, 0.05, -0.059).applyAxisAngle(X_AXIS, 0.1).add(new THREE.Vector3(0, 0.24, 0.4)))),
    ];

    const geometries = {};
    const room = (parts) => parts.map((part) => (part.userData.seat ? part : scaleRoom(part)));
    for (const [name, parts] of Object.entries(pieces)) geometries[name] = merge(room(parts));
    geometries.line = merge(room([...lines.map((line) => line.core), ...vents.map((vent) => vent.glow)]));
    geometries.stars = scaleRoom(starlightGeometry());
    geometries.halo = merge(room(lines.map((line) => line.halo)));

    // A headset shows near-black as black: give every surface a faint glow of its own colour
    // so the cabin reads in the dark without adding lights.
    for (const material of Object.values(materials)) {
        if (!material.isMeshStandardMaterial) continue;
        material.emissive.copy(material.color).multiplyScalar(material.metalness > 0.5 ? 0.06 : SELF_LIGHT);
        if (material.map) material.emissiveMap = material.map;
    }
    return {
        materials,
        geometries,
        time: 0,
        dispose() {
            Object.values(geometries).forEach((geometry) => geometry.dispose());
            Object.values(materials).forEach((material) => material.dispose());
            textures.forEach((texture) => texture.dispose());
        },
    };
}

const SURFACES = ['saddle', 'cognac', 'leather', 'quiltedBlack', 'wood', 'metal', 'piano', 'fabric'];

export default function VRCockpitShell() {
    const cabin = useMemo(() => buildCabin(), []);
    const fillRef = useRef(null);
    const colour = useMemo(() => new THREE.Color().copy(AMBIENT_COLOURS.balanced), []);

    useEffect(() => () => cabin.dispose(), [cabin]);

    useFrame((_, delta) => {
        const mode = useGameStore.getState().hud?.powerMode ?? 'balanced';
        colour.lerp(AMBIENT_COLOURS[mode] ?? AMBIENT_COLOURS.balanced, 1 - Math.exp(-COLOUR_FOLLOW * delta));
        const { line, halo, stars } = cabin.materials;
        line.uniforms.color.value.copy(colour).multiplyScalar(LINE_BRIGHTNESS);
        halo.uniforms.color.value.copy(colour);
        stars.uniforms.tint.value.copy(colour);
        cabin.time += delta;
        line.uniforms.time.value = cabin.time;
        halo.uniforms.time.value = cabin.time;
        stars.uniforms.time.value = cabin.time;
        if (fillRef.current) fillRef.current.color.copy(colour);
    });

    const { geometries, materials } = cabin;
    return (
        <group scale={CABIN_SCALE}>
            {SURFACES.map((name) => (
                <mesh key={name} geometry={geometries[name]} material={materials[name]} frustumCulled={false} />
            ))}
            <mesh geometry={geometries.line} material={materials.line} frustumCulled={false} />
            <mesh geometry={geometries.halo} material={materials.halo} frustumCulled={false} renderOrder={1} />
            <points geometry={geometries.stars} material={materials.stars} frustumCulled={false} renderOrder={1} />
            {/* The cabin's one fill light, tinted with the ambient colour. */}
            <pointLight ref={fillRef} position={[0, 0.7, 0.6]} intensity={FILL_INTENSITY} distance={4 * CABIN_SCALE} decay={1.2} />
        </group>
    );
}
