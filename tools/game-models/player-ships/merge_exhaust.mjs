/**
 * Merges the exhaust built in Blender (<ship>_fx.glb) into the untouched original model.
 *
 *   node merge_exhaust.mjs <original.glb> <fx.glb> <out.glb> '<json options>'
 *
 * options: { carrier?: node name the exhaust should ride on (follows the model's own animation),
 *            removeMaterials?: [material names whose meshes are the old exhaust] }
 *
 * The original's nodes, meshes, materials and animations are kept as they are; the old
 * exhaust meshes are only detached from their nodes so those nodes' animation tracks stay valid.
 */
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsSpecular, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { mergeDocuments, prune, unpartition, metalRough } from '@gltf-transform/functions';
import { Matrix4 } from 'three';

const [src, fxPath, out, optsJson] = process.argv.slice(2);
const opts = JSON.parse(optsJson ?? '{}');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const fx = await io.read(fxPath);
const root = doc.getRoot();
const mainScene = root.getDefaultScene() ?? root.listScenes()[0];

// three.js dropped KHR_materials_pbrSpecularGlossiness: convert so the hull keeps its look in the game.
if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) {
    await doc.transform(metalRough());
    console.log('converted spec/gloss materials to metal/rough');
}
const map = mergeDocuments(doc, fx);
const fxScene = map.get(fx.getRoot().listScenes()[0]);
const fxRoot = fxScene.listChildren().find((n) => n.getName() === 'FX_Exhaust');
if (!fxRoot) throw new Error('FX_Exhaust not found');
fxScene.removeChild(fxRoot);
fxScene.dispose();

// ---- attach: the FX root was authored in scene space; re-express it under the carrier.
if (opts.carrier) {
    const carrier = root.listNodes().find((n) => n.getName() === opts.carrier && n !== fxRoot);
    if (!carrier) throw new Error(`carrier ${opts.carrier} not found`);
    const inv = new Matrix4().fromArray(carrier.getWorldMatrix()).invert();
    const local = inv.multiply(new Matrix4().fromArray(fxRoot.getMatrix()));
    fxRoot.setMatrix(local.toArray());
    carrier.addChild(fxRoot);
} else {
    mainScene.addChild(fxRoot);
}

// ---- detach the old exhaust meshes
let detached = 0;
for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && mesh.listPrimitives().some((p) => (opts.removeMaterials ?? []).includes(p.getMaterial()?.getName()))) {
        node.setMesh(null);
        detached++;
    }
}

// The old exhaust materials are now unused: drop them and any texture only they used.
for (const mat of root.listMaterials()) {
    if (!(opts.removeMaterials ?? []).includes(mat.getName())) continue;
    const textures = mat.listChildren?.() ?? [];
    mat.dispose();
}

// ---- exhaust material: emissive gradient only (black albedo, no specular), soft blended
const specExt = doc.createExtension(KHRMaterialsSpecular);
const fxNodes = new Set();
fxRoot.traverse((n) => fxNodes.add(n));
for (const node of fxNodes) {
    const mat = node.getMesh()?.listPrimitives()[0]?.getMaterial();
    if (!mat || mat.getExtras()?.fxFixed) continue;
    mat.setBaseColorFactor([0, 0, 0, 1])
        .setMetallicFactor(0)
        .setRoughnessFactor(1)
        .setAlphaMode('BLEND')
        .setDoubleSided(true)
        .setEmissiveFactor([1, 1, 1])
        .setExtras({ fxFixed: true });
    mat.setExtension('KHR_materials_specular', specExt.createSpecular().setSpecularFactor(0));
    const strength = mat.getExtension('KHR_materials_emissive_strength');
    if (!strength) throw new Error('emissive strength missing on exhaust material');
}
for (const mat of root.listMaterials()) {
    if (mat.getExtras()?.fxFixed) mat.setExtras({});
}

// ---- rest pose (what shows when no clip plays): the first frame of Exhaust_Cruise
const cruise = root.listAnimations().find((a) => a.getName() === 'Exhaust_Cruise');
for (const ch of cruise.listChannels()) {
    if (ch.getTargetPath() !== 'scale') continue;
    const out = ch.getSampler().getOutput();
    ch.getTargetNode().setScale(out.getElement(0, []));
}

const pruneAll = () => prune({ propertyTypes: [PropertyType.MESH, PropertyType.MATERIAL, PropertyType.TEXTURE, PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true });
await doc.transform(pruneAll(), pruneAll());
await doc.transform(
    prune({ propertyTypes: [PropertyType.MESH, PropertyType.MATERIAL, PropertyType.TEXTURE, PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
    unpartition(),
);
await io.write(out, doc);
console.log(JSON.stringify({
    out, detached,
    animations: root.listAnimations().map((a) => `${a.getName()} (${a.listChannels().length} ch)`),
    fxNodes: fxNodes.size,
}));
