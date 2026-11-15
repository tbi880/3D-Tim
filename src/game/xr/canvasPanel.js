import * as THREE from 'three';

/**
 * A flat panel in the 3D scene whose picture is a 2D canvas: how the VR HUD and menus are
 * drawn, since the page's HTML overlay is not visible inside a headset.
 *
 * The panel is drawn over everything (no depth test) and is never tone mapped, so its colours
 * match the flat HUD. No mipmaps: every panel is seen at roughly its own resolution, and
 * skipping them keeps each texture upload cheap.
 */
export function createCanvasPanel({ width, height, meters, renderOrder = 1000 }) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
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
    const geometry = new THREE.PlaneGeometry(meters[0], meters[1]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return {
        canvas,
        ctx,
        texture,
        mesh,
        /** Marks the canvas as changed; the texture is uploaded on the next render. */
        commit() {
            texture.needsUpdate = true;
        },
        dispose() {
            texture.dispose();
            material.dispose();
            geometry.dispose();
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
