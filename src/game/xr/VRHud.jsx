import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CHARACTERS } from '../config/characters.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { translate } from '../i18n/index.js';
import { jumpStatusText, watchedPilot } from '../modes/battleRoyale/battleRoyaleState.js';
import { CABIN_SCALE } from '../scene/CockpitCabin.jsx';
import layout from '../scene/cockpitLayout.json';
import { isHullHitOnPlayer, playerFeedback } from '../scene/effects/playerFeedback.js';
import { PHASE, SESSION_EVENTS } from '../state/GameSession.js';
import { useGameStore } from '../state/gameStore.js';
import { TUTORIAL_STATE } from '../state/Tutorial.js';
import { abilityStateText } from '../ui/abilityText.js';
import { drawMarkers, drawRadar } from '../ui/markerRenderer.js';
import { tutorialKeys, tutorialParams, tutorialText } from '../ui/tutorialText.js';
import { createCanvasPanel, drawMeter, roundRect, wrapText } from './canvasPanel.js';

/**
 * The flight HUD inside the headset. Everything hangs off the pilot's seat (the player
 * camera), so it stays put in the cockpit while the head looks around.
 *
 *  - Head-up display: two transparent panes, one on the other, VIEW_DISTANCE metres ahead of
 *    the seat (far enough away that leaning a little in the seat barely shifts them):
 *      - markers: the flat game's marker layer (reticle, target brackets, off-screen arrows,
 *        waypoint), drawn through a virtual camera whose frustum is exactly the pane, so every
 *        marker sits on the line from the eye to its ship. Redrawn every frame: anything
 *        slower and the brackets trail behind their ships in a turn.
 *      - text: objective, alerts, title cards, the comms line, the points for each kill
 *        (beside the reticle) and the tutorial's card. Text is what shows a soft
 *        texture first, so this pane has the headset's own angular resolution; it only changes
 *        slowly, so it is redrawn TEXT_RATE times a second, and uploaded to the GPU (1.8
 *        million pixels) only when the redrawn picture differs from the last one.
 *  - Instrument panel below the line of sight: shields, hull, beam energy, afterburner,
 *    radar, speed, torpedoes, power mode and the current target. Redrawn ten times a second.
 *    In a match, a pilot who is down and watches a comrade fly sees that ship's instruments
 *    here (named on the panel's top edge), and the head-up lines under the reticle are about
 *    that comrade: where they are, their jump drive or docking, what is on.
 *    A hit on the bare hull (shield down) scrambles its picture for a moment: it tears,
 *    ghosts and drops lines, redrawn every frame while that lasts.
 *  - A veil around the eye for the docking fade-to-black and the warp-arrival white-out.
 */

const VIEW_DISTANCE = 12;
const VIEW_FOV_Y = 62;
const VIEW_ASPECT = 4 / 3;
/** Both panes are drawn in "CSS pixels" of this size, scaled up to their textures. */
const VIEW_LOGICAL = [640, 480];
/** Markers: 13 pixels per degree, uploaded every frame. */
const MARKER_TEXTURE = [1024, 768];
/** Text: 20 pixels per degree, about what the headset's lenses resolve. */
const TEXT_TEXTURE = [1536, 1152];
/** Fast enough for the comms line's typewriter and the blinking alerts. */
const TEXT_RATE = 15;

const PANEL_TEXTURE = [1024, 384];
/**
 * Low on the dashboard (about 35 degrees below the line of sight), tilted up towards the eye.
 * Its size, place and tilt are in cockpitLayout.json, which the cabin model is built from too
 * (tools/game-models/vr-cockpit), so the picture always sits on the model's display glass.
 */
const PANEL_METERS = layout.display.meters;
const PANEL_POSITION = layout.display.position;
const PANEL_TILT = layout.display.tilt;
/** The comms box ends here (logical px), above the instrument panel's top edge. */
const PANE_TEXT_BOTTOM = 392;
const PANEL_INTERVAL = 0.1;
/** A hull hit scrambles the panel this much (0..1) plus a little per point of damage; it clears at GLITCH_DECAY (1/s). */
const GLITCH_PER_HIT = 0.55;
const GLITCH_PER_DAMAGE = 0.03;
const GLITCH_DECAY = 2.2;

/** Must match ui/CommsPanel.jsx. */
const TYPE_SPEED = 55;

/**
 * The points for each kill ("+150 Raider", under the running total), as the flat HUD's score
 * feed (ui/GameHud.jsx): each line pops in, holds, then rises away, SCORE_POPUP_SECONDS in
 * all. Here it stands to the right of the reticle at SCORE_FEED_OFFSET (px from the pane's
 * centre), where no other text of this pane ever is, and shows the last few kills only.
 */
const SCORE_POPUP_SECONDS = 3.8;
const MAX_SCORE_POPUPS = 3;
const SCORE_FEED_OFFSET = 54;
const SCORE_ROW_HEIGHT = 22;

