import * as THREE from 'three';

/**
 * The second in-headset test (xr/vrBenchmark.js runs it): what it costs to get a picture
 * drawn by the page into a texture, each of several ways, with nothing else drawn.
 *
 * Why: in a Pico the HUD's canvases cost more than the whole scene. With their textures not
 * uploaded the game ran at 32 frames a second instead of 20, and with nothing drawn at all
 * but the uploads still made, at 28 instead of the display's 90. The script's own time
 * barely moved, so the time goes somewhere in the browser's GPU side - and where exactly
 * (drawing the canvas, copying it, the size, the number of copies) decides what the HUD
 * should do instead. Each variant below does its work once a frame; the ones that still
 * reach the display's rate are the ways open to the HUD.
 */

const WIDTH = 1024;
const HEIGHT = 768;
const SMALL = 256;
const FONT = '600 22px "PingFang SC", "Microsoft YaHei", Orbitron, sans-serif';

/** Draws about what the marker pane draws in a busy frame: a clear, brackets, lines, labels. `tick` makes each frame differ. */
function drawMarkers(ctx, width, height, tick) {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#59d0ff';
    ctx.fillStyle = '#ffd36b';
    ctx.lineWidth = 2;
    ctx.font = FONT;
    for (let index = 0; index < 8; index++) {
        const x = ((index * 131 + tick * 3) % (width - 80)) + 10;
        const y = ((index * 97 + tick * 2) % (height - 80)) + 10;
        ctx.strokeRect(x, y, 56, 56);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 56, y + 56);
        ctx.stroke();
        if (index < 5) ctx.fillText(`${1200 + tick + index} m`, x, y + 76);
    }
}

function makeCanvas(width, height, software = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // `willReadFrequently` asks the browser to keep the canvas in ordinary memory and draw it on the CPU.
    const ctx = canvas.getContext('2d', software ? { willReadFrequently: true } : undefined);
    drawMarkers(ctx, width, height, 0);
    return { canvas, ctx };
}

function canvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

function pixelTexture(width, height) {
    const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

/** Sends `texture` to the GPU now. */
function upload(gl, texture) {
    texture.needsUpdate = true;
    gl.initTexture(texture);
}

/**
 * The variants, in order. Each `apply` returns { undo, frame }: `frame` is called once a
 * frame, before the frame is drawn.
 */
export function uploadVariants(gl) {
    const variant = (name, setUp) => ({
        name,
        apply() {
            let tick = 0;
            const { textures, frame } = setUp();
            return {
                frame: () => frame(++tick),
                undo: () => textures.forEach((texture) => texture.dispose()),
            };
        },
    });
    const none = { name: 'no uploads', apply: () => ({ undo() {}, frame() {} }) };

    return [
        none,
        variant('canvas 1024x768, same picture', () => {
            const texture = canvasTexture(makeCanvas(WIDTH, HEIGHT).canvas);
            return { textures: [texture], frame: () => upload(gl, texture) };
        }),
        variant('canvas 1024x768, redrawn', () => {
            const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT);
            const texture = canvasTexture(canvas);
            return { textures: [texture], frame: (tick) => { drawMarkers(ctx, WIDTH, HEIGHT, tick); upload(gl, texture); } };
        }),
        variant('CPU canvas 1024x768, redrawn', () => {
            const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT, true);
            const texture = canvasTexture(canvas);
            return { textures: [texture], frame: (tick) => { drawMarkers(ctx, WIDTH, HEIGHT, tick); upload(gl, texture); } };
        }),
        variant('CPU canvas 1024x768, redrawn, sent as pixels', () => {
            const { ctx } = makeCanvas(WIDTH, HEIGHT, true);
            const texture = pixelTexture(WIDTH, HEIGHT);
            return {
                textures: [texture],
                frame: (tick) => {
                    drawMarkers(ctx, WIDTH, HEIGHT, tick);
                    texture.image.data.set(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
                    upload(gl, texture);
                },
            };
        }),
        variant('pixels 1024x768, no canvas', () => {
            const texture = pixelTexture(WIDTH, HEIGHT);
            return { textures: [texture], frame: (tick) => { texture.image.data[tick % 4096] = tick; upload(gl, texture); } };
        }),
        variant('canvas 256x256, redrawn', () => {
            const { canvas, ctx } = makeCanvas(SMALL, SMALL);
            const texture = canvasTexture(canvas);
            return { textures: [texture], frame: (tick) => { drawMarkers(ctx, SMALL, SMALL, tick); upload(gl, texture); } };
        }),
        variant('four canvases 256x256, redrawn', () => {
            const panes = [0, 1, 2, 3].map(() => {
                const { canvas, ctx } = makeCanvas(SMALL, SMALL);
                return { ctx, texture: canvasTexture(canvas) };
            });
            return {
                textures: panes.map((pane) => pane.texture),
                frame: (tick) => panes.forEach(({ ctx, texture }) => { drawMarkers(ctx, SMALL, SMALL, tick); upload(gl, texture); }),
            };
        }),
        variant('canvas 1024x768 redrawn, a 256x256 part of it sent', () => {
            const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT);
            const source = canvasTexture(canvas);
            const texture = canvasTexture(makeCanvas(WIDTH, HEIGHT).canvas);
            upload(gl, texture);
            const region = new THREE.Box2(new THREE.Vector2(128, 128), new THREE.Vector2(128 + SMALL, 128 + SMALL));
            const position = new THREE.Vector2(128, 128);
            return {
                textures: [source, texture],
                frame: (tick) => { drawMarkers(ctx, WIDTH, HEIGHT, tick); gl.copyTextureToTexture(source, texture, region, position); },
            };
        }),
        variant('CPU canvas 1024x768 redrawn, a 256x256 part sent as pixels', () => {
            const { ctx } = makeCanvas(WIDTH, HEIGHT, true);
            const texture = pixelTexture(SMALL, SMALL);
            return {
                textures: [texture],
                frame: (tick) => {
                    drawMarkers(ctx, WIDTH, HEIGHT, tick);
                    texture.image.data.set(ctx.getImageData(128, 128, SMALL, SMALL).data);
                    upload(gl, texture);
                },
            };
        }),
        { ...none, name: 'no uploads again' },
    ];
}
