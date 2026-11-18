import { STAR_SYSTEM } from '../config/battleRoyale.js';

/**
 * The star system seen side on: the picture behind the star map, on the page
 * (ui/multiplayer/StarMapPanel.jsx) and in the headset (xr/VRMatchMenu.js). The sun at the
 * left edge, so much bigger than the picture that only its rim shows; each planet's orbit an
 * arc round it, through that planet; the planets in orbit order, each in its own colours and lit
 * from the sun's side; and along the bottom an arrow from the sun outwards. So the map's
 * left-to-right order reads as what it is: nearest the sun on the left, the stargate's planet
 * furthest out on the right.
 *
 * Plain 2D canvas drawing, made only when something in it changes (its size, the language, a
 * planet swallowed) - never every frame.
 */

/**
 * How each planet looks: its lit, middle and shadowed colours (as the sector it is drawn from:
 * config/sectors.js) and its size against the biggest. `bands`: a gas giant's stripes.
 */
export const PLANET_LOOKS = Object.freeze({
    ember: { light: '#ffd9a0', mid: '#ff7b2e', dark: '#4a1006', size: 0.6 },
    rust: { light: '#f6b894', mid: '#c4562f', dark: '#341006', size: 0.52 },
    haven: { light: '#d2f0ff', mid: '#2f86d8', dark: '#071a40', size: 0.66 },
    veil: { light: '#f2ccff', mid: '#9d4ad6', dark: '#20073a', size: 0.72 },
    colossus: { light: '#f6e2bc', mid: '#c48d58', dark: '#2e1a0c', size: 1, bands: '#8a5a32' },
    threshold: { light: '#d6e2f4', mid: '#5f7092', dark: '#0a1222', size: 0.62 },
});
const FALLBACK_LOOK = Object.freeze({ light: '#d8eaff', mid: '#59d0ff', dark: '#0a2a44', size: 0.6 });

/** A planet's look (PLANET_LOOKS), or a plain one for a planet that has none. */
export const lookOf = (planetId) => PLANET_LOOKS[planetId] ?? FALLBACK_LOOK;

/** True for the planet the stargate is at. */
export const isGatePlanet = (planetId) => STAR_SYSTEM.planets.some((planet) => planet.id === planetId && planet.gate);

/** How much bigger than the picture is tall the sun is: big enough that its rim and the orbits bend only gently. */
const SUN_SCALE = 1.25;

/**
 * Where the sun and the orbits go in a picture: the sun's rim at `sunEdge` on the ecliptic,
 * its centre off to the left; one orbit for each planet, through it.
 * @param {{ height: number, eclipticY: number, sunEdge: number, planetXs: number[] }} frame
 * @returns {{ sun: { x: number, y: number, radius: number }, orbits: number[] }} orbit radii in the planets' order
 */
export function chartGeometry({ height, eclipticY, sunEdge, planetXs }) {
    const radius = height * SUN_SCALE;
    const sun = { x: sunEdge - radius, y: eclipticY, radius };
    return { sun, orbits: planetXs.map((x) => x - sun.x) };
}

/** Where the sun's rim is at height `y` (its left-most point if `y` is above or below the sun). */
function rimAt(sun, y) {
    const dy = Math.min(Math.abs(y - sun.y), sun.radius);
    return sun.x + Math.sqrt(sun.radius * sun.radius - dy * dy);
}

