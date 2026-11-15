import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The back half of the cockpit, for VR only.
 *
 * cockpit.glb was built for a flat screen, where only what lies ahead is ever seen: canopy
 * frame, dashboard and side consoles, open behind and below the pilot. In a headset the
 * pilot can turn round, so this adds what they would expect to find there: the seat
 * (cushion, back, headrest, armrests), a floor, side walls under the consoles, a rear
 * bulkhead with ribs and lit panels, and a roof between the canopy's rear arch and the
 * bulkhead. Coordinates are metres in the camera's frame (the eye at the origin, -z ahead),
 * the same frame the cockpit model is laid out in.
 *
 * Plain boxes in two merged meshes (hull plating + light strips), so it costs two draw calls.
 */

/** [centre x, y, z, size x, y, z] */
const HULL_BOXES = [
    // Floor, from under the dashboard to the bulkhead.
    [0, -1.25, -0.6, 3.8, 0.1, 3.7],
    // Rear bulkhead and its ribs.
    [0, 0, 1.25, 3.8, 2.6, 0.12],
    [-1.05, 0, 1.16, 0.14, 2.5, 0.08],
    [1.05, 0, 1.16, 0.14, 2.5, 0.08],
    [0, 0.85, 1.16, 1.96, 0.1, 0.08],
    [0, -0.2, 1.16, 1.96, 0.1, 0.08],
    // Side walls below the consoles, and above them behind the canopy's rear arch.
    [-1.95, -0.95, -0.6, 0.1, 0.6, 3.7],
    [1.95, -0.95, -0.6, 0.1, 0.6, 3.7],
    [-1.85, 0.25, 0.9, 0.1, 1.9, 0.7],
    [1.85, 0.25, 0.9, 0.1, 1.9, 0.7],
    // Roof between the arch and the bulkhead.
    [0, 1.25, 0.88, 3.8, 0.1, 0.78],
    // Seat: pedestal, cushion, back, headrest, armrests.
    [0, -1.02, 0.02, 0.4, 0.36, 0.4],
    [0, -0.78, -0.04, 0.62, 0.12, 0.62],
    [0, -0.34, 0.34, 0.62, 0.86, 0.12],
    [0, 0.22, 0.36, 0.34, 0.28, 0.12],
    [-0.42, -0.56, 0.02, 0.1, 0.08, 0.52],
    [0.42, -0.56, 0.02, 0.1, 0.08, 0.52],
    [-0.42, -0.68, 0.24, 0.08, 0.2, 0.08],
    [0.42, -0.68, 0.24, 0.08, 0.2, 0.08],
];

const LIGHT_BOXES = [
    // Panels on the bulkhead, either side of the seat.
    [-0.55, 0.55, 1.18, 0.5, 0.1, 0.02],
    [0.55, 0.55, 1.18, 0.5, 0.1, 0.02],
    [-1.5, -0.6, 1.18, 0.3, 0.3, 0.02],
    [1.5, -0.6, 1.18, 0.3, 0.3, 0.02],
    // Strips along the floor.
    [-0.95, -1.195, -0.6, 0.04, 0.01, 3.2],
    [0.95, -1.195, -0.6, 0.04, 0.01, 3.2],
];

/** Hull plating: about one texture repeat every 2.5 m, like the generated models. */
const UV_METRES = 1.6;
/** Dark plating, like the cockpit model's own; alpha 1 = no lit windows (see the hull shader). */
const PLATING_COLOUR = [0.13, 0.14, 0.19, 1];
/** Instrument blue for the light strips (the glow material takes its colour from here). */
const LIGHT_COLOUR = [0.2, 0.42, 0.75, 1];

function buildBoxes(boxes, { scaleUvs, colour }) {
    const parts = boxes.map(([x, y, z, sx, sy, sz]) => {
        const box = new THREE.BoxGeometry(sx, sy, sz);
        if (scaleUvs) {
            // Each face's UVs span the face's own size in metres, so the plating keeps one scale.
            const uv = box.attributes.uv;
            const normal = box.attributes.normal;
            for (let i = 0; i < uv.count; i++) {
                const nx = Math.abs(normal.getX(i));
                const ny = Math.abs(normal.getY(i));
                const [u, v] = nx > 0.5 ? [sz, sy] : ny > 0.5 ? [sx, sz] : [sx, sy];
                uv.setXY(i, (uv.getX(i) * u) / UV_METRES, (uv.getY(i) * v) / UV_METRES);
            }
        }
        // Both materials read a vertex colour (RGBA, as the generated models have).
        const colours = new Float32Array(box.attributes.position.count * 4);
        for (let i = 0; i < colours.length; i += 4) colours.set(colour, i);
        box.setAttribute('color', new THREE.BufferAttribute(colours, 4));
        box.translate(x, y, z);
        return box;
    });
    const merged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    return merged;
}

export default function VRCockpitShell({ materials }) {
    const { hull, lights } = useMemo(() => ({
        hull: buildBoxes(HULL_BOXES, { scaleUvs: true, colour: PLATING_COLOUR }),
        lights: buildBoxes(LIGHT_BOXES, { scaleUvs: false, colour: LIGHT_COLOUR }),
    }), []);
    const hullMaterial = useMemo(() => materials.resolve({ name: 'hull', metalness: 0.75, roughness: 1 }), [materials]);
    const lightMaterial = useMemo(() => materials.resolve({ name: 'glow' }), [materials]);

    useEffect(() => () => {
        hull.dispose();
        lights.dispose();
    }, [hull, lights]);

    return (
        <>
            <mesh geometry={hull} material={hullMaterial} frustumCulled={false} />
            <mesh geometry={lights} material={lightMaterial} frustumCulled={false} />
            {/* Fill light for the back of the cabin, which the dashboard glow does not reach. */}
            <pointLight position={[0, 0.9, 0.7]} intensity={0.2} distance={3} decay={1.2} color="#9fc8ff" />
        </>
    );
}