const FONT = '"PingFang SC", "Microsoft YaHei", Orbitron, sans-serif';
const percentText = (value) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

/** Shared with the controller input: whether the comms line is still being typed out. */
export const vrComms = { lineId: null, startedAt: 0, revealed: false, typing: false };

function paneSize() {
    const height = 2 * VIEW_DISTANCE * Math.tan(THREE.MathUtils.degToRad(VIEW_FOV_Y / 2));
    return [height * VIEW_ASPECT, height];
}

/** Clears a head-up pane and sets it up to be drawn in VIEW_LOGICAL pixels. */
function beginLogicalFrame({ ctx, canvas }) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / VIEW_LOGICAL[0];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function drawShadowedText(ctx, text, x, y, color) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function shipTitle(t, ship) {
    return ship.callsign ?? t(ship.nameKey);
}

/**
 * How a line of the score feed looks `age` seconds after it appeared: [opacity, rise (px),
 * scale]. The flat HUD's `eod-score-pop` animation (ui/hud.css): pops in from just below,
 * settles, holds, then drifts up and fades. While it holds nothing changes, so the pane is
 * not uploaded again.
 */
function scorePop(age) {
    const progress = age / SCORE_POPUP_SECONDS;
    if (progress < 0.05) {
        const arriving = progress / 0.05;
        return [arriving, 8 * (1 - arriving), 0.9 + 0.18 * arriving];
    }
    if (progress < 0.1) return [1, 0, 1.08 - 0.08 * ((progress - 0.05) / 0.05)];
    if (progress < 0.79) return [1, 0, 1];
    const leaving = Math.min(1, (progress - 0.79) / 0.21);
    return [1 - leaving, -14 * leaving, 1];
}

/**
 * The score feed: the running total, and under it a line for each recent kill.
 * @param {{ popups: { points: number, classId: string, at: number }[], total: { value: number, at: number } | null }} feed
 * @param {number} lowest no line may reach below this (the comms box or the hint is there)
 */
function drawScoreFeed(ctx, feed, t, now, lowest) {
    if (feed.popups.length === 0 || !feed.total) return;
    const left = VIEW_LOGICAL[0] / 2 + SCORE_FEED_OFFSET;
    const middle = VIEW_LOGICAL[1] / 2;
    const rows = Math.max(1, Math.min(MAX_SCORE_POPUPS, Math.floor((lowest - middle) / SCORE_ROW_HEIGHT) + 1));
    const line = (age, y, draw) => {
        const [opacity, rise, scale] = scorePop(age);
        ctx.save();
        ctx.translate(left, y + rise);
        ctx.scale(scale, scale);
        ctx.globalAlpha = opacity;
        draw();
        ctx.restore();
    };
    ctx.textAlign = 'left';
    line(now - feed.total.at, middle - SCORE_ROW_HEIGHT, () => {
        ctx.font = `600 10px ${FONT}`;
        drawShadowedText(ctx, `${t('hud.score').toUpperCase()} ${feed.total.value.toLocaleString()}`, 0, 0, 'rgba(215, 238, 255, 0.8)');
    });
    feed.popups.slice(-rows).forEach((popup, index) => line(now - popup.at, middle + index * SCORE_ROW_HEIGHT, () => {
        const points = `+${popup.points}`;
        ctx.font = `800 20px ${FONT}`;
        drawShadowedText(ctx, points, 0, 0, '#ffb648');
        const pointsWidth = ctx.measureText(points).width;
        ctx.font = `600 11px ${FONT}`;
        drawShadowedText(ctx, t(`ship.${popup.classId}`).toUpperCase(), pointsWidth + 7, 0, 'rgba(235, 245, 255, 0.9)');
    }));
}

const TUTORIAL_CARD_WIDTH = 460;
const TUTORIAL_CARD_TOP = 84;
const TUTORIAL_AMBER = '#ffb648';

/**
 * The first-flight tutorial's card (state/Tutorial.js), as ui/TutorialOverlay.jsx shows it on
 * the page: what the step is about, the control to use, named for the VR controllers, and how
 * to go on. The game stands still behind it. A step just done leaves a green tick for a moment.
 * No pointing in here: an info card goes on with A, and the tutorial is switched off in the
 * pause menu.
 */
