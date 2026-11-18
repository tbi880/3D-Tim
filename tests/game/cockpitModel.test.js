import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HEADSET_SPARK_EMITTERS, SCREEN_SPARK_EMITTERS } from '../../src/game/scene/sparkEmitters.js';

/**
 * The cockpit cabin and the VR flight stick (tools/game-models/vr-cockpit) against what the
 * game's components (scene/CockpitCabin.jsx, xr/VRFlightStick.jsx) and the VR HUD (xr/VRHud.jsx)
 * rely on. Web optimisation rewrites the files, so this is where a dropped mesh, material or UV
 * set shows up.
 */

const MODEL = new URL('../../public/assets/game/vr-cockpit-transformed.glb', import.meta.url);
const STICK = new URL('../../public/assets/game/vr-stick-transformed.glb', import.meta.url);
const LAYOUT = new URL('../../src/game/scene/cockpitLayout.json', import.meta.url);

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

test('the flat screen\'s own cockpit model is retired: one cabin for every first-person view', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../src/game/scene/models/modelManifest.json', import.meta.url), 'utf8'));
    // Every manifest model is fetched behind the loading screen, on phones too.
    assert.ok(!('cockpit' in manifest), 'no "cockpit" model to fetch');
    for (const file of ['cockpit.glb', 'cockpit-transformed.glb']) {
        assert.ok(!existsSync(new URL(`../../public/assets/game/${file}`, import.meta.url)), `${file} is gone`);
    }
});

/** PlayerCamera's field of view (vertical, degrees) when not on the afterburner or in warp. */
const SCREEN_FOV = Number(readFileSync(new URL('../../src/game/scene/PlayerCamera.jsx', import.meta.url), 'utf8').match(/const BASE_FOV = (\d+(?:\.\d+)?);/)[1]);

/** Where a point of the cabin as drawn lands on a screen of `aspect` (width / height) in the first-person view, in -1..1 across and up. */
function onScreen([x, y, z], aspect) {
    const tangent = Math.tan((SCREEN_FOV * Math.PI) / 360);
    return { across: x / (-z * tangent * aspect), up: y / (-z * tangent), ahead: z < 0 };
}

test('on a screen, hull-hit sparks burst from the dashboard in the lower part of the picture, on any common window shape', () => {
    const { cabinScale } = JSON.parse(readFileSync(LAYOUT, 'utf8'));
    assert.ok(SCREEN_FOV > 30 && SCREEN_FOV < 120, `field of view ${SCREEN_FOV}`);
    assert.ok(SCREEN_SPARK_EMITTERS.length >= 4);
    for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9]) {
        for (const emitter of SCREEN_SPARK_EMITTERS) {
            const point = emitter.slice(0, 3).map((value) => value * cabinScale);
            const { across, up, ahead } = onScreen(point, aspect);
            assert.ok(ahead, `${emitter} is ahead of the eye`);
            assert.ok(Math.abs(across) < 0.95, `${emitter} is inside the picture at ${aspect.toFixed(2)} (${across.toFixed(2)})`);
            // Low in the picture, where the dashboard is, but above its bottom edge.
            assert.ok(up < -0.25 && up > -0.85, `${emitter} is on the dashboard (${up.toFixed(2)})`);
            assert.ok(emitter[4] > 0, 'the shower sprays upwards, into the view');
        }
    }
});

test('in a headset, sparks can come from all round the cabin, behind and above the pilot too', () => {
    assert.ok(HEADSET_SPARK_EMITTERS.some(([, , z]) => z > 0), 'behind the eye');
    assert.ok(HEADSET_SPARK_EMITTERS.some(([, y]) => y > 0.5), 'overhead');
    for (const emitter of [...HEADSET_SPARK_EMITTERS, ...SCREEN_SPARK_EMITTERS]) assert.equal(emitter.length, 6);
});
