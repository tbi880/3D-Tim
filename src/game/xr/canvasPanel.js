import * as THREE from 'three';

/**
 * A flat panel in the 3D scene whose picture is a 2D canvas: how the VR HUD and menus are
 * drawn, since the page's HTML overlay is not visible inside a headset.
 *
 * The panel is drawn over everything (no depth test) and is never tone mapped, so its colours
 * match the flat HUD. No mipmaps: every panel is seen at roughly its own resolution, and
 * skipping them keeps each texture upload cheap. `uploadOnlyChanges` is for a panel that is
 * redrawn more often than its picture changes (see `commit`).
 *
 * The texture is plain RGBA, and its sRGB colours are decoded in the shader (`DECODED_MAP`)
 * rather than by the GPU, which is what three.js would arrange by default (an sRGB texture).
 * A browser has a fast, GPU-to-GPU way of copying a canvas into a plain texture and falls
 * back to a slow one for an sRGB texture (three.js works round the same thing for video,
 * its issue 26516). Measured in a Pico: a 1024 x 768 canvas redrawn and uploaded every frame
 * into a plain texture leaves the headset at its 90 frames a second; the HUD's panels, which
 * were sRGB textures, cost more than the whole scene (20 frames a second, 32 without their
 * uploads). See xr/vrUploadTest.js.
 *
 * `commit` sends the canvas to the GPU at once (`gl.initTexture`) instead of leaving it to
 * three.js, which uploads a changed texture at the moment a mesh using it is drawn - for
 * these panels, drawn last, in the middle of the headset's frame.
 */
export function createCanvasPanel({ gl, width, height, meters, renderOrder = 1000, uploadOnlyChanges = false }) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const pen = uploadOnlyChanges ? fingerprinted(canvas.getContext('2d')) : null;
    const ctx = pen ? pen.ctx : canvas.getContext('2d');
    let uploaded = null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
    material.onBeforeCompile = decodeMapInShader;
    const geometry = new THREE.PlaneGeometry(meters[0], meters[1]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return {
        canvas,
        ctx,
        texture,
        mesh,
        /**
         * Sends the canvas to the GPU, now. Call it from a frame callback (before the frame is
         * drawn), never while drawing. With `uploadOnlyChanges`, only if what was drawn since
         * the last commit differs from what was last uploaded: a panel of text is the same
         * picture for seconds on end.
         */
        commit() {
            if (pen) {
                const drawn = pen.take();
                if (drawn === uploaded) return;
                uploaded = drawn;
            }
            texture.needsUpdate = true;
            gl.initTexture(texture);
        },
        dispose() {
            texture.dispose();
            material.dispose();
            geometry.dispose();
        },
    };
}

/** three.js's colour-texture lookup, with the texture's sRGB colours decoded here instead of by the GPU. */
const DECODED_MAP = /* glsl */ `
    #ifdef USE_MAP
        diffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );
    #endif
`;

/** `onBeforeCompile` for a material whose `map` is a plain (not sRGB) texture holding sRGB colours. */
function decodeMapInShader(shader) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', DECODED_MAP);
}

/**
 * Wraps a 2D context so that everything drawn through it leaves a fingerprint: a hash of
 * every call's name and arguments and every property set. Two frames with the same
 * fingerprint drew the same picture. `take()` returns the fingerprint and starts a new one.
 *
 * Something other than a number or a string as an argument (another canvas given to
 * drawImage) cannot be read this way, so it counts as a change every time.
 */
function fingerprinted(target) {
    let hash = 0;
    let unknowns = 0;
    const mixInt = (value) => { hash = Math.imul(hash ^ value, 16777619); };
    const mix = (value) => {
        if (typeof value === 'number') mixInt(Math.round(value * 1000));
        else if (typeof value === 'string') for (let index = 0; index < value.length; index++) mixInt(value.charCodeAt(index));
        else if (value != null) mixInt(++unknowns);
    };
    const methods = new Map();
    const ctx = new Proxy(target, {
        get(_, name) {
            const value = target[name];
            if (typeof value !== 'function') return value;
            if (!methods.has(name)) {
                methods.set(name, (...args) => {
                    mix(name);
                    args.forEach(mix);
                    return value.apply(target, args);
                });
            }
            return methods.get(name);
        },
        set(_, name, value) {
            mix(name);
            mix(value);
            target[name] = value;
            return true;
        },
    });
    return {
        ctx,
        take() {
            const taken = hash;
            hash = 0;
            return taken;
        },
    };
}

const CJK = /[⺀-鿿＀-￯　-〿]/;
const wrapCache = new Map();

/**
 * Splits `text` into lines no wider than `maxWidth` with the context's current font. Latin
 * text breaks at spaces, Chinese between any two characters. Results are cached, since the
 * same comms line is drawn every frame.
 */
export function wrapText(ctx, text, maxWidth) {
    const key = `${ctx.font}|${maxWidth}|${text}`;
    const cached = wrapCache.get(key);
    if (cached) return cached;
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
        let line = '';
        let lastBreak = -1;
        for (const char of paragraph) {
            const candidate = line + char;
            if (ctx.measureText(candidate).width <= maxWidth || line.length === 0) {
                line = candidate;
                if (char === ' ' || CJK.test(char)) lastBreak = line.length;
                continue;
            }
            if (char !== ' ' && !CJK.test(char) && lastBreak > 0 && lastBreak < line.length) {
                // Carry the unfinished word over to the next line.
                lines.push(line.slice(0, lastBreak).trimEnd());
                line = line.slice(lastBreak) + char;
            } else {
                lines.push(line.trimEnd());
                line = char === ' ' ? '' : char;
            }
            lastBreak = -1;
            if (char === ' ' || CJK.test(char)) lastBreak = line.length;
        }
        lines.push(line);
    }
    if (wrapCache.size > 200) wrapCache.clear();
    wrapCache.set(key, lines);
    return lines;
}

export function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

/** A labelled horizontal gauge: label, track, fill, percentage. */
export function drawMeter(ctx, x, y, width, label, fraction, color, warning = false) {
    const value = Math.max(0, Math.min(1, fraction));
    ctx.textAlign = 'left';
    ctx.fillStyle = warning ? '#ff6b6b' : 'rgba(190, 225, 255, 0.85)';
    ctx.fillText(label, x, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(value * 100)}%`, x + width, y);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y + 8, width, 10);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 8, width * value, 10);
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 8.5, width - 1, 9);
}
