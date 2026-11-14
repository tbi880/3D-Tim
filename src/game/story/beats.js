import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../config/gameConfig.js';
import { GAME_EVENTS } from '../core/EventBus.js';
import { forwardOf, lookRotation } from '../core/math.js';
import { aimPointOn, angleOffAxis } from '../core/systems/targeting.js';
import { BeatRunner } from './BeatRunner.js';
import { formationOffset, resolvePlacement } from './placement.js';

/**
 * Beat factories: the vocabulary the campaign script is written in.
 * Every factory returns an immutable beat object understood by BeatRunner.
 */

const scratchPoint = new Vector3();
const scratchOffset = new Vector3();
const scratchForward = new Vector3();
const scratchAim = new Vector3();

// ---- Timing -----------------------------------------------------------------------------

export const wait = (seconds) => ({
    type: 'wait',
    begin(ctx, state) { state.remaining = seconds; },
    tick(ctx, dt, state) { state.remaining -= dt; return state.remaining <= 0; },
});

/** Waits until `predicate(ctx)` is true, or until `timeout` seconds have passed. */
export const waitUntil = (predicate, { timeout = Infinity } = {}) => ({
    type: 'waitUntil',
    begin(ctx, state) { state.remaining = timeout; },
    tick(ctx, dt, state) { state.remaining -= dt; return state.remaining <= 0 || predicate(ctx); },
});

export const waitForGroup = (group, options) => waitUntil((ctx) => ctx.world.countGroup(group) === 0, options);

/** Waits until no hostile ship is left in the sector. */
export const waitForCalm = (options) => waitUntil((ctx) => ctx.world.countFaction(FACTION.UMBRA) === 0, options);

// ---- Dialogue and HUD -------------------------------------------------------------------

/** Plays a comms line. Blocks the script until the line is over unless `wait: false`. */
export const say = (speakerId, textKey, { wait: blocking = true } = {}) => ({
    type: 'say',
    begin(ctx, state) { state.line = ctx.stage.say(speakerId, textKey); },
    tick(ctx, dt, state) { return !blocking || state.line.finished; },
});

export const chapter = (chapterId) => ({
    type: 'chapter',
    begin(ctx, state) {
        ctx.director.scene.chapterId = chapterId;
        ctx.stage.showTitleCard(chapterId);
        state.remaining = 4.5;
    },
    tick(ctx, dt, state) { state.remaining -= dt; return state.remaining <= 0; },
});

/** Sets (or clears, with null) the objective. `params(ctx)` supplies live numbers for the text. */
export const objective = (textKey, params = null) => ({
    type: 'objective',
    begin(ctx) {
        ctx.director.scene.objectiveKey = textKey;
        ctx.director.objectiveParams = params;
        ctx.stage.setObjective(textKey);
    },
});

export const hint = (textKey) => ({
    type: 'hint',
    begin(ctx) { ctx.stage.setHint(textKey); },
});

/** Shows a labelled progress bar driven by `getValue(ctx)` (0..1); pass null to hide it. */
export const progress = (labelKey, getValue = null) => ({
    type: 'progress',
    begin(ctx) { ctx.director.progress = labelKey ? { labelKey, getValue } : null; },
});

/** Marks an allied ship the mission depends on: the HUD tracks it and losing it fails the mission. */
export const escort = (tag) => ({
    type: 'escort',
    begin(ctx) { ctx.director.scene.escortTag = tag; },
});

export const bossBar = (tag) => ({
    type: 'bossBar',
    begin(ctx) { ctx.director.scene.bossTag = tag; },
});

export const music = (trackId) => ({
    type: 'music',
    begin(ctx) {
        ctx.director.scene.musicId = trackId;
        ctx.stage.playMusic(trackId);
    },
});

/** Places (or removes, with null) the navigation marker. */
export const waypoint = (placement, labelKey = null) => ({
    type: 'waypoint',
    begin(ctx) {
        ctx.stage.setWaypoint(placement ? { placement, labelKey } : null);
    },
});

// ---- World ------------------------------------------------------------------------------

/**
 * Spawns `count` ships of a class. Usable directly from `run()` callbacks too.
 * Extra options are passed through to World.spawnShip (group, tags, callsign, persistent...).
 * `at` is a placement (story/placement.js); `faceTag` / `facing` set the heading
 * (default: nose towards the player).
 */
export function spawnShips(ctx, classId, { count = 1, at = [0, 0, 0], spacing = 70, faceTag = null, facing = null, warpIn = true, ...shipOptions } = {}) {
    const { world } = ctx;
    const centre = resolvePlacement(world, at, new Vector3());
    const spawned = [];
    for (let i = 0; i < count; i++) {
        const position = centre.clone().add(formationOffset(world, i, count, spacing, scratchOffset));
        let direction = facing;
        if (!direction) {
            const lookAt = (faceTag ? world.findByTag(faceTag) : world.player)?.position;
            direction = lookAt ? scratchPoint.copy(lookAt).sub(position).toArray() : [0, 0, -1];
        }
        spawned.push(world.spawnShip(classId, { ...shipOptions, position, facing: direction, warpIn }));
    }
    return spawned;
}