export function drawTutorialCard(ctx, tutorial, t) {
    const centre = VIEW_LOGICAL[0] / 2;
    const title = t(`tutorial.${tutorial.id}.title`);
    ctx.textBaseline = 'alphabetic';
    if (tutorial.state !== TUTORIAL_STATE.ASK) {
        const label = `✓ ${title} · ${t('tutorial.done')}`;
        ctx.font = `700 14px ${FONT}`;
        const width = ctx.measureText(label).width + 28;
        roundRect(ctx, centre - width / 2, 132, width, 28, 4);
        ctx.fillStyle = 'rgba(125, 255, 168, 0.92)';
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#04160b';
        ctx.fillText(label, centre, 151);
        return;
    }
    const { platform } = tutorial;
    const left = centre - TUTORIAL_CARD_WIDTH / 2;
    const inner = TUTORIAL_CARD_WIDTH - 36;
    ctx.font = `400 14px ${FONT}`;
    const lines = wrapText(ctx, tutorialText(t, `tutorial.${tutorial.id}.text`, platform, tutorialParams(t, tutorial)) ?? '', inner);
    const keys = tutorialKeys(t, tutorial.id, platform).join('  /  ');
    const height = 64 + lines.length * 20 + (keys ? 30 : 0) + (tutorial.needsTarget ? 20 : 0) + 42;
    const top = TUTORIAL_CARD_TOP;

    roundRect(ctx, left, top, TUTORIAL_CARD_WIDTH, height, 8);
    ctx.fillStyle = 'rgba(5, 15, 27, 0.93)';
    ctx.fill();
    ctx.strokeStyle = TUTORIAL_AMBER;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    let y = top + 22;
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = TUTORIAL_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText(`❚❚ ${t('tutorial.header')}`, left + 18, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${tutorial.index} / ${tutorial.total}`, left + TUTORIAL_CARD_WIDTH - 18, y);
    y += 28;
    ctx.textAlign = 'left';
    ctx.font = `700 19px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, left + 18, y);
    y += 6;
    ctx.font = `400 14px ${FONT}`;
    ctx.fillStyle = '#e6f3ff';
    for (const line of lines) {
        y += 20;
        ctx.fillText(line, left + 18, y);
    }
    if (keys) {
        y += 30;
        ctx.font = `700 16px ${FONT}`;
        ctx.fillStyle = TUTORIAL_AMBER;
        ctx.fillText(`▶  ${keys}`, left + 18, y);
    }
    if (tutorial.needsTarget) {
        y += 20;
        const locked = tutorial.hasTarget;
        ctx.font = `700 12px ${FONT}`;
        ctx.fillStyle = locked ? '#7dffa8' : TUTORIAL_AMBER;
        ctx.fillText(locked ? t('tutorial.targetLocked') : tutorialText(t, 'tutorial.needTarget', platform), left + 18, y);
    }
    ctx.textAlign = 'center';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(215, 238, 255, 0.85)';
    ctx.fillText(tutorial.kind === 'info' ? tutorialText(t, 'tutorial.nextHint', platform) : t('tutorial.waiting'), centre, top + height - 28);
    ctx.font = `400 10px ${FONT}`;
    ctx.fillStyle = 'rgba(200, 225, 240, 0.55)';
    ctx.fillText(t('tutorial.skipHint.vr'), centre, top + height - 12);
}

