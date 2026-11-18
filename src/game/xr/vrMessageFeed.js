import { MESSAGE_FEED, lineOpacity, shownLines } from '../state/MessageFeed.js';
import { FEED_ROLE, feedSegments } from '../ui/feedText.js';
import { roundRect } from './canvasPanel.js';

/**
 * The message feed inside the headset (the flat page's is ui/MessageFeed.jsx): a match's news
 * - who shot whom down - as a short column in the upper right of the head-up text pane, some
 * 20 to 35 degrees right of the line of sight and 8 to 18 above it: read with a glance, and
 * over nothing the pilot flies by. It is narrow enough to stay right of the warnings that
 * come up in the middle of the pane at that height, and starts under the objective. Each line
 * holds for the seconds the feed keeps it and fades out at the end; with none there is nothing here.
 *
 * Drawn in the pane's logical pixels (640 x 480). A line that holds is the same picture frame
 * after frame, so the pane is uploaded again only while one comes in or fades.
 */

/** The column's right edge (the comrades' column is as far in from the left edge) and the top of its first line (px). */
export const FEED_RIGHT = 614;
export const FEED_TOP = 96;
/**
 * No line is wider than this - the pane's middle, where the warnings are, begins left of it.
 * One that would be is told a shorter way (`FITS`), and squeezed if the shortest is still too wide.
 */
export const FEED_MAX_WIDTH = 172;
/** The ways a line is told, the roomiest first: all of it, an arrow for the weapon, and the sides left to the colours. */
const FITS = Object.freeze([{}, { weapons: false }, { compact: true }]);
const ROW_HEIGHT = 17;
const ROW_GAP = 3;
const PADDING = 6;
const PIECE_GAP = 5;
/** Steps the fading is drawn in: fewer different pictures, fewer uploads. */
const OPACITY_STEPS = 8;

const TONES = Object.freeze({
    dawn: '#59d0ff',
    umbra: '#cf7dff',
    pirate: '#ffb648',
    muted: 'rgba(205, 225, 240, 0.72)',
    warn: '#ff9a5c',
});
/** A line's strip: [fill, edge] - plain, the player's own kill, the player's own end. */
const STRIPS = Object.freeze({
    plain: ['rgba(4, 12, 22, 0.5)', 'rgba(140, 190, 230, 0.4)'],
    killer: ['rgba(58, 40, 4, 0.72)', '#ffb648'],
    victim: ['rgba(60, 6, 18, 0.72)', '#ff4b6e'],
});

const fontOf = (role, family) => (role === FEED_ROLE.NAME ? `700 11px ${family}` : role === FEED_ROLE.TAG ? `600 9px ${family}` : `500 10px ${family}`);
/** A tag is boxed: this much room either side of its text. */
const TAG_INSET = 3;

/** The pieces of a line with the width each takes, and the width of them all together. */
function measure(ctx, pieces, family) {
    let width = 0;
    const measured = pieces.map((piece, index) => {
        ctx.font = fontOf(piece.role, family);
        const own = ctx.measureText(piece.text).width + (piece.role === FEED_ROLE.TAG ? 2 * TAG_INSET : 0);
        width += own + (index > 0 ? PIECE_GAP : 0);
        return { ...piece, width: own };
    });
    return { pieces: measured, width };
}

/**
 * Draws the feed's lines (those there is room for), newest lowest, each ending at `right`.
 * @param {CanvasRenderingContext2D} ctx the head-up text pane, in logical pixels
 * @param {object[]} lines the feed's lines (the game store's `feed`)
 * @param {(key: string, params?: object) => string} t
 * @param {number} time the feed's clock (`session.feed.time`)
 * @param {object} [options]
 * @param {string} [options.font] the font family
 * @param {number} [options.right] @param {number} [options.top] where the column stands
 * @param {number} [options.rows] lines shown at most
 */
export function drawMessageFeed(ctx, lines, t, time, { font = 'sans-serif', right = FEED_RIGHT, top = FEED_TOP, rows = MESSAGE_FEED.rows.vr } = {}) {
    const shown = shownLines(lines, rows);
    if (shown.length === 0) return;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    shown.forEach((line, row) => {
        const opacity = Math.ceil(lineOpacity(line, time) * OPACITY_STEPS) / OPACITY_STEPS;
        if (opacity <= 0) return;
        let layout = null;
        for (const fit of FITS) {
            layout = measure(ctx, feedSegments(t, line, fit), font);
            if (layout.width <= FEED_MAX_WIDTH - 2 * PADDING) break;
        }
        const squeeze = Math.min(1, (FEED_MAX_WIDTH - 2 * PADDING) / layout.width);
        const width = layout.width * squeeze + 2 * PADDING;
        const y = top + row * (ROW_HEIGHT + ROW_GAP);
        const [fill, edge] = STRIPS[line.you] ?? STRIPS.plain;

        ctx.globalAlpha = opacity;
        roundRect(ctx, right - width, y, width, ROW_HEIGHT, 3);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.fillStyle = edge;
        ctx.fillRect(right - 2, y, 2, ROW_HEIGHT);

        ctx.save();
        ctx.translate(right - width + PADDING, y + ROW_HEIGHT / 2 + 0.5);
        ctx.scale(squeeze, 1);
        let x = 0;
        for (const piece of layout.pieces) {
            const color = TONES[piece.tone] ?? TONES.muted;
            ctx.font = fontOf(piece.role, font);
            if (piece.role === FEED_ROLE.TAG) {
                ctx.strokeStyle = color;
                ctx.lineWidth = 0.8;
                ctx.strokeRect(x + 0.5, -6, piece.width - 1, 12);
                ctx.fillStyle = color;
                ctx.fillText(piece.text, x + TAG_INSET, 0);
            } else {
                ctx.fillStyle = color;
                ctx.fillText(piece.text, x, 0);
            }
            x += piece.width + PIECE_GAP;
        }
        ctx.restore();
    });
    ctx.restore();
}
