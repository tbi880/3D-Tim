import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../config/gameConfig.js';
import { WEAPONS } from '../config/weapons.js';
import { areHostile } from '../core/systems/damage.js';
import { t } from '../i18n/index.js';

/**
 * Draws the in-world HUD on a 2D canvas laid over the 3D view: reticle, target brackets,
 * off-screen arrows, the waypoint, and the radar. Canvas drawing avoids hundreds of DOM
 * updates per second; panels that change slowly are ordinary React components.
 */

const COLORS = Object.freeze({
    hostile: '#ff4b6e',
    friendly: '#59d0ff',
    [FACTION.NEUTRAL]: '#d8dde6',
    waypoint: '#ffd36b',
    torpedo: '#b6ff3d',
    reticle: 'rgba(160, 225, 255, 0.85)',
    reticleDim: 'rgba(160, 225, 255, 0.22)',
});
/**
 * Red for what is hostile to the pilot, blue for their own side - whichever side that is: in
 * multiplayer the pilot may be flying for Umbra, or with the pirates.
 */
function contactColor(player, ship) {
    if (ship.faction === FACTION.NEUTRAL) return COLORS[FACTION.NEUTRAL];
    return areHostile(player, ship) ? COLORS.hostile : COLORS.friendly;
}

/** A cloaked ship (config/abilities.js) shows on nobody's markers or radar but its own side's. */
function isHiddenFrom(player, ship) {
    return ship.cloaked && areHostile(player, ship);
}

/** A torpedo worth warning about: an enemy's, or anybody's that is locked on the pilot (a pirate's on a pirate). */
function isIncoming(player, projectile) {
    return areHostile(player, projectile) || projectile.target === player;
}

const FONT = '600 11px Orbitron, sans-serif';
const EDGE_MARGIN = 46;
/** Off-screen hostiles sit a little closer to the edge than the waypoint and escort arrows. */
const EDGE_CONTACT_MARGIN = 26;
const RADAR_RANGE = 6500;
/** Must match the stick radius in input/InputController.js. */
const STICK_RADIUS = 0.36;

const scratchView = new Vector3();
const scratchNdc = new Vector3();
const scratchLocal = new Vector3();
const scratchInverse = new Quaternion();

/**
 * Projects a world position to screen pixels.
 * @returns {{ x: number, y: number, inFront: boolean, onScreen: boolean, distance: number }}
 */
function project(position, camera, width, height, out) {
    scratchView.copy(position).applyMatrix4(camera.matrixWorldInverse);
    out.inFront = scratchView.z < 0;
    out.distance = scratchView.length();
    scratchNdc.copy(position).project(camera);
    out.x = (scratchNdc.x * 0.5 + 0.5) * width;
    out.y = (-scratchNdc.y * 0.5 + 0.5) * height;
    out.onScreen = out.inFront && out.x > 0 && out.x < width && out.y > 0 && out.y < height;
    // For points behind the camera the projection mirrors; keep the true screen-space direction.
    out.dirX = scratchView.x;
    out.dirY = -scratchView.y;
    return out;
}

/** The four corners of a target bracket, and the four ticks of the reticle (drawn every frame: made once). */
const BRACKET_CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
const RETICLE_TICKS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);

function drawBrackets(ctx, x, y, half, corner) {
    ctx.beginPath();
    for (const [sx, sy] of BRACKET_CORNERS) {
        ctx.moveTo(x + sx * half, y + sy * (half - corner));
        ctx.lineTo(x + sx * half, y + sy * half);
        ctx.lineTo(x + sx * (half - corner), y + sy * half);
    }
    ctx.stroke();
}

function drawDiamond(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.stroke();
}

const edgeScratch = { x: 0, y: 0, dx: 0, dy: 0 };

/** Where on the screen edge (inset by `margin`) the direction towards an off-screen point lands. */
function edgePoint(projected, width, height, margin, out = edgeScratch) {
    const centreX = width / 2;
    const centreY = height / 2;
    let dirX = projected.dirX;
    let dirY = projected.dirY;
    // Straight behind: there is no screen direction, so park it at the bottom edge.
    if (Math.hypot(dirX, dirY) < 1e-6) {
        dirX = 0;
        dirY = 1;
    }
    const length = Math.hypot(dirX, dirY);
    const dx = dirX / length;
    const dy = dirY / length;
    const scale = Math.min((centreX - margin) / Math.max(Math.abs(dx), 1e-6), (centreY - margin) / Math.max(Math.abs(dy), 1e-6));
    out.x = centreX + dx * scale;
    out.y = centreY + dy * scale;
    out.dx = dx;
    out.dy = dy;
    return out;
}