export const spawn = (classId, options) => ({
    type: 'spawn',
    begin(ctx) { spawnShips(ctx, classId, options); },
});

/** Escape hatch for one-off script logic. Keep these short; reusable logic deserves its own beat. */
export const run = (action) => ({
    type: 'run',
    begin(ctx) { action(ctx); },
});

/** Calls `action(ctx, dt)` every frame, forever. Only meaningful inside `background`. */
export const everyFrame = (action) => ({
    type: 'everyFrame',
    tick(ctx, dt) { action(ctx, dt); return false; },
});

/** Repeats a list of beats for as long as `predicate(ctx)` holds (checked between rounds). */
export const repeatWhile = (predicate, beats) => ({
    type: 'repeatWhile',
    begin(ctx, state) { state.runner = null; },
    tick(ctx, dt, state) {
        if (!state.runner) {
            if (!predicate(ctx)) return true;
            state.runner = new BeatRunner(beats);
        }
        if (state.runner.update(ctx, dt)) state.runner = null;
        return false;
    },
});

/** Starts a named sequence that runs alongside the main story. Re-using an id restarts it. */
export const background = (id, beats) => ({
    type: 'background',
    begin(ctx) { ctx.director.startBackground(id, beats); },
});

export const stopBackground = (id) => ({
    type: 'stopBackground',
    begin(ctx) { ctx.director.stopBackground(id); },
});

/**
 * A save point. Loading it resumes the script on the next beat with the persistent ships,
 * story variables and scene state restored; anything else (enemies, background sequences,
 * progress bars) must be set up again by the beats that follow.
 */
export const checkpoint = (id) => ({
    type: 'checkpoint',
    id,
    begin(ctx) {
        ctx.stage.saveCheckpoint(id);
        ctx.director.resumed = false;
    },
});

/** Player must keep `tag` locked and in their sights; fills `vars[varName]` from 0 to 1. */
export const holdLock = (tag, seconds, varName, { maxAngle = 0.22, maxDistance = 8000 } = {}) => ({
    type: 'holdLock',
    begin(ctx) { ctx.vars[varName] = 0; },
    tick(ctx, dt) {
        const { world, vars } = ctx;
        const target = world.findByTag(tag);
        const player = world.player;
        if (!target || !player?.alive) return true;
        forwardOf(player.quaternion, scratchForward);
        aimPointOn(target, player.position, scratchForward, scratchAim);
        const holding = player.target === target
            && angleOffAxis(target, player.position, scratchForward, scratchAim) < maxAngle
            && target.distanceToPoint(player.position) < maxDistance;
        vars[varName] = Math.min(1, Math.max(0, vars[varName] + (holding ? dt : -dt * 0.5) / seconds));
        return vars[varName] >= 1;
    },
});

/**
 * Player must stay within `radius` metres of the ship tagged `tag` for `seconds`
 * (scanning a beacon, docking...). Fills `vars[varName]` from 0 to 1; drifting away drains it.
 */
export const holdNear = (tag, radius, seconds, varName) => ({
    type: 'holdNear',
    begin(ctx) { ctx.vars[varName] = 0; },
    tick(ctx, dt) {
        const { world, vars } = ctx;
        const target = world.findByTag(tag);
        const player = world.player;
        if (!target || !player?.alive) return true;
        const near = target.distanceToPoint(player.position) < radius;
        vars[varName] = Math.min(1, Math.max(0, vars[varName] + (near ? dt : -dt * 0.5) / seconds));
        return vars[varName] >= 1;
    },
});

// ---- Docking ----------------------------------------------------------------------------

const scratchGlideFacing = new Vector3();
const scratchGlideQuaternion = new Quaternion();
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Takes the helm and flies the player's ship in a straight line to `to` (a placement), turning
 * its nose to `facing`, over `seconds` - the dock's traffic control doing the flying. With
 * `release: false` the helm stays locked afterwards (the ship sits in its berth); otherwise it is
 * handed back with the throttle at `throttle`.
 */
