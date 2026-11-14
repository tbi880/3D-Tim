/**
 * Collapses the exhaust (one mesh per layer per nozzle, each its own draw call) into ONE
 * skinned mesh: every layer node becomes a bone that keeps its animation, so the clips work
 * unchanged and the whole exhaust costs a single draw call.
 *
 *   node fx_skin.mjs <in.glb> <out.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const fxRoot = root.listNodes().find((n) => n.getName() === 'FX_Exhaust');
const layers = [];
fxRoot.traverse((n) => { if (n !== fxRoot && n.getMesh()) layers.push(n); });

const meshNode = doc.createNode('FX_ExhaustMesh');
fxRoot.addChild(meshNode);
const W = new Matrix4().fromArray(meshNode.getWorldMatrix());
const Winv = W.clone().invert();

const P = [], Nn = [], UV = [], J = [], Wt = [], I = [], IBM = [];
let material = null;
const v = [0, 0, 0], uv = [0, 0];
layers.forEach((node, j) => {
    const parentWorld = new Matrix4().fromArray(node.getParentNode().getWorldMatrix());
    const local = new Matrix4().compose(new Vector3(...node.getTranslation()), new Quaternion(...node.getRotation()), new Vector3(1, 1, 1));
    const bind = parentWorld.multiply(local);                        // bone at unit scale
    const toMesh = Winv.clone().multiply(bind);
    const nrm = new Matrix3().getNormalMatrix(toMesh);
    IBM.push(...bind.clone().invert().multiply(W).toArray());
    for (const prim of node.getMesh().listPrimitives()) {
        material ??= prim.getMaterial();
        const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tex = prim.getAttribute('TEXCOORD_0');
        const base = P.length / 3;
        for (let i = 0; i < pos.getCount(); i++) {
            const p = new Vector3(...pos.getElement(i, v)).applyMatrix4(toMesh); P.push(p.x, p.y, p.z);
            const n = new Vector3(...nor.getElement(i, v)).applyMatrix3(nrm).normalize(); Nn.push(n.x, n.y, n.z);
            UV.push(...tex.getElement(i, uv));
            J.push(j, 0, 0, 0); Wt.push(1, 0, 0, 0);
        }
        const idx = prim.getIndices();
        for (let i = 0; i < idx.getCount(); i++) I.push(base + idx.getScalar(i));
    }
    node.setMesh(null);
});

const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(P)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(Nn)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(UV)))
    .setAttribute('JOINTS_0', acc('VEC4', (layers.length > 255 ? Uint16Array : Uint8Array).from(J)))
    .setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(Wt)))
    .setIndices(acc('SCALAR', (P.length / 3 > 65535 ? Uint32Array : Uint16Array).from(I)))
    .setMaterial(material);
const skin = doc.createSkin('FX_ExhaustSkin').setSkeleton(fxRoot).setInverseBindMatrices(acc('MAT4', new Float32Array(IBM)));
for (const n of layers) skin.addJoint(n);
meshNode.setMesh(doc.createMesh('FX_Exhaust').addPrimitive(prim)).setSkin(skin);

await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
await io.write(out, doc);
console.log(JSON.stringify({ bones: layers.length, vertices: P.length / 3, triangles: I.length / 3 }));