/** Text overlays on the head-up pane (logical pixels). `scoreFeed`: see drawScoreFeed. */
function drawPaneText(ctx, state, t, now, scoreFeed) {
    const [width, height] = VIEW_LOGICAL;
    const centre = width / 2;
    ctx.textBaseline = 'alphabetic';

    // Top: chapter title card, else the objective.
    if (state.titleCard) {
        ctx.textAlign = 'center';
        ctx.font = `700 30px ${FONT}`;
        drawShadowedText(ctx, t(`chapter.${state.titleCard.chapterId}.title`), centre, 92, '#e8f6ff');
        ctx.font = `400 15px ${FONT}`;
        drawShadowedText(ctx, t(`chapter.${state.titleCard.chapterId}.subtitle`), centre, 118, 'rgba(200, 225, 245, 0.9)');
    } else if (state.objective || state.progress) {
        ctx.textAlign = 'center';
        if (state.objective) {
            ctx.font = `600 10px ${FONT}`;
            drawShadowedText(ctx, t('hud.objective').toUpperCase(), centre, 34, 'rgba(160, 215, 255, 0.75)');
            ctx.font = `500 14px ${FONT}`;
            wrapText(ctx, t(state.objective.key, state.objective.params ?? undefined), 360).slice(0, 2).forEach((line, index) => {
                drawShadowedText(ctx, line, centre, 52 + index * 18, '#ffd36b');
            });
        }
        if (state.progress) {
            const y = state.objective ? 86 : 40;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(centre - 90, y, 180, 5);
            ctx.fillStyle = '#59d0ff';
            ctx.fillRect(centre - 90, y, 180 * Math.max(0, Math.min(1, state.progress.value)), 5);
        }
    }

    // Boss and escort bars, under the objective.
    let barY = 112;
    for (const [ship, tone] of [[state.boss, '#ff4b6e'], [state.escort, '#9dffb0']]) {
        if (!ship) continue;
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${FONT}`;
        drawShadowedText(ctx, shipTitle(t, ship), centre, barY, tone);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(centre - 110, barY + 5, 220, 4);
        if (ship.hasShield) {
            ctx.fillStyle = '#59d0ff';
            ctx.fillRect(centre - 110, barY + 5, 220 * ship.shield, 2);
        }
        ctx.fillStyle = ship.invulnerable ? '#c04dff' : tone;
        ctx.fillRect(centre - 110, barY + 7, 220 * ship.hull, 2);
        barY += 26;
    }

    // Alerts, just above the reticle.
    const hud = state.hud;
    if (hud?.alive) {
        const alerts = [];
        if (hud.outOfBounds) alerts.push('hud.outOfBounds');
        if (hud.cannonLock === 2) alerts.push('hud.cannonLocked');
        else if (hud.cannonLock === 1) alerts.push('hud.cannonTracking');
        if (state.escort && state.escort.hull < 0.3) alerts.push('hud.escortCritical');
        if (hud.hull < 0.3) alerts.push('hud.hullCritical');
        else if (hud.shield <= 0.01 && hud.shieldDown <= 0) alerts.push('hud.shieldsDown');
        const lines = alerts.map((key) => t(key));
        // A breach blast has the shield down: how long until it can come back.
        if (hud.shieldDown > 0) lines.unshift(t('hud.shieldsBreached', { seconds: hud.shieldDown }));
        const blink = Math.floor(now * 2.5) % 2 === 0 ? 1 : 0.55;
        ctx.textAlign = 'center';
        ctx.font = `700 12px ${FONT}`;
        ctx.globalAlpha = blink;
        lines.slice(0, 2).forEach((line, index) => drawShadowedText(ctx, line.toUpperCase(), centre, height / 2 - 70 - index * 17, '#ff6b6b'));
        ctx.globalAlpha = 1;
        // Not a warning: the cloak is on (steady, under the warnings' place).
        if (hud.cloaked) drawShadowedText(ctx, t('hud.cloaked').toUpperCase(), centre, height / 2 - 53, '#59d0ff');
    }

    // Multiplayer: side, planet and jump drive on one line under the alerts' place, and the collapse as an alert.
    // Shot down and watching a comrade fly: their planet, and their drive (or docking) - the line above it says whom.
    const you = state.match?.you;
    let toastY = height / 2 + 74;
    if (you) {
        const watched = watchedPilot(state.match);
        const pilot = watched ?? you;
        const here = state.match.planets.find((planet) => planet.id === pilot.planet);
        const drive = watched?.dock ? t('mp.watch.docking', { name: watched.name, seconds: Math.ceil(watched.dock.left) })
            : `${t('mp.hud.jump')}: ${jumpStatusText(t, pilot.jump, pilot.equipment)}`;
        const place = here ? `${t(`mp.planet.${here.id}`)} · ${t(`mp.hud.status.${here.status}`)}${here.changesIn !== null ? ` ${here.changesIn}s` : ''}` : '';
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${FONT}`;
        const line = [watched ? null : t(`mp.faction.${you.faction}`), place, drive].filter(Boolean).join(' · ');
        drawShadowedText(ctx, line, centre, height / 2 + 56, watched?.dock ? '#59d0ff' : '#cfe8ff');
        // Something to do or spend: say so, and where (the flat HUD has buttons for it; here it is in the map menu).
        // The station's dock comes before everything else: it is why the pilot flew here.
        if (you.alive && you.dock?.left != null) {
            drawShadowedText(ctx, `${t('mp.dock.progress', { seconds: Math.ceil(you.dock.left) })} · ${t('mp.vr.undockHint')}`, centre, height / 2 + 40, '#ffb648');
        } else if (you.alive && you.dock?.ready) {
            drawShadowedText(ctx, `${t('mp.dock.prompt', { seconds: you.dock.seconds })} · ${t('mp.vr.dockHint')}`, centre, height / 2 + 40, '#ffb648');
        } else if (you.alive && (you.points > 0 || you.summons > 0 || you.picks > 0)) {
            const gear = you.picks > 0 ? ` · ${t('mp.vr.gear')} ${you.picks}` : '';
            drawShadowedText(ctx, `${t('mp.vr.spend', { points: you.points, summons: you.summons })}${gear} · ${t('mp.vr.mapHint')}`, centre, height / 2 + 40, '#ffb648');
        }
        // What is on: under the reticle - or, watching a comrade (whose name has that place), under the line about them.
        const effects = Object.entries(pilot.effects).filter(([, seconds]) => seconds > 0);
        if (effects.length > 0) {
            drawShadowedText(ctx, effects.map(([item, seconds]) => t(`mp.equipment.effect.${item}`, { seconds })).join(' · '), centre, height / 2 + (watched ? 71 : 26), '#7dffa8');
            if (watched) toastY += 16;
        }
        const warnings = [];
        // (Holding the planet's station is no shelter: the collapse is everybody's.)
        if ((you.alive || watched) && here) {
            if (here.status === 'collapsing') warnings.push(t('mp.alert.collapsing', { seconds: here.changesIn ?? 0 }));
            if (here.status === 'swallowed') warnings.push(t('mp.alert.swallowed'));
        }
        if (you.loyalty === 'warned') warnings.push(t('mp.alert.warned'));
        if (!you.alive && !you.respawn) warnings.push(t('mp.hud.dead'));
        ctx.font = `700 12px ${FONT}`;
        warnings.slice(0, 2).forEach((text, index) => drawShadowedText(ctx, text, centre, height / 2 - 104 - index * 17, '#ffb648'));

        // The comrades, always (top left, clear of the objective and the alerts).
        drawTeam(ctx, state.match, t);
        // Watching somebody fly with the menu put away: whom (and their ship), how the comeback stands, and B for the menu.
        if (!you.alive && you.watching && state.matchWatchView) {
            const player = state.match.players.find((entry) => entry.id === you.watching);
            const name = player ? `${player.name} · ${t(`ship.${player.classId}`)}` : '';
            const comeback = you.out ? t('mp.out.title')
                : you.respawn?.wait > 0 ? t('mp.respawn.waiting', { seconds: you.respawn.wait })
                    : you.respawn?.stations.length ? t('mp.respawn.choose', { seconds: you.respawn.choose ?? 0 }) : t('mp.respawn.noStation');
            ctx.textAlign = 'center';
            ctx.font = `700 13px ${FONT}`;
            drawShadowedText(ctx, `${t('mp.watch.label')}  ${name}`, centre, height / 2 + 26, '#59d0ff');
            ctx.font = `600 11px ${FONT}`;
            drawShadowedText(ctx, `${comeback} · ${t('mp.vr.watchMenuHint')}`, centre, height / 2 + 41, '#ffb648');
        }
    }

    if (state.toast) {
        ctx.textAlign = 'center';
        ctx.font = `600 13px ${FONT}`;
        const label = state.toast.checkpointId ? `${t(state.toast.key)} · ${t(`checkpoint.${state.toast.checkpointId}`)}` : t(state.toast.key, state.toast.params ?? undefined);
        drawShadowedText(ctx, label, centre, toastY, '#9dffb0');
    }

    // Bottom: the hint, then the comms line in a box.
    let bottom = PANE_TEXT_BOTTOM;
    const comms = state.comms;
    if (comms) {
        const character = CHARACTERS[comms.speakerId] ?? CHARACTERS.vega;
        const text = t(comms.textKey);
        if (vrComms.lineId !== comms.id) {
            vrComms.lineId = comms.id;
            vrComms.startedAt = now;
            vrComms.revealed = false;
        }
        const shown = vrComms.revealed ? text.length : Math.ceil((now - vrComms.startedAt) * TYPE_SPEED);
        vrComms.typing = shown < text.length;
        ctx.font = `400 15px ${FONT}`;
        const lines = wrapText(ctx, text, 470);
        const boxHeight = 44 + lines.length * 20;
        const boxTop = bottom - boxHeight;
        roundRect(ctx, centre - 255, boxTop, 510, boxHeight, 8);
        ctx.fillStyle = 'rgba(4, 14, 26, 0.72)';
        ctx.fill();
        ctx.strokeStyle = character.color;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        ctx.font = `700 12px ${FONT}`;
        ctx.fillStyle = character.color;
        const speaker = t(`speaker.${character.id}`);
        ctx.fillText(speaker, centre - 240, boxTop + 20);
        const speakerWidth = ctx.measureText(speaker).width;
        ctx.font = `400 10px ${FONT}`;
        ctx.fillStyle = 'rgba(190, 215, 235, 0.75)';
        ctx.fillText(t(`speaker.${character.id}.role`), centre - 240 + speakerWidth + 12, boxTop + 20);
        ctx.textAlign = 'right';
        ctx.fillText(t('hud.skip.vr'), centre + 240, boxTop + 20);
        ctx.textAlign = 'left';
        ctx.font = `400 15px ${FONT}`;
        ctx.fillStyle = '#e8f6ff';
        let remaining = shown;
        lines.forEach((line, index) => {
            if (remaining <= 0) return;
            ctx.fillText(line.slice(0, remaining), centre - 240, boxTop + 42 + index * 20);
            remaining -= line.length;
        });
        bottom = boxTop - 10;
    } else {
        vrComms.lineId = null;
        vrComms.typing = false;
    }
    if (state.hint) {
        const vrHint = `${state.hint}.vr`;
        const hintText = t(vrHint) !== vrHint ? t(vrHint) : t(state.hint);
        ctx.textAlign = 'center';
        ctx.font = `500 13px ${FONT}`;
        const lines = wrapText(ctx, hintText, 460).slice(0, 2);
        lines.reverse().forEach((line, index) => {
            drawShadowedText(ctx, line, centre, bottom - index * 18, 'rgba(255, 230, 160, 0.95)');
        });
        bottom -= lines.length * 18;
    }

    // Beside the reticle: the points for the latest kills, kept clear of whatever is below.
    drawScoreFeed(ctx, scoreFeed, t, now, bottom - 8);

    // Over everything else: the tutorial's card, while one is up.
    if (state.tutorial) drawTutorialCard(ctx, { ...state.tutorial, hasTarget: Boolean(state.target) }, t);
}