/** A few faint stars, the same ones every time (a fixed seed). */
function drawStars(ctx, x, y, width, height, scale) {
    let seed = 20261118;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const count = Math.round((width * height) / (3200 * scale * scale));
    for (let index = 0; index < count; index++) {
        ctx.globalAlpha = 0.12 + random() * 0.4;
        ctx.fillStyle = random() < 0.8 ? '#cfe6ff' : '#ffe2b8';
        ctx.beginPath();
        ctx.arc(x + random() * width, y + random() * height, (0.4 + random() * 0.8) * scale, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/**
 * The still part of the picture: stars, the sun (a star caving in - gold, rimmed in the black
 * hole's violet), the orbits, the line the planets lie on, and along the bottom the sun's name,
 * an arrow outwards and the outer orbits' name. Clipped to the frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} frame
 * @param {number} frame.x left of the picture
 * @param {number} frame.y top of the picture
 * @param {number} frame.width
 * @param {number} frame.height
 * @param {number} frame.eclipticY the planets' centre line
 * @param {number} frame.sunEdge where the sun's rim crosses that line
 * @param {number[]} frame.planetXs the planets' centres, innermost first
 * @param {number} frame.captionY baseline of the line along the bottom
 * @param {{ sun: string, outer: string }} labels the two ends of that line
 * @param {{ font: string, scale?: number }} style `font`: family list; `scale`: 1 on the page, bigger in the headset
 */
export function paintSystemBackdrop(ctx, frame, labels, { font, scale = 1 }) {
    const { x, y, width, height, eclipticY, planetXs, captionY } = frame;
    const { sun, orbits } = chartGeometry({ height, eclipticY, sunEdge: frame.sunEdge, planetXs });
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    drawStars(ctx, x, y, width, height, scale);

    // The sun's light spilling over the inner orbits, and the violet of the black hole it is becoming.
    const glow = ctx.createRadialGradient(sun.x, sun.y, sun.radius * 0.96, sun.x, sun.y, sun.radius + height * 0.55);
    glow.addColorStop(0, 'rgba(255, 176, 92, 0.42)');
    glow.addColorStop(0.35, 'rgba(176, 107, 255, 0.16)');
    glow.addColorStop(1, 'rgba(176, 107, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);

    const body = ctx.createRadialGradient(sun.x, sun.y, sun.radius * 0.7, sun.x, sun.y, sun.radius);
    body.addColorStop(0, '#fff7e0');
    body.addColorStop(0.82, '#ffd27a');
    body.addColorStop(0.95, '#ff9a3c');
    body.addColorStop(1, '#e8582a');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(176, 107, 255, 0.75)';
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.radius + 2 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // The orbits: arcs round the sun, one through each planet.
    ctx.lineWidth = 1.2 * scale;
    orbits.forEach((radius, index) => {
        ctx.strokeStyle = index === orbits.length - 1 ? 'rgba(160, 230, 255, 0.5)' : 'rgba(150, 205, 240, 0.36)';
        ctx.beginPath();
        ctx.arc(sun.x, sun.y, radius, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
    });
    // The plane the planets lie in.
    ctx.strokeStyle = 'rgba(150, 200, 235, 0.2)';
    ctx.beginPath();
    ctx.moveTo(frame.sunEdge, eclipticY);
    ctx.lineTo(x + width, eclipticY);
    ctx.stroke();

    // Along the bottom: Sun ───────▶ Outer orbits.
    const size = Math.round(11 * scale);
    ctx.font = `600 ${size}px ${font}`;
    ctx.textBaseline = 'alphabetic';
    const pad = 8 * scale;
    const start = Math.max(x + pad, rimAt(sun, captionY - size / 2) + pad * 1.5);
    const end = x + width - pad;
    ctx.fillStyle = 'rgba(255, 214, 150, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText(labels.sun, start, captionY);
    ctx.fillStyle = 'rgba(190, 228, 255, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(labels.outer, end, captionY);
    const from = start + ctx.measureText(labels.sun).width + pad;
    const to = end - ctx.measureText(labels.outer).width - pad;
    if (to - from > 24 * scale) {
        const lineY = captionY - size * 0.36;
        const head = 6 * scale;
        const arrow = ctx.createLinearGradient(from, 0, to, 0);
        arrow.addColorStop(0, 'rgba(255, 190, 110, 0.6)');
        arrow.addColorStop(1, 'rgba(160, 230, 255, 0.85)');
        ctx.strokeStyle = arrow;
        ctx.fillStyle = 'rgba(160, 230, 255, 0.85)';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.moveTo(from, lineY);
        ctx.lineTo(to - head, lineY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(to, lineY);
        ctx.lineTo(to - head * 1.6, lineY - head * 0.75);
        ctx.lineTo(to - head * 1.6, lineY + head * 0.75);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/**
 * One planet: a ball in its colours, lit from the left (where the sun is). A planet the black
 * hole has swallowed is a dark husk with a red rim. The stargate's planet wears the gate's ring.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, radius: number, look: object, swallowed?: boolean, gate?: boolean, scale?: number }} planet
 */
export function paintPlanet(ctx, { x, y, radius, look, swallowed = false, gate = false, scale = 1 }) {
    ctx.save();
    if (swallowed) {
        ctx.fillStyle = '#120914';
        ctx.strokeStyle = 'rgba(255, 75, 110, 0.7)';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else {
        const shade = ctx.createRadialGradient(x - radius * 0.45, y - radius * 0.2, radius * 0.1, x - radius * 0.2, y, radius * 1.15);
        shade.addColorStop(0, look.light);
        shade.addColorStop(0.45, look.mid);
        shade.addColorStop(1, look.dark);
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (look.bands) {
            // A gas giant's stripes, inside its disc.
            ctx.clip();
            ctx.strokeStyle = look.bands;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = radius * 0.16;
            for (const offset of [-0.42, -0.08, 0.3]) {
                ctx.beginPath();
                ctx.moveTo(x - radius, y + offset * radius);
                ctx.lineTo(x + radius, y + offset * radius + radius * 0.06);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
    if (gate) {
        ctx.save();
        ctx.strokeStyle = swallowed ? 'rgba(255, 75, 110, 0.7)' : 'rgba(150, 235, 255, 0.9)';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.ellipse(x, y, radius * 1.75, radius * 0.62, -0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * The still part kept as a picture of its own (in the headset, where the menu is redrawn
 * whenever a countdown on it ticks): painted once for each size and language, then copied.
 * Without a document (tests) it is painted straight onto `ctx` every time.
 */
const backdropCache = { key: null, canvas: null };
export function drawCachedBackdrop(ctx, frame, labels, style) {
    if (typeof document === 'undefined') {
        paintSystemBackdrop(ctx, frame, labels, style);
        return;
    }
    const key = JSON.stringify([frame, labels, style]);
    if (backdropCache.key !== key) {
        const canvas = backdropCache.canvas ?? document.createElement('canvas');
        canvas.width = Math.ceil(frame.width);
        canvas.height = Math.ceil(frame.height);
        const local = canvas.getContext('2d');
        local.clearRect(0, 0, canvas.width, canvas.height);
        const shift = (value) => value - frame.x;
        paintSystemBackdrop(local, {
            ...frame,
            x: 0,
            y: 0,
            eclipticY: frame.eclipticY - frame.y,
            captionY: frame.captionY - frame.y,
            sunEdge: shift(frame.sunEdge),
            planetXs: frame.planetXs.map(shift),
        }, labels, style);
        backdropCache.key = key;
        backdropCache.canvas = canvas;
    }
    ctx.drawImage(backdropCache.canvas, frame.x, frame.y);
}
