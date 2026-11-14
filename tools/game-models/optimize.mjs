#!/usr/bin/env node
/**
 * Web-optimises GLB files for "Echoes of Dawn" the way `npx gltfjsx model.glb --transform`
 * does (same gltf-transform steps), with the changes the game needs to look identical:
 *
 *   - textures are never resized (gltfjsx caps them at 1024); colour textures become WebP at
 *     quality 92, normal maps lossless WebP (gltfjsx uses lossy JPEG for them)
 *   - Draco keeps finer quantisation for positions, normals and UVs
 *   - `--game` (the generated ships in public/assets/game): material names are kept, because the
 *     game swaps in its own materials by name ("hull", "glow"), and so are UVs and vertex
 *     colours, which only the game's materials use
 *
 *   node optimize.mjs [--game] <in.glb> [<in.glb> ...]      -> writes <name>-transformed.glb
 *
 * Also unlike gltfjsx: static meshes are baked and merged with correct tangents (see bakeStatic).
 */
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
    dedup, dequantize, draco, join, palette, prune, reorder, resample, sparse,
    textureCompress, unpartition, weld,
} from '@gltf-transform/functions';
import { Matrix3, Matrix4, Vector3, Vector4 } from 'three';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ready as resampleReady, resample as resampleWASM } from 'keyframe-resample';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

/**
 * Replacement for gltf-transform's flatten(): bakes every static mesh into world space and
 * moves it to the scene root, so join() can merge it. gltf-transform's own baking corrupts
 * tangents (it transforms them in place, reusing already-overwritten components, and never
 * flips their handedness under mirroring), which visibly breaks normal maps.
 */
function bakeStatic() {
    return async function bakeStatic(doc) {
        const root = doc.getRoot();
        const scene = root.getDefaultScene() ?? root.listScenes()[0];
        const animated = new Set();
        for (const a of root.listAnimations()) for (const ch of a.listChannels()) animated.add(ch.getTargetNode());
        const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
        const dynamic = (node) => { for (let n = node; n; n = n.getParentNode()) if (animated.has(n) || joints.has(n)) return true; return false; };
        const v3 = new Vector3(), v4 = new Vector4();
        for (const node of root.listNodes()) {
            const mesh = node.getMesh();
            if (!mesh || node.getSkin() || dynamic(node)) continue;
            const M = new Matrix4().fromArray(node.getWorldMatrix());
            const N = new Matrix3().getNormalMatrix(M);
            const L = new Matrix3().setFromMatrix4(M);
            const mirrored = M.determinant() < 0;
            const baked = doc.createMesh(mesh.getName());
            for (const src of mesh.listPrimitives()) {
                const prim = src.clone();
                for (const semantic of prim.listSemantics()) prim.setAttribute(semantic, src.getAttribute(semantic).clone());
                const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
                for (let i = 0; i < pos.getCount(); i++) pos.setElement(i, v3.fromArray(pos.getElement(i, [])).applyMatrix4(M).toArray());
                if (nor) for (let i = 0; i < nor.getCount(); i++) nor.setElement(i, v3.fromArray(nor.getElement(i, [])).applyMatrix3(N).normalize().toArray());
                if (tan) for (let i = 0; i < tan.getCount(); i++) {
                    v4.fromArray(tan.getElement(i, []));
                    v3.set(v4.x, v4.y, v4.z).applyMatrix3(L).normalize();
                    tan.setElement(i, [v3.x, v3.y, v3.z, v4.w]); // w kept: matches how three.js shades the mirrored original // w kept: matches how three.js shades the mirrored original
                }
                if (mirrored && prim.getMode() === 4) {
                    let idx = src.getIndices();
                    const count = idx ? idx.getCount() : pos.getCount();
                    const arr = new Uint32Array(count);
                    for (let i = 0; i < count; i += 3) {
                        const a = idx ? idx.getScalar(i) : i, b = idx ? idx.getScalar(i + 1) : i + 1, c = idx ? idx.getScalar(i + 2) : i + 2;
                        arr[i] = a; arr[i + 1] = c; arr[i + 2] = b;
                    }
                    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(pos.getBuffer()));
                }
                baked.addPrimitive(prim);
            }
            node.setMesh(null);
            scene.addChild(doc.createNode(node.getName()).setMesh(baked));
        }
    };
}

const args = process.argv.slice(2);
const game = args.includes('--game');
// Already-optimised files are outputs, not inputs (lets `public/assets/game/*.glb` be passed as is).
const files = args.filter((a) => !a.startsWith('--') && !a.endsWith('-transformed.glb'));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
});

function stats(doc) {
    let tris = 0, draws = 0;
    for (const node of doc.getRoot().listNodes()) {
        for (const prim of node.getMesh()?.listPrimitives() ?? []) {
            draws++;
            const idx = prim.getIndices();
            tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
        }
    }
    return { triangles: tris, drawCalls: draws, materials: doc.getRoot().listMaterials().length, textures: doc.getRoot().listTextures().length };
}

for (const file of files) {
    const out = file.replace(/(-transformed)?\.glb$/, '-transformed.glb');
    const doc = await io.read(file);
    const before = stats(doc);
    const steps = [unpartition()];
    if (!game) steps.push(palette({ min: 5 }));
    steps.push(
        reorder({ encoder: MeshoptEncoder }),
        dedup({ keepUniqueNames: game }),
        dequantize(),
        bakeStatic(),
        join({ keepNamed: false }),
        weld(),
        resample({ ready: resampleReady, resample: resampleWASM }),
        prune({ keepAttributes: game, keepLeaves: false, keepSolidTextures: false }),
        sparse(),
        textureCompress({ slots: /^(?!normalTexture).*$/, encoder: sharp, targetFormat: 'webp', quality: 92 }),
        textureCompress({ slots: /^normalTexture$/, encoder: sharp, targetFormat: 'webp', lossless: true }),
        draco({ quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: game ? 16 : 14, quantizeColor: 10, quantizeGeneric: 14 }),
    );
    await doc.transform(...steps);
    await io.write(out, doc);
    console.log(path.basename(out), JSON.stringify({ before, after: stats(doc) }));
}
