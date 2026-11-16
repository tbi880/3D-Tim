import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The VR model files (tools/game-models/vr-cockpit) against what the game's components
 * (xr/VRCockpitShell.jsx, xr/VRFlightStick.jsx) and the HUD (xr/VRHud.jsx) rely on. Web
 * optimisation rewrites the files, so this is where a dropped mesh, material or UV set shows up.
 */

const MODEL = new URL('../../public/assets/game/vr-cockpit-transformed.glb', import.meta.url);
const STICK = new URL('../../public/assets/game/vr-stick-transformed.glb', import.meta.url);
const LAYOUT = new URL('../../src/game/xr/cockpitLayout.json', import.meta.url);

/** The JSON part of a binary glTF file. */
function readGlbJson(url) {
    const file = readFileSync(url);
    assert.equal(file.toString('latin1', 0, 4), 'glTF');
    const length = file.readUInt32LE(12);
    assert.equal(file.toString('latin1', 16, 20), 'JSON');
    return JSON.parse(file.toString('utf8', 20, 20 + length));
}

const gltf = readGlbJson(MODEL);
const meshNamed = (name, file = gltf) => file.meshes[file.nodes.find((node) => node.name === name)?.mesh];
const materialOf = (mesh, file = gltf) => file.materials[mesh.primitives[0].material];
const attributesOf = (primitive) => primitive.extensions?.KHR_draco_mesh_compression?.attributes ?? primitive.attributes;

test('the cabin is three meshes, one draw call each', () => {
    assert.equal(gltf.meshes.length, 3);
    for (const name of ['cabin', 'lights', 'glass']) {
        const mesh = meshNamed(name);
        assert.ok(mesh, `mesh "${name}"`);
        assert.equal(mesh.primitives.length, 1, `"${name}" is one primitive`);
    }
});

test('the cabin surface carries its baked colour, roughness / metalness and ambient glow', () => {
    const material = materialOf(meshNamed('cabin'));
    assert.equal(material.name, 'cabin');
    assert.ok(material.pbrMetallicRoughness.baseColorTexture);
    assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
    assert.ok(material.emissiveTexture, 'the glow the game tints with the ambient colour');
    assert.ok(!material.doubleSided, 'only the inside is ever seen');
});

test('the light strips keep their UVs (metres along the strip, for the travelling pulses)', () => {
    const mesh = meshNamed('lights');
    assert.equal(materialOf(mesh).name, 'ambientLight');
    assert.ok(materialOf(mesh).emissiveTexture, 'the brightness profile across a strip');
    assert.ok('TEXCOORD_0' in attributesOf(mesh.primitives[0]));
});

test('the glass roof is blended', () => {
    assert.equal(materialOf(meshNamed('glass')).alphaMode, 'BLEND');
});

test('the flight stick is one mesh whose lights shine through its emissive map', () => {
    const stick = readGlbJson(STICK);
    assert.equal(stick.meshes.length, 1);
    const mesh = meshNamed('stick', stick);
    assert.ok(mesh, 'mesh "stick"');
    assert.equal(mesh.primitives.length, 1);
    const material = materialOf(mesh, stick);
    assert.equal(material.name, 'stick');
    assert.ok(material.pbrMetallicRoughness.baseColorTexture);
    assert.ok(material.emissiveTexture);
});

test('the layout file gives the flight display a place, a tilt and a size', () => {
    const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
    assert.ok(layout.cabinScale > 0);
    assert.equal(layout.display.position.length, 3);
    assert.equal(layout.display.meters.length, 2);
    assert.ok(Number.isFinite(layout.display.tilt));
    // Below the line of sight and ahead of the pilot.
    assert.ok(layout.display.position[1] < 0 && layout.display.position[2] < 0);
});