/** Arrow on the screen edge pointing towards something that is not in view. */
function drawEdgeArrow(ctx, projected, width, height, color, label) {
    const { x, y, dx, dy } = edgePoint(projected, width, height, EDGE_MARGIN);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (label) {
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(label, x - dx * 30, y - dy * 30 + 4);
    }
}

/** A filled contact dot with a dark rim so it reads against bright planets and nebulae. */
function drawDot(ctx, x, y, radius, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

/** The locked target's slowly turning dashed ring. */
function drawLockRing(ctx, x, y, radius, color, time) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.9);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

/** Edge marker for a hostile that is out of view: a red dot with a small tick pointing to it. */
function drawEdgeContact(ctx, projected, width, height, color, radius, locked, time) {
    const { x, y, dx, dy } = edgePoint(projected, width, height, EDGE_CONTACT_MARGIN);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = color;
    ctx.globalAlpha = locked ? 1 : 0.8;
    ctx.beginPath();
    const tip = radius + (locked ? 13 : 8);
    ctx.moveTo(tip, 0);
    ctx.lineTo(radius + 3, -4);
    ctx.lineTo(radius + 3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawDot(ctx, x, y, radius, color, locked ? 1 : 0.8);
    if (locked) drawLockRing(ctx, x, y, radius + 11, color, time);
}

function shipName(ship) {
    return ship.callsign ?? t(ship.nameKey);
}

function drawBar(ctx, x, y, width, fraction, color) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, width, 3);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width * Math.max(0, Math.min(1, fraction)), 3);
}

const projected = { x: 0, y: 0, inFront: false, onScreen: false, distance: 0, dirX: 0, dirY: 0 };
/** The beam cone ring around the reticle, as drawn this frame (screen px). */
const beamRing = { x: 0, y: 0, radius: 0 };

/** How far ahead of the ship the reticle is anchored, in metres. */
const AIM_DISTANCE = 1500;

function drawReticle(ctx, session, camera, width, height, stick) {
    const player = session.world.hudShip;
    // The reticle marks where the nose points. In the cockpit that is the middle of the
    // screen; in the chase view it drifts as the camera lags behind the ship.
    scratchLocal.set(0, 0, -AIM_DISTANCE).applyQuaternion(player.quaternion).add(player.position);
    project(scratchLocal, camera, width, height, projected);
    const centreX = projected.inFront ? projected.x : width / 2;
    const centreY = projected.inFront ? projected.y : height / 2;
    const focalLength = height / 2 / Math.tan((camera.fov * Math.PI) / 360);

    // The ring shows the beam arrays' tracking cone: anything hostile inside it can be hit.
    const arcRadius = Math.tan((WEAPONS.playerBeam.arcDeg * Math.PI) / 180) * focalLength;
    ctx.strokeStyle = player.beamFiring ? 'rgba(255, 182, 72, 0.5)' : COLORS.reticleDim;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(centreX, centreY, arcRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    beamRing.x = centreX;
    beamRing.y = centreY;
    beamRing.radius = arcRadius;

    ctx.strokeStyle = COLORS.reticle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of RETICLE_TICKS) {
        ctx.moveTo(centreX + dx * 7, centreY + dy * 7);
        ctx.lineTo(centreX + dx * 16, centreY + dy * 16);
    }
    ctx.stroke();

    // Steering indicator: where the virtual stick currently is (always around the screen centre).
    // Not on a ship being watched: the stick here does not fly it.
    if (player !== session.world.player) return;
    const stickRadius = Math.min(width, height) * STICK_RADIUS;
    const stickX = width / 2 + stick.yaw * stickRadius;
    const stickY = height / 2 - stick.pitch * stickRadius;
    if (Math.hypot(stick.yaw, stick.pitch) > 0.02) {
        ctx.strokeStyle = COLORS.reticleDim;
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2);
        ctx.lineTo(stickX, stickY);
        ctx.stroke();
        ctx.strokeStyle = COLORS.reticle;
        ctx.beginPath();
        ctx.arc(stickX, stickY, 5, 0, Math.PI * 2);
        ctx.stroke();
    }
}


