/**
 * Hidden-geometry culling, glTF side.
 *
 *   node cull_io.mjs export <in.glb> <work-prefix>          -> <prefix>.tris.bin + <prefix>.meta.json
 *   node cull_io.mjs apply  <in.glb> <work-prefix> <out.glb> (reads <prefix>.visible.bin)
 *
 * `export` also drops the showcase animations (any clip not named Exhaust_*): they move the
 * whole ship, the game never plays them, and the hidden test is done in the rest pose.
 *
 * Per triangle flags: 1 = occluder (opaque), 2 = double-sided, 4 = candidate (may be culled).
 * Transparent (BLEND) surfaces neither hide anything nor get removed; alpha-masked ones can be
 * removed when hidden but never hide anything.
 */
import fs from 'fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune } from '@gltf-transform/functions';
import { Matrix4, Vector3 } from 'three';

const [mode, src, prefix, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

for (const anim of root.listAnimations()) {
    if (!anim.getName().startsWith('Exhaust_')) anim.dispose();
}
for (const skin of root.listSkins()) {
    if (!root.listNodes().some((n) => n.getSkin() === skin)) skin.dispose();
}

const animated = new Set();
for (const anim of root.listAnimations()) for (const ch of anim.listChannels()) animated.add(ch.getTargetNode());
function underAnimation(node) {
    for (let n = node; n; n = n.getParentNode()) if (animated.has(n)) return true;
    return false;
}

const prims = [];
const primIndex = new Map();
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { primIndex.set(p, prims.length); prims.push(p); }

function triIndices(prim) {
    const idx = prim.getIndices();
    const count = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
    const arr = new Uint32Array(count);
    for (let i = 0; i < count; i++) arr[i] = idx ? idx.getScalar(i) : i;
    return arr;
}

if (mode === 'export') {
    const chunks = [];
    const flags = [];
    const refs = [];
    const v = [0, 0, 0];
    const m = new Matrix4();
    const p = new Vector3();
    for (const scene of root.listScenes()) scene.traverse((node) => {
        const mesh = node.getMesh();
        if (!mesh) return;
        m.fromArray(node.getWorldMatrix());
        const flip = m.determinant() < 0;
        const anim = underAnimation(node) || node.getSkin();
        for (const prim of mesh.listPrimitives()) {
            if (prim.getMode() !== 4 || prim.listTargets().length) continue;
            const mat = prim.getMaterial();
            const alpha = mat ? mat.getAlphaMode() : 'OPAQUE';
            const transmissive = mat && (mat.getExtension('KHR_materials_transmission') || mat.getExtension('KHR_materials_volume'));
            const occluder = !anim && alpha === 'OPAQUE' && !transmissive;
            const candidate = !anim && alpha !== 'BLEND' && !transmissive;
            if (!occluder && !candidate) continue;
            const ds = mat ? mat.getDoubleSided() : false;
            const f = (occluder ? 1 : 0) | (ds ? 2 : 0) | (candidate ? 4 : 0);
            const pos = prim.getAttribute('POSITION');
            const ids = triIndices(prim);
            const world = new Float32Array(pos.getCount() * 3);
            for (let i = 0; i < pos.getCount(); i++) {
                pos.getElement(i, v);
                p.set(v[0], v[1], v[2]).applyMatrix4(m);
                world[i * 3] = p.x; world[i * 3 + 1] = p.y; world[i * 3 + 2] = p.z;
            }
            const T = ids.length / 3;
            const buf = new Float32Array(T * 9);
            for (let t = 0; t < T; t++) {
                const order = flip ? [0, 2, 1] : [0, 1, 2];
                for (let k = 0; k < 3; k++) {
                    const vi = ids[t * 3 + order[k]];
                    buf[t * 9 + k * 3] = world[vi * 3]; buf[t * 9 + k * 3 + 1] = world[vi * 3 + 1]; buf[t * 9 + k * 3 + 2] = world[vi * 3 + 2];
                }
                flags.push(f);
                refs.push(primIndex.get(prim), t);
            }
            chunks.push(Buffer.from(buf.buffer));
        }
    });
    fs.writeFileSync(`${prefix}.tris.bin`, Buffer.concat(chunks));
    fs.writeFileSync(`${prefix}.flags.bin`, Buffer.from(Uint8Array.from(flags)));
    fs.writeFileSync(`${prefix}.refs.bin`, Buffer.from(Int32Array.from(refs).buffer));
    console.log(JSON.stringify({ triangles: flags.length, prims: prims.length }));
} else if (mode === 'apply') {
    const vis = new Uint8Array(fs.readFileSync(`${prefix}.visible.bin`));
    const refs = new Int32Array(new Uint8Array(fs.readFileSync(`${prefix}.refs.bin`)).buffer);
    const flags = new Uint8Array(fs.readFileSync(`${prefix}.flags.bin`));
    // keep[prim] = per-triangle keep flags; a triangle survives if any instance of it is visible.
    const keep = new Map();
    for (let i = 0; i < vis.length; i++) {
        const pi = refs[i * 2], t = refs[i * 2 + 1];
        if (!keep.has(pi)) keep.set(pi, new Uint8Array(triIndices(prims[pi]).length / 3));
        if (vis[i] || !(flags[i] & 4)) keep.get(pi)[t] = 1;
    }
    let before = 0, after = 0, emptied = 0;
    for (const [pi, k] of keep) {
        const prim = prims[pi];
        const ids = triIndices(prim);
        const kept = [];
        for (let t = 0; t < k.length; t++) if (k[t]) kept.push(ids[t * 3], ids[t * 3 + 1], ids[t * 3 + 2]);
        before += k.length; after += kept.length / 3;
        if (kept.length === k.length * 3) continue;
        if (kept.length === 0) { prim.dispose(); emptied++; continue; }
        const vcount = prim.getAttribute('POSITION').getCount();
        const acc = doc.createAccessor().setType('SCALAR').setArray(vcount > 65535 ? Uint32Array.from(kept) : Uint16Array.from(kept));
        const buffer = root.listBuffers()[0];
        acc.setBuffer(buffer);
        prim.setIndices(acc);
        compactPrimitive(prim);
    }
    for (const mesh of root.listMeshes()) if (mesh.listPrimitives().length === 0) mesh.dispose();
    await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }));
    await io.write(out, doc);
    console.log(JSON.stringify({ trianglesBefore: before, trianglesAfter: after, removed: before - after, emptiedPrimitives: emptied }));
}