/** VR: the comrades in a column at the top left of the head-up pane - name, then where or how long until they are back. */
function drawTeam(ctx, match, t) {
    const { you } = match;
    const team = you.team.slice(0, 4);
    if (team.length === 0) return;
    const x = 26;
    let y = 150;
    ctx.textAlign = 'left';
    ctx.font = `600 10px ${FONT}`;
    drawShadowedText(ctx, t('mp.team.title').toUpperCase(), x, y, 'rgba(160, 215, 255, 0.75)');
    for (const mate of team) {
        y += 12;
        const status = mate.alive ? (mate.docking ? t('mp.team.docking') : mate.planet ? t(`mp.planet.${mate.planet}`) : '')
            : you.out || mate.wait === null ? t('mp.team.out')
                : mate.wait > 0 ? t('mp.team.waiting', { seconds: mate.wait }) : t('mp.team.ready');
        const name = mate.name.length > 12 ? `${mate.name.slice(0, 11)}…` : mate.name;
        ctx.font = `700 11px ${FONT}`;
        drawShadowedText(ctx, `${you.watching === mate.id ? '◉ ' : ''}${name}`, x, y + 11, mate.alive ? '#e8f6ff' : 'rgba(200, 215, 230, 0.55)');
        ctx.font = `500 10px ${FONT}`;
        drawShadowedText(ctx, status, x, y + 23, mate.alive ? 'rgba(190, 225, 255, 0.8)' : 'rgba(255, 180, 120, 0.75)');
        if (mate.alive) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(x, y + 27, 90, 4);
            ctx.fillStyle = '#59d0ff';
            ctx.fillRect(x, y + 27, 90 * mate.shield / 100, 2);
            ctx.fillStyle = '#ff9a5c';
            ctx.fillRect(x, y + 29, 90 * mate.hull / 100, 2);
        }
        y += 24;
    }
}