function drawShipMarkers(ctx, session, camera, width, height) {
    const { world } = session;
    const player = world.hudShip;
    const focalLength = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const escortTag = session.director.scene.escortTag;
    const time = performance.now() / 1000;
    let locked = null;

    for (const ship of world.ships) {
        if (ship === player || !ship.alive || !ship.targetable || ship.arriving || isHiddenFrom(player, ship)) continue;
        const isLocked = player.target === ship;
        const isEscort = escortTag && ship.tags.has(escortTag);
        const hostile = areHostile(player, ship);
        const color = contactColor(player, ship);
        const dotRadius = ship.cls.kind === 'capital' ? 6 : 4.5;
        project(ship.position, camera, width, height, projected);

        if (!projected.onScreen) {
            // Every hostile is shown on the edge in its direction, so the pilot can tell at a
            // glance which way to turn; friendlies only when they matter.
            if (hostile) drawEdgeContact(ctx, projected, width, height, color, dotRadius, isLocked, time);
            else if (isLocked) drawEdgeArrow(ctx, projected, width, height, color, null);
            else if (isEscort) drawEdgeArrow(ctx, projected, width, height, color, shipName(ship));
            if (isLocked && !hostile) {
                const { x, y } = edgePoint(projected, width, height, EDGE_MARGIN);
                drawLockRing(ctx, x, y, 14, color, time);
            }
            continue;
        }

        const apparentRadius = (ship.boundingRadius * 0.7 / projected.distance) * focalLength;
        const half = Math.max(isLocked ? 24 : 9, Math.min(apparentRadius * 1.15, 150));
        // Inside the beam ring the pilot wants to see the ship itself, so hostiles there get
        // only brackets; outside it they are red dots (plus brackets once they are big).
        const inRing = Math.hypot(projected.x - beamRing.x, projected.y - beamRing.y) < beamRing.radius;
        const showDot = hostile && !inRing;
        if (isLocked || !hostile || inRing || apparentRadius > 10) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = isLocked ? 0.9 : hostile ? 0.6 : 0.4;
            ctx.lineWidth = isLocked ? 1.5 : 1;
            drawBrackets(ctx, projected.x, projected.y, half, Math.max(4, half * 0.35));
            ctx.globalAlpha = 1;
        }
        if (showDot) drawDot(ctx, projected.x, projected.y, dotRadius, color, isLocked ? 1 : 0.9);
        if (isLocked) {
            locked = { x: projected.x, y: projected.y, ring: inRing ? Math.min(half * 1.3, 190) : Math.max(dotRadius + 12, Math.min(apparentRadius * 0.9, 120)), color };
        }

        if (isLocked || isEscort) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(shipName(ship).toUpperCase(), projected.x, projected.y - half - 8);
            if (isLocked) {
                const surfaceDistance = Math.max(0, ship.distanceToPoint(player.position));
                ctx.fillText(`${Math.round(surfaceDistance)} m`, projected.x, projected.y + half + 24);
                const barWidth = Math.max(40, half * 1.6);
                if (ship.maxShield > 0) drawBar(ctx, projected.x - barWidth / 2, projected.y + half + 5, barWidth, ship.shieldFraction, '#59d0ff');
                drawBar(ctx, projected.x - barWidth / 2, projected.y + half + 10, barWidth, ship.hullFraction, ship.invulnerable ? '#c04dff' : '#ff4b6e');
            }
        }
        ctx.globalAlpha = 1;
    }
    // Drawn last so the lock ring sits on top of any other contact's dot.
    if (locked) drawLockRing(ctx, locked.x, locked.y, locked.ring, locked.color, time);

    // Incoming torpedoes are worth seeing: they can be shot down.
    ctx.strokeStyle = COLORS.torpedo;
    ctx.lineWidth = 1.5;
    for (const projectile of world.projectiles) {
        if (projectile.kind !== 'torpedo' || !isIncoming(player, projectile)) continue;
        project(projectile.position, camera, width, height, projected);
        if (projected.onScreen) drawDiamond(ctx, projected.x, projected.y, 6);
    }
}

