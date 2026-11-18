import { PLAYER_FACTIONS } from '../config/battleRoyale.js';
import { isBattle } from '../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../modes/battleRoyale/collapse.js';
import { drawCachedBackdrop, isGatePlanet, lookOf, paintPlanet } from '../ui/systemChart.js';
import { roundRect } from './canvasPanel.js';

/**
 * The star map on a VR menu panel (xr/VRMatchMenu.js): the flat page's map cards
 * (ui/multiplayer/StarMapPanel.jsx) drawn as one picture. It is on the star map itself, and
 * on the menu of a pilot who is down, where the stations they may come back to are marked on
 * it - so the choice of where to come back is made with the whole system in view.
 *
 * Either way the planet of the row the stick is on (a jump, a station, a comrade to watch) is
 * framed as the row is: moving down the rows moves the frame along the map.
 */

export const SIDE_COLORS = Object.freeze({ dawn: '#59d0ff', umbra: '#c04dff', pirate: '#ffb648' });
export const STATUS_COLORS = Object.freeze({ [PLANET_STATUS.SAFE]: '#7dffa8', [PLANET_STATUS.COLLAPSING]: '#ffb648', [PLANET_STATUS.SWALLOWED]: '#ff4b6e' });
const MAP_FONT = '"PingFang SC", "Microsoft YaHei", Orbitron, sans-serif';
/** The star map's height on the panel: the planets' row, three lines of text under it, and the "Sun → outer orbits" line. */
export const MAP_HEIGHT = 222;
/** The biggest planet's radius on the panel (the others are drawn smaller: ui/systemChart.js PLANET_LOOKS). */
const MAP_PLANET_MAX = 22;
/** The column at the left the sun's rim takes. */
const SUN_WIDTH = 54;
/** The selected row's colour on the menu (xr/VRMenu.js), which the frame round its planet shares. */
const FOCUS_COLOR = '#59d0ff';

/** What a station a pilot who is down may (or may not yet) come back to is marked with on the map. */
export const RESPAWN_MARK = Object.freeze({
    /** Where they are sent if they do not choose. */
    DEFAULT: 'default',
    OPEN: 'open',
    /** Another side is docked there, taking it. */
    CONTESTED: 'contested',
    /** The planet will be swallowed before a new ship could jump away. */
    FALLING: 'falling',
});

/** Each mark's words (short: they sit above a planet) and colours: `solid` is filled, the rest are outlined. */
export const MARK_STYLES = Object.freeze({
    [RESPAWN_MARK.DEFAULT]: Object.freeze({ key: 'mp.respawn.mapDefault', color: '#7dffa8', solid: true }),
    [RESPAWN_MARK.OPEN]: Object.freeze({ key: 'mp.respawn.mapOpen', color: '#7dffa8', solid: false }),
    [RESPAWN_MARK.CONTESTED]: Object.freeze({ key: 'mp.respawn.mapContested', color: '#ff4b6e', solid: false }),
    [RESPAWN_MARK.FALLING]: Object.freeze({ key: 'mp.respawn.mapFalling', color: '#ffb648', solid: false }),
});

/**
 * The marks for the menu of a pilot who is down, by planet id: the stations they may come back
 * to (the first one offered is where they are sent), and the ones their side holds that cannot
 * be chosen now, with the reason.
 * @param {{ stations: string[], contested: string[], falling: string[] } | null} respawn `you.respawn` of the match state
 * @returns {Record<string, string>} RESPAWN_MARK by planet id
 */
export function respawnMarks(respawn) {
    const marks = {};
    if (!respawn) return marks;
    respawn.stations.forEach((planetId, index) => {
        marks[planetId] = index === 0 ? RESPAWN_MARK.DEFAULT : RESPAWN_MARK.OPEN;
    });
    for (const planetId of respawn.contested) marks[planetId] ??= RESPAWN_MARK.CONTESTED;
    for (const planetId of respawn.falling) marks[planetId] ??= RESPAWN_MARK.FALLING;
    return marks;
}