export const glide = ({ to, facing, seconds, release = true, throttle = 0.6 }) => ({
    type: 'glide',
    begin(ctx, state) {
        const player = ctx.world.player;
        ctx.world.controlsLocked = true;
        state.elapsed = 0;
        state.from = player.position.clone();
        state.to = resolvePlacement(ctx.world, to, new Vector3());
        state.fromQuaternion = player.quaternion.clone();
        state.toQuaternion = lookRotation(scratchGlideFacing.fromArray(facing).normalize(), new Quaternion());
    },
    tick(ctx, dt, state) {
        const player = ctx.world.player;
        if (!player?.alive) return true;
        state.elapsed += dt;
        const t = Math.min(1, state.elapsed / seconds);
        const eased = smoothstep(t);
        scratchPoint.copy(player.position);
        player.position.lerpVectors(state.from, state.to, eased);
        player.quaternion.copy(scratchGlideQuaternion.copy(state.fromQuaternion).slerp(state.toQuaternion, smoothstep(Math.min(1, t * 1.6))));
        player.velocity.copy(player.position).sub(scratchPoint).multiplyScalar(dt > 0 ? 1 / dt : 0);
        player.speed = player.velocity.length();
        player.angularVelocity.set(0, 0, 0);
        if (t < 1) return false;
        if (release) {
            player.throttle = throttle;
            ctx.world.controlsLocked = false;
        } else {
            // Held in place: idle the engines so the ship does not creep on afterwards.
            player.velocity.set(0, 0, 0);
            player.speed = 0;
            player.throttle = 0;
        }
        return true;
    },
});

/**
 * Fades the screen to black (`to` = 1) or back (`to` = 0) over `seconds` (ui/ScreenFade.jsx draws
 * it). Blocks the script until done unless `wait: false`; a fade already under way is replaced.
 */
export const fade = (to, seconds, { wait: blocking = true } = {}) => ({
    type: 'fade',
    begin(ctx, state) {
        state.from = ctx.world.screenFade;
        state.elapsed = 0;
        if (!blocking) ctx.director.startBackground('screenFade', [fade(to, seconds)]);
    },
    tick(ctx, dt, state) {
        if (!blocking) return true;
        state.elapsed += dt;
        const t = seconds > 0 ? Math.min(1, state.elapsed / seconds) : 1;
        ctx.world.screenFade = state.from + (to - state.from) * smoothstep(t);
        return t >= 1;
    },
});

/** Opens the refit window with `points` to spend and waits until the player confirms it. */
export const refit = (points) => ({
    type: 'refit',
    begin(ctx, state) {
        state.done = false;
        ctx.stage.openRefit(points, () => { state.done = true; });
    },
    tick(ctx, dt, state) { return state.done; },
});

// ---- Warp -------------------------------------------------------------------------------

const WARP_SPOOL_SECONDS = 2.4;
const WARP_EXIT_SECONDS = 1.4;

/**
 * Jumps to another sector: spool up, flash, arrive.
 * Ships tagged with one of `bring` travel along; everything else is left behind.
 * `arrive(ctx)` runs at the moment of arrival, before the flash clears, to dress the scene.
 */
export const warp = (sectorId, { bring = [], arrive = null } = {}) => ({
    type: 'warp',
    begin(ctx, state) {
        state.elapsed = 0;
        state.jumped = false;
        ctx.world.controlsLocked = true;
        ctx.stage.setWaypoint(null);
        ctx.stage.onWarp('spool');
    },
    tick(ctx, dt, state) {
        const { world } = ctx;
        state.elapsed += dt;
        if (!state.jumped) {
            world.warpFactor = Math.min(1, state.elapsed / WARP_SPOOL_SECONDS);
            if (state.elapsed < WARP_SPOOL_SECONDS) return false;
            state.jumped = true;
            jumpToSector(ctx, sectorId, bring);
            arrive?.(ctx);
            ctx.stage.onWarp('arrive');
            return false;
        }
        const exit = (state.elapsed - WARP_SPOOL_SECONDS) / WARP_EXIT_SECONDS;
        world.warpFactor = Math.max(0, 1 - exit);
        if (exit < 1) return false;
        world.warpFactor = 0;
        world.controlsLocked = false;
        return true;
    },
});

function jumpToSector(ctx, sectorId, bring) {
    const { world } = ctx;
    const player = world.player;
    for (const ship of [...world.ships]) {
        if (ship === player) continue;
        const travels = bring.some((tag) => ship.tags.has(tag)) || (ship.parent && bring.some((tag) => ship.parent.tags.has(tag)));
        if (!travels) world.removeShip(ship);
        // Ships that jump with the player drop out of warp around them a moment later.
        else if (!ship.parent) world.beginWarpIn(ship);
    }
    world.projectiles = [];
    world.scriptedBeams = [];
    const sector = world.setSector(sectorId);
    player.position.fromArray(sector.playerStart.position);
    lookRotation(scratchPoint.fromArray(sector.playerStart.facing).normalize(), player.quaternion);
    player.velocity.set(0, 0, 0);
    player.angularVelocity.set(0, 0, 0);
    world.setPlayerTarget(null);
    world.events.emit(GAME_EVENTS.WARP_FLASH, { position: player.position.clone(), size: 60, quaternion: player.quaternion.clone() });
}

export const ending = () => ({
    type: 'ending',
    begin(ctx) { ctx.stage.endGame(); },
    tick() { return false; },
});
