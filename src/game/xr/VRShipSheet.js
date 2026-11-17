import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { hangarImage } from '../ui/hangarImages.js';
import { shipAbilityText, shipSpecRows } from '../ui/shipText.js';
import { wrapText } from './canvasPanel.js';

/**
 * A player ship on the VR menu panel: what the hangar page shows on the flat page (ui/Hangar.jsx)
 * as one picture - the ship from the side and its rating bars on the left, what it is, what
 * its ability does and its numbers on the right. VRMenu draws it between a menu's text and
 * its rows (a menu's `diagram`).
 */

const FONT = '"PingFang SC", "Microsoft YaHei", Orbitron, sans-serif';
const AMBER = '#ffb648';
const CYAN = '#59d0ff';
const TEXT = 'rgba(225, 240, 255, 0.92)';
const DIM = 'rgba(170, 205, 230, 0.85)';

const IMAGE_WIDTH = 300;
const IMAGE_HEIGHT = 150;
const RATING_ROW = 23;
const LINE = 25;
/** Room for the longest ship (English runs to more lines than Chinese). */
export const SHIP_SHEET_HEIGHT = 326;

/**
 * The hangar's side view of each ship, fetched when first asked for. The panel's canvas is
 * sent to the GPU, which refuses a canvas that holds a picture from another site unless that
 * site allowed it: the pictures are asked for with CORS (and under an address of their own,
 * so a copy the flat page cached without it is never handed back), and one that does not
 * arrive is simply left out of the sheet.
 */
const pictures = new Map();
function shipPicture(classId) {
    let picture = pictures.get(classId);
    if (!picture && typeof Image !== 'undefined') {
        picture = { image: new Image(), ready: false };
        picture.image.crossOrigin = 'anonymous';
        picture.image.onload = () => { picture.ready = true; };
        picture.image.src = `${hangarImage(classId, 'side')}?panel`;
        pictures.set(classId, picture);
    }
    return picture?.ready ? picture.image : null;
}

/** Changes whenever the sheet would look different: another ship, or its picture has arrived. */
export function shipSheetKey(classId) {
    return `${classId}:${shipPicture(classId) ? 'picture' : 'plain'}`;
}

/** Draws `text` wrapped to `maxWidth`, at most `maxLines` lines (the last one cut short with an ellipsis). Returns the y after it. */
function paragraph(ctx, text, x, y, maxWidth, maxLines) {
    const lines = wrapText(ctx, text, maxWidth);
    lines.slice(0, maxLines).forEach((line, index) => {
        const cut = index === maxLines - 1 && lines.length > maxLines;
        ctx.fillText(cut ? `${line.slice(0, -1)}…` : line, x, y + (index + 1) * LINE);
    });
    return y + Math.min(lines.length, maxLines) * LINE;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x left edge
 * @param {number} y top edge
 * @param {number} width
 * @param {string} classId
 * @param {(key: string, params?: object) => string} t
 * @returns {number} the height it took
 */
export function drawShipSheet(ctx, x, y, width, classId, t) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // ---- Left: the ship from the side, and its rating bars --------------------------------
    const glow = ctx.createRadialGradient(x + IMAGE_WIDTH / 2, y + IMAGE_HEIGHT / 2, 10, x + IMAGE_WIDTH / 2, y + IMAGE_HEIGHT / 2, IMAGE_WIDTH * 0.6);
    glow.addColorStop(0, 'rgba(89, 208, 255, 0.2)');
    glow.addColorStop(1, 'rgba(6, 18, 32, 0.6)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, IMAGE_WIDTH, IMAGE_HEIGHT);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, IMAGE_WIDTH, IMAGE_HEIGHT);
    const picture = shipPicture(classId);
    if (picture) {
        // Fitted inside the frame, whatever the picture's shape.
        const scale = Math.min(IMAGE_WIDTH / picture.naturalWidth, IMAGE_HEIGHT / picture.naturalHeight);
        const w = picture.naturalWidth * scale;
        const h = picture.naturalHeight * scale;
        ctx.drawImage(picture, x + (IMAGE_WIDTH - w) / 2, y + (IMAGE_HEIGHT - h) / 2, w, h);
    }

    const ratings = PLAYER_SHIPS.find((ship) => ship.classId === classId)?.ratings ?? {};
    const pipsLeft = x + 96;
    const pipWidth = (IMAGE_WIDTH - 96) / RATING_MAX;
    ctx.font = `600 17px ${FONT}`;
    RATING_ORDER.forEach((rating, row) => {
        const baseline = y + IMAGE_HEIGHT + 12 + row * RATING_ROW + 17;
        ctx.fillStyle = DIM;
        ctx.fillText(t(`ui.rating.${rating}`), x, baseline);
        for (let pip = 0; pip < RATING_MAX; pip++) {
            ctx.fillStyle = pip < (ratings[rating] ?? 0) ? AMBER : 'rgba(120, 200, 255, 0.2)';
            ctx.fillRect(pipsLeft + pip * pipWidth, baseline - 12, pipWidth - 3, 11);
        }
    });

    // ---- Right: what the ship is, its ability, its numbers ----------------------------------
    const left = x + IMAGE_WIDTH + 26;
    const right = width - IMAGE_WIDTH - 26;
    let line = y - 4;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = CYAN;
    ctx.fillText(t(`playerShip.${classId}.role`), left, line + LINE);
    line += LINE;
    ctx.font = `400 18px ${FONT}`;
    ctx.fillStyle = TEXT;
    line = paragraph(ctx, t(`playerShip.${classId}.text`), left, line, right, 4);

    const { heading, text } = shipAbilityText(t, classId);
    line += 6;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillStyle = AMBER;
    ctx.fillText(wrapText(ctx, heading, right)[0], left, line + LINE);
    line += LINE;
    if (text) {
        ctx.font = `400 18px ${FONT}`;
        ctx.fillStyle = TEXT;
        line = paragraph(ctx, text, left, line, right, 3);
    }

    // The numbers, from the bottom up so they always sit on the sheet's last lines: shields,
    // hull and speed on one, a line each for the beams and the torpedoes.
    const rows = shipSpecRows(t, classId);
    const part = (id) => {
        const row = rows.find((entry) => entry.id === id);
        return row ? `${row.label} ${row.value}` : '';
    };
    const specs = [`${part('shields')}  ·  ${part('hull')}`, part('speed'), `${part('beam')}`, part('torpedo')];
    ctx.font = `600 17px ${FONT}`;
    ctx.fillStyle = DIM;
    const bottom = y + SHIP_SHEET_HEIGHT;
    const firstSpec = Math.max(line + 8, bottom - specs.length * 22);
    specs.forEach((spec, index) => {
        ctx.fillText(wrapText(ctx, spec, right)[0], left, firstSpec + (index + 1) * 22 - 5);
    });
    ctx.restore();
    return SHIP_SHEET_HEIGHT;
}
