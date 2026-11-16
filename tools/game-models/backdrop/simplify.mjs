#!/usr/bin/env node
/**
 * Makes the game's own, much lighter copies of the site's models that hang in the sky as
 * distant bodies and animate fast enough to be redrawn many times a second
 * (src/game/config/sectors.js, `pictureRate`).
 *
 * Those models were made to be looked at up close in the site's story scenes: the black hole
 * has 232 k triangles. In the game it is scenery 137,000 km away, where most of those
 * triangles are smaller than a pixel. This script removes them with the meshoptimizer
 * simplifier and halves the textures; everything else (node names, materials, animations)
 * is kept, so the game uses the copy exactly as it used the original.
 *
 * Not every model survives this: the spiral star (606 k triangles of hair-thin ribbons)
 * breaks up into dashes at any useful ratio, which is why the game shows it as a still
 * picture of the full model instead.
 *
 *   node backdrop/simplify.mjs          (from tools/game-models; writes public/assets/game/backdrop/)
 *
 * `ratio` is the share of triangles to keep, `error` the largest shape change allowed as a
 * fraction of the mesh's size (the simplifier stops at whichever comes first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, draco, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/assets');
const OUT_DIR = path.join(ASSETS, 'game/backdrop');

const MODELS = [
    { source: 'blackhole-transformed.glb', ratio: 0.14, error: 0.004, textureSize: 1024 },
];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
});

function stats(doc) {
    let triangles = 0;
    let drawCalls = 0;
    for (const node of doc.getRoot().listNodes()) {
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
            drawCalls++;
            const indices = primitive.getIndices();
            triangles += (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3;
        }
    }
    return { triangles, drawCalls };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const { source, ratio, error, textureSize } of MODELS) {
    const doc = await io.read(path.join(ASSETS, source));
    const before = stats(doc);
    await doc.transform(
        dequantize(),
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio, error }),
        prune({ keepLeaves: true }),
        textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [textureSize, textureSize] }),
        draco({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    );
    const out = path.join(OUT_DIR, source);
    await io.write(out, doc);
    console.log(source, JSON.stringify({ before, after: stats(doc), kB: Math.round(fs.statSync(out).size / 1024) }));
}
