/**
 * Headless play-through of "Echoes of Dawn".
 *
 *   npm run game:simulate            # whole campaign + reload of every checkpoint
 *   npm run game:simulate -- --quiet # only print the summary
 *
 * The simulation core has no browser dependencies, so an autopilot can fly the entire
 * story in Node in a few seconds. Run it after changing the script (src/game/story) or
 * tuning values (src/game/config): it fails if the story dead-locks, a checkpoint cannot
 * be loaded, or the autopilot is destroyed too often to be plausible for a human.
 */
import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../src/game/config/gameConfig.js';
import { GameSession, PHASE } from '../src/game/state/GameSession.js';
import { loadSave, writeSave } from '../src/game/state/saveGame.js';

// --- Minimal localStorage so checkpoints work outside the browser ------------------------
const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

const QUIET = process.argv.includes('--quiet');
const STEP = 1 / 30;
const MAX_STORY_SECONDS = 45 * 60;
const MAX_RETRIES = 12;
const log = (...args) => { if (!QUIET) console.log(...args); };

const scratchLocal = new Vector3();
const scratchInverse = new Quaternion();
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Chooses what the autopilot should be shooting at. */
function pickTarget(world) {
    const player = world.player;
    const hostiles = world.ships.filter((ship) => ship.alive && ship.targetable && ship.faction === FACTION.UMBRA);
    if (hostiles.length === 0) return null;
    const priority = (ship) => {
        if (ship.cls.kind === 'module') return 0.5;
        if (ship.classId === 'lancer') return 0.6;
        if (ship.invulnerable) return 50;
        return 1;
    };
    hostiles.sort((a, b) => a.position.distanceTo(player.position) * priority(a) - b.position.distanceTo(player.position) * priority(b));
    return hostiles[0];
}

/** A simple but honest pilot: it uses the same controls a human has. */
function autopilot(session) {
    const { world } = session;
    const player = world.player;
    const controls = { yaw: 0, pitch: 0, roll: 0, throttle: 1, boost: false, firePrimary: false, fireSecondary: false };
    if (!player?.alive) return controls;

    const mustHoldLock = session.director.scene.objectiveKey === 'objective.paintTarget';
    let target = mustHoldLock ? world.findByTag('eclipse') : pickTarget(world);
    if (target && player.target !== target) world.setPlayerTarget(target);

    let destination = target?.position ?? session.waypoint?.position ?? null;
    let keepDistance = 0;
    if (target) keepDistance = target.cls.kind === 'fighter' ? 60 : target.radius + (mustHoldLock ? 900 : 260);
    if (!destination) return { ...controls, throttle: -1 };

    scratchInverse.copy(player.quaternion).invert();
    scratchLocal.copy(destination).sub(player.position);
    const distance = scratchLocal.length();
    scratchLocal.applyQuaternion(scratchInverse).normalize();

    const surfaceDistance = target ? target.distanceToPoint(player.position) : distance;
    const tooClose = target && surfaceDistance < keepDistance;
    // Too close: turn away from the target instead of ramming it (unless holding a lock).
    const direction = tooClose && !mustHoldLock ? -1 : 1;
    controls.yaw = clamp(scratchLocal.x * 3 * direction + (scratchLocal.z > 0 ? direction : 0), -1, 1);
    controls.pitch = clamp(scratchLocal.y * 3 * direction, -1, 1);
    controls.throttle = tooClose && mustHoldLock ? -1 : 1;
    controls.boost = !target && distance > 900;

    if (target && scratchLocal.z < -0.9 && direction === 1) {
        controls.firePrimary = surfaceDistance < 950;
        const shieldsDown = target.shield <= 0 || target.maxShield === 0;
        controls.fireSecondary = shieldsDown && target.cls.kind !== 'fighter' && surfaceDistance < 1400 && scratchLocal.z < -0.97;
    }
    return controls;
}

function createSession() {
    const uiState = {};
    const session = new GameSession({
        ui: { set: (partial) => Object.assign(uiState, partial) },
        settings: { locale: 'en', difficulty: 'captain', muted: true, invertY: false },
    });
    return { session, uiState };
}

/**
 * Flies until `stop(session)` is true, the story ends, or time runs out.
 * @returns {{ reason: string, retries: number, seconds: number }}
 */
function fly(session, stop) {
    let retries = 0;
    let seconds = 0;
    while (seconds < MAX_STORY_SECONDS) {
        session.comms.skip();
        session.update(STEP, autopilot(session));
        seconds += STEP;
        if (session.phase === PHASE.ENDING) return { reason: 'ending', retries, seconds };
        if (session.phase === PHASE.GAME_OVER) {
            retries += 1;
            log(`    ✗ lost (${session.failureReason}) at ${session.stats.time.toFixed(0)}s — reloading`);
            if (retries > MAX_RETRIES) return { reason: 'too many losses', retries, seconds };
            session.retry();
        }
        if (stop?.(session)) return { reason: 'stopped', retries, seconds };
    }
    return { reason: 'timeout', retries, seconds };
}

function fail(message) {
    console.error(`\nSIMULATION FAILED: ${message}`);
    process.exit(1);
}

// --- 1. Full play-through, remembering each checkpoint's save ----------------------------
const { session } = createSession();
const checkpointSaves = new Map();
session.events.on('checkpoint', ({ checkpointId }) => {
    checkpointSaves.set(checkpointId, structuredClone(loadSave()));
    const escort = session.world.findByTag('dawnbreaker');
    const escortNote = escort ? `, Dawnbreaker ${(escort.hullFraction * 100).toFixed(0)}%` : '';
    log(`  ✓ checkpoint ${checkpointId} at ${(session.stats.time / 60).toFixed(1)} min — hull ${(session.world.player.hullFraction * 100).toFixed(0)}%${escortNote}`);
});

log('Full campaign:');
session.newGame();
const full = fly(session);
if (full.reason !== 'ending') {
    const beat = session.director.main.beats[session.director.main.index];
    fail(`campaign stopped with "${full.reason}" after ${(full.seconds / 60).toFixed(1)} min at beat #${session.director.main.index} (${beat?.type}), objective ${session.director.scene.objectiveKey}`);
}
const expected = session.director.listCheckpoints();
const missing = expected.filter((id) => !checkpointSaves.has(id));
if (missing.length > 0) fail(`checkpoints never reached: ${missing.join(', ')}`);

// --- 2. Every checkpoint must load and lead to the next one ------------------------------
log('\nCheckpoint reloads:');
for (const [index, checkpointId] of expected.entries()) {
    const { session: reloaded } = createSession();
    writeSave(checkpointSaves.get(checkpointId));
    let reachedNext = false;
    reloaded.events.on('checkpoint', () => { reachedNext = true; });
    reloaded.continueGame();
    if (reloaded.phase !== PHASE.PLAYING) fail(`checkpoint ${checkpointId} did not load`);
    const result = fly(reloaded, () => reachedNext);
    const isLast = index === expected.length - 1;
    const ok = isLast ? result.reason === 'ending' : result.reason === 'stopped' || result.reason === 'ending';
    if (!ok) fail(`after loading ${checkpointId} the story stopped with "${result.reason}"`);
    log(`  ✓ ${checkpointId} → ${isLast ? 'ending' : 'next checkpoint'} in ${(result.seconds / 60).toFixed(1)} min (${result.retries} losses)`);
}

console.log(`\nCampaign OK: ${(session.stats.time / 60).toFixed(1)} min of story, ${session.stats.kills} kills, ${full.retries} autopilot losses, ${expected.length} checkpoints.`);