function drawWaypoint(ctx, session, camera, width, height) {
    const waypoint = session.waypoint;
    if (!waypoint) return;
    project(waypoint.position, camera, width, height, projected);
    const label = waypoint.labelKey ? t(waypoint.labelKey) : '';
    if (!projected.onScreen) {
        drawEdgeArrow(ctx, projected, width, height, COLORS.waypoint, label);
        return;
    }
    ctx.strokeStyle = COLORS.waypoint;
    ctx.fillStyle = COLORS.waypoint;
    ctx.lineWidth = 2;
    drawDiamond(ctx, projected.x, projected.y, 11);
    ctx.textAlign = 'center';
    ctx.fillText(label, projected.x, projected.y - 20);
    ctx.fillText(`${Math.round(projected.distance)} m`, projected.x, projected.y + 28);
}

/**
 * Draws the full-screen marker layer, as the pilot of the HUD's ship sees it (world.hudShip:
 * the player's own, or the one a player who is down watches fly).
 * @param {CanvasRenderingContext2D} ctx already scaled so 1 unit = 1 CSS pixel
 * @param {{ yaw: number, pitch: number }} stick current steering deflection
 */
export function drawMarkers(ctx, session, camera, width, height, stick) {
    ctx.clearRect(0, 0, width, height);
    const player = session.world.hudShip;
    if (!player?.alive || session.world.controlsLocked) return;
    ctx.font = FONT;
    drawReticle(ctx, session, camera, width, height, stick);
    drawShipMarkers(ctx, session, camera, width, height);
    drawWaypoint(ctx, session, camera, width, height);
}

/**
 * Top-down radar: the player is at the centre, straight ahead is up. A short stalk shows
 * whether a contact is above or below the player's wings. (The player, or the pilot they watch: world.hudShip.)
 */
export function drawRadar(ctx, session, size) {
    ctx.clearRect(0, 0, size, size);
    const { world } = session;
    const player = world.hudShip;
    if (!player?.alive) return;
    const centre = size / 2;
    const radius = centre - 4;

    ctx.fillStyle = 'rgba(6, 18, 30, 0.55)';
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 210, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(centre, centre, radius / 2, 0, Math.PI * 2);
    ctx.moveTo(centre, centre - radius);
    ctx.lineTo(centre, centre + radius);
    ctx.moveTo(centre - radius, centre);
    ctx.lineTo(centre + radius, centre);
    ctx.stroke();

    scratchInverse.copy(player.quaternion).invert();
    const plot = (position, color, dotSize, ringed) => {
        scratchLocal.copy(position).sub(player.position).applyQuaternion(scratchInverse);
        const flat = Math.hypot(scratchLocal.x, scratchLocal.z);
        // Contacts beyond radar range are pinned to the rim so they are never lost.
        const scale = (flat > RADAR_RANGE ? RADAR_RANGE / flat : 1) * (radius / RADAR_RANGE);
        const x = centre + scratchLocal.x * scale;
        const y = centre + scratchLocal.z * scale;
        const stalk = Math.max(-14, Math.min(14, (-scratchLocal.y / RADAR_RANGE) * radius * 1.5));
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + stalk);
        ctx.stroke();
        ctx.fillRect(x - dotSize / 2, y + stalk - dotSize / 2, dotSize, dotSize);
        if (ringed) {
            ctx.beginPath();
            ctx.arc(x, y + stalk, dotSize + 2.5, 0, Math.PI * 2);
            ctx.stroke();
        }
    };

    for (const ship of world.ships) {
        if (ship === player || !ship.alive || !ship.targetable || ship.arriving || isHiddenFrom(player, ship)) continue;
        plot(ship.position, contactColor(player, ship), ship.cls.kind === 'capital' ? 6 : 3.5, player.target === ship);
    }
    for (const projectile of world.projectiles) {
        if (projectile.kind === 'torpedo' && isIncoming(player, projectile)) plot(projectile.position, COLORS.torpedo, 2, false);
    }
    if (session.waypoint) plot(session.waypoint.position, COLORS.waypoint, 4, true);

    // The player's own ship.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(centre, centre - 5);
    ctx.lineTo(centre + 4, centre + 4);
    ctx.lineTo(centre - 4, centre + 4);
    ctx.closePath();
    ctx.fill();
}
