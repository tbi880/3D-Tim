import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHARACTERS } from '../config/characters.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { translate } from '../i18n/index.js';
import { isHullHitOnPlayer, playerFeedback } from '../scene/effects/playerFeedback.js';
import { PHASE, SESSION_EVENTS } from '../state/GameSession.js';
import { useGameStore } from '../state/gameStore.js';
import { drawMarkers, drawRadar } from '../ui/markerRenderer.js';
import { CABIN_SCALE } from './VRCockpitShell.jsx';
import { createCanvasPanel, drawMeter, roundRect, wrapText } from './canvasPanel.js';
import layout from './cockpitLayout.json';

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
 *      - text: objective, alerts, title cards and the comms line. Text is what shows a soft
 *        texture first, so this pane has the headset's own angular resolution; it only changes
 *        slowly, so it is redrawn TEXT_RATE times a second, and uploaded to the GPU (1.8
 *        million pixels) only when the redrawn picture differs from the last one.
 *  - Instrument panel below the line of sight: shields, hull, beam energy, afterburner,
 *    radar, speed, torpedoes, power mode and the current target. Redrawn ten times a second.
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

/** Text overlays on the head-up pane (logical pixels). */
function drawPaneText(ctx, state, t, now) {
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
        else if (hud.shield <= 0.01) alerts.push('hud.shieldsDown');
        const blink = Math.floor(now * 2.5) % 2 === 0 ? 1 : 0.55;
        ctx.textAlign = 'center';
        ctx.font = `700 12px ${FONT}`;
        ctx.globalAlpha = blink;
        alerts.slice(0, 2).forEach((key, index) => drawShadowedText(ctx, t(key).toUpperCase(), centre, height / 2 - 70 - index * 17, '#ff6b6b'));
        ctx.globalAlpha = 1;
    }

    // Multiplayer: side, planet and jump drive on one line under the alerts' place, and the collapse as an alert.
    const you = state.match?.you;
    if (you) {
        const here = state.match.planets.find((planet) => planet.id === you.planet);
        const jump = you.jump.to ? t('mp.hud.jumpSpooling', { planet: t(`mp.planet.${you.jump.to}`) })
            : you.jump.trapped ? t('mp.hud.jumpTrapped')
                : you.jump.cooldown > 0 ? t('mp.hud.jumpCharging', { seconds: you.jump.cooldown }) : t('mp.hud.jumpReady');
        const place = here ? `${t(`mp.planet.${here.id}`)} · ${t(`mp.hud.status.${here.status}`)}${here.changesIn !== null ? ` ${here.changesIn}s` : ''}` : '';
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${FONT}`;
        drawShadowedText(ctx, `${t(`mp.faction.${you.faction}`)} · ${place} · ${t('mp.hud.jump')}: ${jump}`, centre, height / 2 + 56, '#cfe8ff');
        const warnings = [];
        if (you.alive && here && here.owner !== you.faction) {
            if (here.status === 'collapsing') warnings.push(t('mp.alert.collapsing', { seconds: here.changesIn ?? 0 }));
            if (here.status === 'swallowed') warnings.push(t('mp.alert.swallowed'));
        }
        if (you.loyalty === 'warned') warnings.push(t('mp.alert.warned'));
        if (!you.alive) warnings.push(t('mp.hud.dead'));
        ctx.font = `700 12px ${FONT}`;
        warnings.slice(0, 2).forEach((text, index) => drawShadowedText(ctx, text, centre, height / 2 - 104 - index * 17, '#ffb648'));
    }

    if (state.toast) {
        ctx.textAlign = 'center';
        ctx.font = `600 13px ${FONT}`;
        const label = state.toast.checkpointId ? `${t(state.toast.key)} · ${t(`checkpoint.${state.toast.checkpointId}`)}` : t(state.toast.key, state.toast.params ?? undefined);
        drawShadowedText(ctx, label, centre, height / 2 + 74, '#9dffb0');
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
        wrapText(ctx, hintText, 460).slice(0, 2).reverse().forEach((line, index) => {
            drawShadowedText(ctx, line, centre, bottom - index * 18, 'rgba(255, 230, 160, 0.95)');
        });
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

    // Middle: radar (drawn on its own canvas first: drawRadar clears the square it draws in).
    const radar = radarCanvas();
    drawRadar(radar.getContext('2d'), session, RADAR_SIZE);
    ctx.drawImage(radar, (width - RADAR_SIZE) / 2, (height - RADAR_SIZE) / 2);

    // Right: speed, torpedoes, power mode, target.
    const right = 700;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`${t('hud.speed')}  ${hud.speed} m/s`, right, 56);
    ctx.fillText(`${t('hud.throttle')}  ${percentText(hud.throttle)}`, right, 86);
    ctx.fillText(t('hud.torpedoes'), right, 126);
    for (let index = 0; index < hud.torpedoCapacity; index++) {
        ctx.fillStyle = index < hud.torpedoes ? '#b6ff3d' : 'rgba(182, 255, 61, 0.18)';
        ctx.fillRect(right + 120 + index * 26, 110, 18, 18);
    }
    ctx.fillStyle = 'rgba(190, 225, 255, 0.85)';
    ctx.fillText(`${t('hud.power')}  `, right, 164);
    ctx.fillStyle = '#ffd36b';
    ctx.fillText(t(`hud.power.${hud.powerMode}`), right + ctx.measureText(`${t('hud.power')}  `).width, 164);

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
    const markerPane = useMemo(() => createCanvasPanel({ width: MARKER_TEXTURE[0], height: MARKER_TEXTURE[1], meters: paneSize(), renderOrder: 1001 }), []);
    const textPane = useMemo(() => createCanvasPanel({ width: TEXT_TEXTURE[0], height: TEXT_TEXTURE[1], meters: paneSize(), renderOrder: 1001.5, uploadOnlyChanges: true }), []);
    const panel = useMemo(() => createCanvasPanel({ width: PANEL_TEXTURE[0], height: PANEL_TEXTURE[1], meters: PANEL_METERS, renderOrder: 1002 }), []);
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
    const state = useRef({ panelTimer: 0, textTimer: 0, flash: 0, time: 0, glitch: 0 });

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

        // Head-up panes. Hidden when not flying, so nothing needs clearing then.
        markerPane.mesh.visible = flying;
        textPane.mesh.visible = flying;
        local.textTimer -= delta;
        if (flying) {
            virtualCamera.matrixWorld.copy(seat.matrixWorld);
            virtualCamera.matrixWorldInverse.copy(seat.matrixWorld).invert();
            beginLogicalFrame(markerPane);
            drawMarkers(markerPane.ctx, session, virtualCamera, VIEW_LOGICAL[0], VIEW_LOGICAL[1], input.controls);
            markerPane.commit();
            if (local.textTimer <= 0) {
                local.textTimer = 1 / TEXT_RATE;
                beginLogicalFrame(textPane);
                drawPaneText(textPane.ctx, store, t, local.time);
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