/**
 * Where the planets go across a map `width` wide from `x`: one column each after the sun's.
 * @returns {{ cell: number, xs: number[] }} a column's width, and each planet's centre
 */
export function mapColumns(x, width, count) {
    const cell = (width - SUN_WIDTH) / count;
    return { cell, xs: Array.from({ length: count }, (_, index) => x + SUN_WIDTH + cell * (index + 0.5)) };
}

/** The frame round the planet whose row is selected: as tall as its column's words, clear of the line along the bottom. */
export function focusFrame(cx, y, cell) {
    return { x: cx - cell / 2 + 3, y: y + 2, width: cell - 6, height: MAP_HEIGHT - 30 };
}

/**
 * Draws the star map the flat page shows as cards (ui/multiplayer/StarMapPanel.jsx): the
 * system side on as on the page (ui/systemChart.js: the collapsing sun at the left, an orbit
 * round it through each planet, "Sun → outer orbits" along the bottom), then over it every
 * planet in orbit order with its state and countdown, and where the player is. Where their
 * side has eyes (a pilot, a station it holds, or a beacon): who holds the station (a ring in
 * that side's colour), the ships there by side, a docking in progress, comrades. Elsewhere: a
 * question mark. The still part of the picture is kept and copied, not drawn again each time
 * a countdown on the map ticks.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} match the match state (modes/battleRoyale/battleRoyaleState.js)
 * @param {(key: string, params?: object) => string} t
 * @param {{ marks?: Record<string, string> | null, focus?: string | null }} [options] `marks`: RESPAWN_MARK by planet id
 *   (respawnMarks), drawn above those planets; `focus`: the planet of the row the stick is on, framed
 * @returns {number} the height it took
 */
