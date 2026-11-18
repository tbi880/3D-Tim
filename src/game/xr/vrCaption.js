import { rosterBySide } from '../modes/battleRoyale/battleRoyaleState.js';
import { wrapText } from './canvasPanel.js';

/**
 * The words of the story before a match, inside the headset (the flat page's are
 * ui/multiplayer/MatchCinematic.jsx): a caption on the head-up text pane, under the line of
 * sight, like a film's subtitles. The story itself plays all round the pilot; no panel is put
 * in front of it, and nothing else of the head-up display shows while it is told.
 *
 * Drawn in the pane's logical pixels (640 x 480 across about 80 x 62 degrees). The pane is
 * only uploaded when its picture changes: a line of the story, or the seconds left.
 */

/** The widest a line of the caption gets, and where its first line's baseline sits: about 14 degrees under the line of sight. */
const CAPTION_WIDTH = 430;
const CAPTION_TOP = 344;
const LINE_HEIGHT = 22;
const AMBER = '#ffb648';

/** Text with a dark edge all round, so it reads over a bright sky as over a dark one. */
function drawEdgedText(ctx, text, x, y, color) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function pilotCount(t, count) {
    if (count === 0) return t('mp.intro.noPilots');
    return count === 1 ? t('mp.intro.onePilot') : t('mp.intro.pilots', { count });
}

/**
 * What the caption says: the story's line that is up (under its title, while the first is), the
 * sides once they are shown - the player's own first - and how to skip it.
 * @param {{ line: number, sides: boolean }} intro where the story stands (`matchIntro` of the game store)
 * @param {object} match the match state
 * @param {(key: string, params?: object) => string} t
 * @param {number} lastLine index of the story's last line
 * @returns {{ title: string | null, line: string, last: boolean, yours: string | null, others: string | null, hint: string }}
 */
export function storyCaption(intro, match, t, lastLine) {
    const roster = rosterBySide(match);
    const own = roster.find((side) => side.faction === match.you?.faction);
    const count = (side) => `${t(`mp.faction.${side.faction}`)} ${pilotCount(t, side.players.length)}`;
    const votes = match.skip?.voted > 0 ? `${t('mp.intro.votes', match.skip)} · ` : '';
    return {
        title: intro.line === 0 ? t('mp.intro.title') : null,
        line: t(`mp.intro.line${intro.line + 1}`),
        last: intro.line >= lastLine,
        yours: intro.sides && own ? `${t('mp.intro.yourSide', { faction: t(`mp.faction.${own.faction}`) })} · ${pilotCount(t, own.players.length)}` : null,
        others: intro.sides ? roster.filter((side) => side !== own).map(count).join(' · ') : null,
        hint: `${t('mp.intro.skipVR')} · ${votes}${t('mp.intro.entering', { seconds: match.intro })}`,
    };
}

/**
 * Draws the caption on the head-up text pane (already cleared, in logical pixels).
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof storyCaption>} caption
 * @param {number} width the pane's logical width
 * @param {string} font the HUD's font family
 */
export function drawStoryCaption(ctx, caption, width, font) {
    const centre = width / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (caption.title) {
        ctx.font = `700 12px ${font}`;
        drawEdgedText(ctx, caption.title, centre, CAPTION_TOP - 24, 'rgba(200, 228, 255, 0.92)');
    }
    ctx.font = `600 17px ${font}`;
    let y = CAPTION_TOP;
    for (const line of wrapText(ctx, caption.line, CAPTION_WIDTH).slice(0, 3)) {
        drawEdgedText(ctx, line, centre, y, caption.last ? AMBER : '#f0f8ff');
        y += LINE_HEIGHT;
    }
    if (caption.yours) {
        ctx.font = `700 13px ${font}`;
        drawEdgedText(ctx, caption.yours, centre, y + 2, AMBER);
        ctx.font = `500 11px ${font}`;
        drawEdgedText(ctx, caption.others, centre, y + 18, 'rgba(215, 232, 250, 0.85)');
        y += 34;
    }
    ctx.font = `500 10px ${font}`;
    drawEdgedText(ctx, caption.hint, centre, y + 4, 'rgba(200, 220, 240, 0.6)');
    ctx.textAlign = 'left';
}
