import { useGameStore } from '../state/gameStore.js';
import { vrPerformance } from './vrPerformance.js';

/**
 * Finds out, inside the headset, what a frame's time goes on.
 *
 * A headset's GPU and browser are nothing like a desktop's, and what is cheap on one is not
 * on the other, so the only measurement that counts is one taken in the headset. Started from
 * the VR pause menu (development builds), this flies on for half a minute and takes one thing
 * away at a time - the HUD's texture uploads, the HUD, the cabin, the asteroids, the sky,
 * everything - measuring the frame rate with each. What a frame gains when a thing is gone
 * is what that thing costs. The results go to the game store (`vrBenchmark`) and are listed
 * under the page's "Enter VR" button, where they can be read after leaving VR.
 *
 * Each result is { name, fps, js, eye }: frames per second, milliseconds of script per frame
 * (everything the page does in a frame, including handing the frame's drawing to the GPU
 * and uploading textures; what is left of the frame's time is the GPU's), and one eye's
 * picture in pixels.
 */

/** Seconds to let a change settle (shaders, the browser's own pacing), then to measure it. */
const SETTLE = 0.7;
const MEASURE = 2.3;
/** A longer frame than this is a hitch, not a measurement. */
const HITCH = 0.25;

/** Everything the main cameras draw. */
function drawn(scene) {
    const list = [];
    scene.traverse((object) => {
        if ((object.isMesh || object.isPoints || object.isLine || object.isSprite) && (object.layers.mask & 1)) list.push(object);
    });
    return list;
}

/** Takes `objects` out of the picture (by layer: components keep setting `visible` themselves); returns the undo. */
function hide(objects) {
    const masks = objects.map((object) => object.layers.mask);
    for (const object of objects) object.layers.mask = 0;
    return () => objects.forEach((object, index) => { object.layers.mask = masks[index]; });
}

/** Stops the canvas panels' textures being uploaded (they go on being drawn with what they hold); returns the undo. */
function freezeUploads(panels) {
    const textures = panels.map((panel) => panel.material.map);
    for (const texture of textures) Object.defineProperty(texture, 'needsUpdate', { set() {}, configurable: true });
    return () => textures.forEach((texture) => { delete texture.needsUpdate; });
}

/** The things to take away, in order. Each `apply` returns its undo. */
function variants(gl, scene) {
    const all = drawn(scene);
    const panels = all.filter((object) => object.material?.map?.isCanvasTexture);
    const cabinMesh = all.find((object) => object.material?.name === 'cabin');
    const cabin = all.filter((object) => (cabinMesh && object.parent === cabinMesh.parent) || object.material?.name === 'stick');
    const asteroids = all.filter((object) => object.isInstancedMesh);
    const sky = all.filter((object) => object.renderOrder < -7);
    const nothing = () => () => {};
    return [
        { name: 'baseline', apply: nothing },
        { name: 'HUD textures not uploaded', apply: () => freezeUploads(panels) },
        { name: 'no HUD', apply: () => hide(panels) },
        { name: 'no cabin or sticks', apply: () => hide(cabin) },
        { name: 'no asteroids', apply: () => hide(asteroids) },
        { name: 'no sky (nebula, stars, distant bodies)', apply: () => hide(sky) },
        { name: 'nothing drawn at all', apply: () => hide(all) },
        {
            name: 'no foveation',
            apply: () => {
                const before = gl.xr.getFoveation?.() ?? 1;
                gl.xr.setFoveation(0);
                return () => gl.xr.setFoveation(before);
            },
        },
        {
            name: 'half the pixels (viewport scale 0.7)',
            apply: () => {
                vrPerformance.forcedScale = 0.7;
                return () => { vrPerformance.forcedScale = 1; };
            },
        },
        { name: 'baseline again', apply: () => { vrPerformance.forcedScale = null; return () => {}; } },
    ];
}

let run = null;

export const vrBenchmark = {
    /** Asked for from the menu; begins on the next frame of flight. */
    requested: false,
    /** True from the request until the last result is in. */
    get running() {
        return this.requested || run !== null;
    },

    /**
     * Call once a frame during a VR session.
     * @param {() => void} onDone called when the last variant has been measured
     */
    update(gl, scene, delta, onDone) {
        if (this.requested && !run) {
            this.requested = false;
            const list = variants(gl, scene);
            run = { list, index: 0, undo: list[0].apply(), time: 0, frames: 0, elapsed: 0, js: 0, results: [] };
            return;
        }
        if (!run || !(delta > 0) || delta > HITCH) return;
        run.time += delta;
        if (run.time < SETTLE) return;
        run.frames += 1;
        run.elapsed += delta;
        run.js += vrPerformance.lastFrameJs;
        if (run.elapsed < MEASURE) return;

        const eye = gl.xr.getCamera().cameras[0]?.viewport;
        run.results.push({
            name: run.list[run.index].name,
            fps: Math.round((run.frames / run.elapsed) * 10) / 10,
            js: Math.round((run.js / run.frames) * 10) / 10,
            eye: `${Math.round(eye?.z ?? 0)}x${Math.round(eye?.w ?? 0)}`,
        });
        run.undo();
        run.index += 1;
        if (run.index < run.list.length) {
            Object.assign(run, { undo: run.list[run.index].apply(), time: 0, frames: 0, elapsed: 0, js: 0 });
            return;
        }
        useGameStore.setState({ vrBenchmark: run.results });
        run = null;
        onDone();
    },

    /** The session ended: put back whatever was taken away. */
    cancel() {
        this.requested = false;
        run?.undo();
        run = null;
        vrPerformance.forcedScale = null;
    },
};