const RADAR_SIZE = 300;
let radarCanvasCache = null;
function radarCanvas() {
    if (!radarCanvasCache) {
        radarCanvasCache = document.createElement('canvas');
        radarCanvasCache.width = RADAR_SIZE;
        radarCanvasCache.height = RADAR_SIZE;
    }
    return radarCanvasCache;
}

/**
 * Scrambles what is on the panel, as a display does when its signal is knocked: bands of the
 * picture slide sideways, a faint copy of it ghosts beside itself, lines drop out and static
 * streaks across. `strength` 0..1.
 */
function scramblePanel({ ctx, canvas }, strength) {
    const { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let band = 0; band < 3 + strength * 6; band++) {
        const y = Math.random() * height;
        const tall = 6 + Math.random() * 46 * strength;
        ctx.drawImage(canvas, 0, y, width, tall, (Math.random() - 0.5) * 110 * strength, y, width, tall);
    }
    ctx.globalAlpha = 0.3 * strength;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(canvas, (Math.random() - 0.5) * 36 * strength, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(2, 8, 16, 0.85)';
    for (let line = 0; line < strength * 5; line++) ctx.fillRect(0, Math.random() * height, width, 3 + Math.random() * 12);
    ctx.fillStyle = 'rgba(200, 235, 255, 0.4)';
    for (let streak = 0; streak < strength * 14; streak++) ctx.fillRect(Math.random() * width, Math.random() * height, 20 + Math.random() * 140, 2);
}

/** The room between the panel's left and right columns, for the name of the pilot being watched (px of the panel's texture). */
const WATCH_TAG_WIDTH = 350;

/** "Watching · Vega · Kestrel" centred at (x, y) on the instrument panel, cut to fit between its columns. */
function drawWatchTag(ctx, state, t, x, y) {
    const player = state.match?.players.find((entry) => entry.id === state.hud.watching);
    if (!player) return;
    ctx.textAlign = 'center';
    ctx.font = `700 21px ${FONT}`;
    ctx.fillStyle = '#59d0ff';
    ctx.fillText(wrapText(ctx, `${t('mp.watch.label')} · ${player.name} · ${t(`ship.${player.classId}`)}`, WATCH_TAG_WIDTH)[0], x, y);
    ctx.textAlign = 'left';
}

/** The colour of an ability's state on the panel: ready, running (or a warhead waiting for the button), recharging. */
const ABILITY_TONES = Object.freeze({ ready: '#7dffa8', active: '#ffb648', armed: '#ffb648', cooldown: 'rgba(200, 215, 230, 0.6)' });

function drawPanel(panel, session, state, t, glitch = 0) {
    const { ctx, canvas } = panel;
    const { width, height } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const hud = state.hud;
    if (!hud || session.phase !== PHASE.PLAYING) {
        panel.commit();
        return;
    }
    roundRect(ctx, 6, 6, width - 12, height - 12, 26);
    ctx.fillStyle = 'rgba(4, 14, 26, 0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(89, 208, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Left: the ship's own gauges.
    ctx.font = `600 22px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    drawMeter(ctx, 36, 62, 290, t('hud.shields'), hud.shield, '#59d0ff', hud.shield <= 0.01);
    drawMeter(ctx, 36, 138, 290, t('hud.hull'), hud.hull, '#ff9a5c', hud.hull < 0.3);
    drawMeter(ctx, 36, 214, 290, t('hud.energy'), hud.energy, '#ffd36b', hud.beamDepleted);
    drawMeter(ctx, 36, 290, 290, t('hud.boost'), hud.boost, hud.boosting ? '#ffffff' : '#b28cff');

    // Watching a comrade fly: whose instruments these are, along the top edge over the radar.
    if (hud.watching) drawWatchTag(ctx, state, t, width / 2, 33);

    // Middle: radar (drawn on its own canvas first: drawRadar clears the square it draws in).
    const radar = radarCanvas();
    drawRadar(radar.getContext('2d'), session, RADAR_SIZE);
    ctx.drawImage(radar, (width - RADAR_SIZE) / 2, (height - RADAR_SIZE) / 2);

    // Right: speed, torpedoes, power mode, target.
    const right = 700;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`${t('hud.speed')}  ${hud.speed} m/s`, right, 52);
    ctx.fillText(`${t('hud.throttle')}  ${percentText(hud.throttle)}`, right, 80);
    ctx.fillText(t('hud.torpedoes'), right, 116);
    for (let index = 0; index < hud.torpedoCapacity; index++) {
        ctx.fillStyle = index < hud.torpedoes ? '#b6ff3d' : 'rgba(182, 255, 61, 0.18)';
        ctx.fillRect(right + 120 + index * 26, 100, 18, 18);
    }
    ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
    ctx.fillText(`${t('hud.power')}  `, right, 150);
    ctx.fillStyle = '#ffd36b';
    ctx.fillText(t(`hud.power.${hud.powerMode}`), right + ctx.measureText(`${t('hud.power')}  `).width, 150);
    // The ship's ability (Y): its name, then ready / seconds of effect left / seconds to wait.
    if (hud.ability) {
        const name = `${t(`ability.${hud.ability.id}.name`)}  `;
        ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
        ctx.fillText(name, right, 182);
        ctx.fillStyle = ABILITY_TONES[hud.ability.state];
        ctx.fillText(abilityStateText(t, hud.ability), right + ctx.measureText(name).width, 182);
    } else if (hud.passive) {
        // A passive one has nothing to wait for: its name, and that it is one.
        const name = `${t(`ability.${hud.passive}.name`)}  `;
        ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
        ctx.fillText(name, right, 182);
        ctx.fillStyle = ABILITY_TONES.cooldown;
        ctx.fillText(t('hud.ability.passive'), right + ctx.measureText(name).width, 182);
    }

    const target = state.target;
    ctx.fillStyle = 'rgba(160, 215, 255, 0.7)';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(t('hud.target').toUpperCase(), right, 214);
    if (target) {
        const tone = target.faction === 'umbra' ? '#ff4b6e' : '#59d0ff';
        ctx.font = `700 24px ${FONT}`;
        ctx.fillStyle = tone;
        ctx.fillText(wrapText(ctx, shipTitle(t, target), 290)[0], right, 246);
        ctx.font = `600 18px ${FONT}`;
        ctx.fillStyle = 'rgba(220, 235, 250, 0.9)';
        ctx.fillText(`${target.distance} m`, right, 274);
        if (target.hasShield) drawMeter(ctx, right, 300, 280, t('hud.shields'), target.shield, '#59d0ff');
        ctx.font = `600 18px ${FONT}`;
        drawMeter(ctx, right, target.hasShield ? 344 : 300, 280, t('hud.hull'), target.hull, target.invulnerable ? '#c04dff' : '#ff4b6e');
    } else {
        ctx.font = `600 22px ${FONT}`;
        ctx.fillStyle = 'rgba(200, 215, 230, 0.6)';
        ctx.fillText(t('hud.noTarget'), right, 246);
    }
    if (glitch > 0.02) scramblePanel(panel, glitch);
    panel.commit();
}

const VEIL_FLASH_SECONDS = 1.4;

export default function VRHud({ game, seatRef }) {
    const { session, input } = game;
    const gl = useThree((three) => three.gl);
    const markerPane = useMemo(() => createCanvasPanel({ gl, width: MARKER_TEXTURE[0], height: MARKER_TEXTURE[1], meters: paneSize(), renderOrder: 1001 }), [gl]);
    const textPane = useMemo(() => createCanvasPanel({ gl, width: TEXT_TEXTURE[0], height: TEXT_TEXTURE[1], meters: paneSize(), renderOrder: 1001.5, uploadOnlyChanges: true }), [gl]);
    const panel = useMemo(() => createCanvasPanel({ gl, width: PANEL_TEXTURE[0], height: PANEL_TEXTURE[1], meters: PANEL_METERS, renderOrder: 1002 }), [gl]);
    const virtualCamera = useMemo(() => {
        const camera = new THREE.PerspectiveCamera(VIEW_FOV_Y, VIEW_ASPECT, 0.1, 3_000_000);
        camera.matrixAutoUpdate = false;
        return camera;
    }, []);
    const veil = useMemo(() => {
        const material = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), material);
        mesh.renderOrder = 1000;
        mesh.frustumCulled = false;
        mesh.visible = false;
        return mesh;
    }, []);
    const state = useRef({ panelTimer: 0, textTimer: 0, flash: 0, time: 0, glitch: 0, scoreFeed: { popups: [], total: null } });

    useEffect(() => () => {
        markerPane.dispose();
        textPane.dispose();
        panel.dispose();
        veil.geometry.dispose();
        veil.material.dispose();
    }, [markerPane, textPane, panel, veil]);

    useEffect(() => session.events.on(SESSION_EVENTS.WARP, ({ stage }) => {
        if (stage === 'arrive') state.current.flash = VEIL_FLASH_SECONDS;
    }), [session]);

    // Each kill's points join the score feed, timed on this HUD's own clock.
    useEffect(() => session.events.on(SESSION_EVENTS.SCORE, ({ points, classId, total }) => {
        const { scoreFeed, time } = state.current;
        scoreFeed.popups = [...scoreFeed.popups, { points, classId, at: time }].slice(-MAX_SCORE_POPUPS);
        scoreFeed.total = { value: total, at: time };
    }), [session]);

    useEffect(() => session.world.events.on(GAME_EVENTS.HIT, (hit) => {
        if (!isHullHitOnPlayer(session.world, hit)) return;
        state.current.glitch = Math.min(1, state.current.glitch + GLITCH_PER_HIT + hit.amount * GLITCH_PER_DAMAGE);
    }), [session]);

    useFrame((_, delta) => {
        const seat = seatRef.current;
        if (!seat) return;
        const local = state.current;
        local.time += delta;
        const store = useGameStore.getState();
        const t = (key, params) => translate(store.settings.locale, key, params);
        const flying = session.phase === PHASE.PLAYING && !store.refit;
        const { scoreFeed } = local;
        if (scoreFeed.popups.length > 0) scoreFeed.popups = scoreFeed.popups.filter((popup) => local.time - popup.at < SCORE_POPUP_SECONDS);

        // Head-up panes. Hidden when not flying, so nothing needs clearing then - nor while a
        // match's ending plays: it has the view to itself (as on the flat page, ui/GameHud.jsx).
        const headUp = flying && !store.matchOutro;
        markerPane.mesh.visible = headUp;
        textPane.mesh.visible = headUp;
        local.textTimer -= delta;
        if (headUp) {
            virtualCamera.matrixWorld.copy(seat.matrixWorld);
            virtualCamera.matrixWorldInverse.copy(seat.matrixWorld).invert();
            beginLogicalFrame(markerPane);
            drawMarkers(markerPane.ctx, session, virtualCamera, VIEW_LOGICAL[0], VIEW_LOGICAL[1], input.controls);
            markerPane.commit();
            if (local.textTimer <= 0) {
                local.textTimer = 1 / TEXT_RATE;
                beginLogicalFrame(textPane);
                drawPaneText(textPane.ctx, store, t, local.time, scoreFeed);
                textPane.commit();
            }
        } else {
            // Redraw the text as soon as flying resumes.
            local.textTimer = 0;
        }

        // Instrument panel: it rides with the cabin, and is redrawn every frame while scrambled.
        local.panelTimer -= delta;
        local.glitch = Math.max(0, local.glitch - GLITCH_DECAY * delta);
        if (local.panelTimer <= 0 || local.glitch > 0.02) {
            local.panelTimer = PANEL_INTERVAL;
            drawPanel(panel, session, store, t, local.glitch);
        }
        panel.mesh.visible = flying && Boolean(store.hud?.alive);
        panel.mesh.position.fromArray(PANEL_POSITION).multiplyScalar(CABIN_SCALE).add(playerFeedback.cabinShake);

        // Veil: black for the docking fade, white for a moment after a warp arrival.
        local.flash = Math.max(0, local.flash - delta);
        const fade = session.world.screenFade ?? 0;
        const white = (local.flash / VEIL_FLASH_SECONDS) ** 2;
        if (white > fade) {
            veil.material.color.setRGB(1, 1, 1);
            veil.material.opacity = white;
        } else {
            veil.material.color.setRGB(0, 0, 0);
            veil.material.opacity = fade;
        }
        veil.visible = veil.material.opacity > 0.003;
    });

    return (
        <>
            <primitive object={veil} />
            <primitive object={markerPane.mesh} position={[0, 0, -VIEW_DISTANCE]} />
            <primitive object={textPane.mesh} position={[0, 0, -VIEW_DISTANCE]} />
            <primitive object={panel.mesh} position={PANEL_POSITION.map((v) => v * CABIN_SCALE)} rotation={[PANEL_TILT, 0, 0]} scale={CABIN_SCALE} />
        </>
    );
}