export function drawStarMap(ctx, x, y, width, match, t, { marks = null, focus = null } = {}) {
    const { planets, you } = match;
    const { cell, xs: planetXs } = mapColumns(x, width, planets.length);
    const centreY = y + 62;
    drawCachedBackdrop(ctx, {
        x: x - 24, y, width: width + 48, height: MAP_HEIGHT, eclipticY: centreY, sunEdge: x + 30, planetXs, captionY: y + MAP_HEIGHT - 8,
    }, { sun: t('mp.map.sun'), outer: t('mp.map.outer') }, { font: MAP_FONT, scale: 1.55 });
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // The selected row's planet, framed as the row is (behind the planet and its words).
    const focusIndex = focus ? planets.findIndex((planet) => planet.id === focus) : -1;
    if (focusIndex >= 0) {
        const frame = focusFrame(planetXs[focusIndex], y, cell);
        roundRect(ctx, frame.x, frame.y, frame.width, frame.height, 14);
        ctx.fillStyle = 'rgba(89, 208, 255, 0.16)';
        ctx.fill();
        ctx.strokeStyle = FOCUS_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    planets.forEach((planet, index) => {
        const cx = planetXs[index];
        const here = planet.id === you.planet;
        const gate = isGatePlanet(planet.id);
        const swallowed = planet.status === PLANET_STATUS.SWALLOWED;
        const color = STATUS_COLORS[planet.status];
        const look = lookOf(planet.id);
        const radius = look.size * MAP_PLANET_MAX;
        ctx.textAlign = 'center';

        drawTopLine(ctx, cx, y + 20, cell, here ? `▼ ${t('mp.lan.you')}` : null, marks?.[planet.id] ?? null, t);
        // The side that holds the planet's station.
        if (planet.owner) {
            ctx.strokeStyle = SIDE_COLORS[planet.owner];
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(cx, centreY, MAP_PLANET_MAX + 9, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = swallowed ? 0.6 : 1;
        paintPlanet(ctx, { x: cx, y: centreY, radius, look, swallowed, gate, scale: 1.5 });
        // A planet falling in: an amber ring round it (a swallowed one has its red rim already).
        if (planet.status === PLANET_STATUS.COLLAPSING) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, centreY, radius + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = swallowed ? 0.45 : 1;
        ctx.textAlign = 'center';

        ctx.fillStyle = here || index === focusIndex ? '#ffffff' : 'rgba(225, 240, 255, 0.92)';
        ctx.font = `700 19px ${MAP_FONT}`;
        ctx.fillText(t(`mp.planet.${planet.id}`), cx, centreY + 56);
        ctx.fillStyle = color;
        ctx.font = `600 15px ${MAP_FONT}`;
        const status = gate && planet.status === PLANET_STATUS.SAFE ? t('mp.map.gate') : t(`mp.hud.status.${planet.status}`);
        ctx.fillText(planet.changesIn === null ? status : `${status} ${planet.changesIn}s`, cx, centreY + 77);

        ctx.font = `700 16px ${MAP_FONT}`;
        if (!planet.known) {
            ctx.fillStyle = 'rgba(225, 240, 255, 0.45)';
            ctx.fillText('?', cx, centreY + 99);
        } else {
            // The ships there, in their sides' colours; red under them when sides are fighting.
            const sides = PLAYER_FACTIONS.filter((faction) => planet.forces[faction] > 0);
            const spacing = 40;
            sides.forEach((faction, slot) => {
                ctx.fillStyle = SIDE_COLORS[faction];
                ctx.fillText(`◆${planet.forces[faction]}`, cx + (slot - (sides.length - 1) / 2) * spacing, centreY + 99);
            });
            if (planet.beacon) {
                ctx.fillStyle = '#7dffa8';
                ctx.fillText('⌖', cx + 34, centreY - 22);
            }
            const note = planet.docking ? t('mp.map.docking', { faction: t(`mp.faction.${planet.docking}`) })
                : isBattle(planet.forces) ? t('mp.map.battle') : null;
            if (note && planet.comrades.length === 0) {
                ctx.fillStyle = planet.docking ? SIDE_COLORS[planet.docking] : '#ff4b6e';
                ctx.font = `600 14px ${MAP_FONT}`;
                ctx.fillText(note, cx, centreY + 119);
            }
        }
        if (planet.comrades.length > 0) {
            ctx.fillStyle = SIDE_COLORS[you.faction];
            ctx.font = `600 14px ${MAP_FONT}`;
            const names = planet.comrades.join(', ');
            ctx.fillText(names.length > 14 ? `${names.slice(0, 13)}…` : names, cx, centreY + 119);
        }
        ctx.globalAlpha = 1;
    });
    ctx.restore();
    return MAP_HEIGHT;
}

/**
 * The line above a planet: "▼ You" where the player is, and a respawn mark (a pill) where they
 * may come back. Both side by side when they fit in the column; else the mark alone, since it
 * is what the choice is made on.
 */
function drawTopLine(ctx, cx, baseline, cell, here, mark, t) {
    const style = mark ? MARK_STYLES[mark] : null;
    if (!here && !style) return;
    ctx.font = `700 17px ${MAP_FONT}`;
    const hereWidth = here ? ctx.measureText(here).width : 0;
    const label = style ? t(style.key) : '';
    ctx.font = `700 15px ${MAP_FONT}`;
    const pad = 9;
    const pillWidth = style ? ctx.measureText(label).width + pad * 2 : 0;
    const gap = 8;
    const together = here && style && hereWidth + gap + pillWidth <= cell - 8;
    const showHere = here && (!style || together);
    const total = (showHere ? hereWidth : 0) + (showHere && style ? gap : 0) + pillWidth;
    let left = cx - total / 2;
    if (showHere) {
        ctx.font = `700 17px ${MAP_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(here, left, baseline);
        left += hereWidth + gap;
    }
    if (style) {
        const height = 24;
        roundRect(ctx, left, baseline - 17, pillWidth, height, height / 2);
        ctx.fillStyle = style.solid ? style.color : 'rgba(4, 14, 26, 0.75)';
        ctx.fill();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `700 15px ${MAP_FONT}`;
        ctx.fillStyle = style.solid ? '#04140c' : style.color;
        ctx.textAlign = 'left';
        ctx.fillText(label, left + pad, baseline);
    }
    ctx.textAlign = 'center';
}
