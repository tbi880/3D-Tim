// Keeps glTF models (loaded through drei's useGLTF) within iOS's per-page memory budget.
//
// On iOS only:
//  1. Textures inside glTF files are downscaled to IOS_MAX_TEXTURE_SIZE while loading.
//  2. Draco geometry is decoded in a single worker. Each worker keeps its own WASM heap,
//     and the heap never shrinks.
//  3. When a scene's <Canvas> unmounts, the models it loaded are evicted from the
//     useGLTF cache. That cache is never cleared on its own, so in this single-page app
//     every scene visited so far would otherwise stay in memory.
// Desktop and Android behaviour is unchanged.

import { GLTFLoader } from 'three-stdlib';
import { useGLTF } from '@react-three/drei';
import { isIOSDevice, IOS_MAX_TEXTURE_SIZE } from './deviceProfile';

const IOS_DRACO_WORKERS = 1;

let installed = false;
const loadedUrls = new Set();
let dracoLoader = null;

// Decoding a 4096² image needs 64 MB. Shrink one image at a time so the big textures
// in a model don't all sit in memory at full size together.
let shrinkQueue = Promise.resolve();
function enqueue(task) {
    const run = shrinkQueue.then(task, task);
    shrinkQueue = run.catch(() => { });
    return run;
}

async function shrinkTexture(texture, maxSize) {
    const image = texture.image;
    const width = image && (image.naturalWidth || image.width);
    const height = image && (image.naturalHeight || image.height);
    if (!width || !height || Math.max(width, height) <= maxSize) return;

    const scale = maxSize / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    let resized = null;
    try {
        resized = await createImageBitmap(image, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: 'high',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
        });
        if (resized.width !== w || resized.height !== h) { // resize options ignored
            resized.close();
            resized = null;
        }
    } catch {
        resized = null;
    }
    if (!resized) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(image, 0, 0, w, h);
            resized = canvas;
        } catch {
            return; // keep the original texture rather than break the model
        }
    }

    // Texture clones made by GLTFLoader share this Source, so all of them get the small image.
    texture.image = resized;
    texture.needsUpdate = true;

    // Free the full-size decode now instead of whenever the GC gets to it.
    try {
        if (typeof image.close === 'function') image.close();
        else if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) image.src = '';
    } catch { /* ignore */ }
}

// GLTFLoader plugin: wraps parser.loadImageSource so every image source is capped once.
function textureSizeCapPlugin(parser) {
    const loadImageSource = parser.loadImageSource;
    parser.loadImageSource = function (sourceIndex, loader) {
        const firstRequest = this.sourceCache[sourceIndex] === undefined;
        const promise = loadImageSource.call(this, sourceIndex, loader);
        if (!firstRequest) return promise; // later requests clone the (already capped) texture
        const capped = promise.then((texture) =>
            enqueue(() => shrinkTexture(texture, IOS_MAX_TEXTURE_SIZE)).then(() => texture)
        );
        this.sourceCache[sourceIndex] = capped;
        return capped;
    };
    return { name: 'IOS_TEXTURE_SIZE_CAP' };
}

export function installGLTFMemoryGuard() {
    if (installed || !isIOSDevice) return;
    installed = true;

    const load = GLTFLoader.prototype.load;
    GLTFLoader.prototype.load = function (url, ...rest) {
        if (typeof url === 'string') loadedUrls.add(url);
        return load.call(this, url, ...rest);
    };

    const parse = GLTFLoader.prototype.parse;
    GLTFLoader.prototype.parse = function (...args) {
        this.register(textureSizeCapPlugin); // no-op if already registered
        if (this.dracoLoader) {
            dracoLoader = this.dracoLoader;
            dracoLoader.setWorkerLimit(IOS_DRACO_WORKERS);
        }
        return parse.apply(this, args);
    };
}

// Call when a scene's canvas goes away. Its WebGL context is destroyed by
// @react-three/fiber; this frees the CPU-side copies (geometry arrays, decoded images).
export function releaseLoadedModels() {
    if (!isIOSDevice) return;
    for (const url of loadedUrls) useGLTF.clear(url);
    loadedUrls.clear();

    // Terminate idle Draco workers so their WASM heaps are freed; a new worker starts on the next decode.
    if (dracoLoader && dracoLoader.workerPool.every((w) => Object.keys(w._callbacks || {}).length === 0)) {
        dracoLoader.dispose();
    }
}
