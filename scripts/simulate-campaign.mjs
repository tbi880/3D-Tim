/**
 * Headless play-through of "Echoes of Dawn".
 *
 *   npm run game:simulate            # whole campaign, every checkpoint reload, careless pilot
 *   npm run game:simulate -- --quiet # only print the summary
 *
 * The simulation core has no browser dependencies, so an autopilot can fly the entire
 * story in Node in a few seconds. Run it after changing the script (src/game/story) or
 * tuning values (src/game/config): it fails if the story dead-locks, a checkpoint cannot
 * be loaded, or the autopilot is destroyed too often to be plausible for a human.
 */
import { playerBeamRange, playerTorpedoRange } from '../src/game/core/systems/weapons.js';
import { WEAPONS } from '../src/game/config/weapons.js';
import { Quaternion, Vector3 } from 'three';
import { FACTION } from '../src/game/config/gameConfig.js';
import { SHIP_CLASSES } from '../src/game/config/shipClasses.js';
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
/** `--difficulty=cadet|captain|admiral` flies the campaign at another setting (default captain). */
const DIFFICULTY_ID = process.argv.find((arg) => arg.startsWith('--difficulty='))?.split('=')[1] ?? 'captain';
/** `--ship=kestrel|swift|shrike|bulwark|peregrine` picks the player's ship (default kestrel). */
const SHIP_ID = process.argv.find((arg) => arg.startsWith('--ship='))?.split('=')[1] ?? 'kestrel';
const STEP = 1 / 30;
// A slow hull simply takes longer to cross the same battlefields, so it gets more time
// (the Bulwark, at under half the Kestrel's speed, gets 95 minutes).
const MAX_STORY_SECONDS = (SHIP_CLASSES[SHIP_ID]?.maxSpeed < 100 ? 95 : 60) * 60;
// Losses allowed over a whole campaign (raised from 12 when the two Barrens chapters made it half as long again).
const MAX_RETRIES = 16;
const log = (...args) => { if (!QUIET) console.log(...args); };

const scratchLocal = new Vector3();
const scratchInverse = new Quaternion();
const scratchForwardPick = new Vector3();
const scratchOffsetPick = new Vector3();
const scratchLanceOrigin = new Vector3();
const scratchAway = new Vector3();
const scratchDodge = new Vector3();
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Chooses what the autopilot should be shooting at. The "focused" pilot goes for objectives
 * and torpedo bombers first; the "careless" one just attacks whatever is nearest, which
 * checks that a player who ignores the hints can still finish the story.
 */
function pickTarget(world, focused) {
    const player = world.player;
    const hostiles = world.ships.filter((ship) => ship.alive && ship.targetable && ship.faction === FACTION.UMBRA);
    if (hostiles.length === 0) return null;
    const priority = (ship) => {
        if (ship.invulnerable) return 50;
        if (!focused) return 1;
        // A sensible pilot silences the guns before working on anything they cover.
        if (ship.classId === 'eclipseCannon') return 0.2;
        if (ship.cls.kind === 'module') return 0.5;
        if (ship.classId === 'lancer') return 0.6;
        return 1;
    };
    // A sluggish hull (the Bulwark) can't chase what is behind it, so its pilot, like a human,
    // works on whatever is already near the nose.
    const turn = player.cls.handling?.turn ?? 1;
    const swingCost = turn < 0.5 ? (0.5 - turn) * 12 : 0;
    const forward = scratchForwardPick.set(0, 0, -1).applyQuaternion(player.quaternion);
    const cost = (ship) => {
        const offset = scratchOffsetPick.copy(ship.position).sub(player.position);
        const distance = offset.length();
        const facing = distance > 0 ? offset.dot(forward) / distance : 1;
        return distance * priority(ship) * (1 + swingCost * (1 - facing));
    };
    hostiles.sort((a, b) => cost(a) - cost(b));
    return hostiles[0];
}

/**
 * If a charging or firing lance is lined up on the player (within its corridor plus a safety
 * margin), a point to fly to that leads straight out of the corridor; otherwise null.
 */
function lanceDodgePoint(world, player) {
    for (const ship of world.ships) {
        if (!ship.alive) continue;
        for (const weapon of ship.weapons) {
            if (weapon.def.type !== 'lance' || (weapon.lancePhase !== 'charging' && weapon.lancePhase !== 'firing')) continue;
            scratchLanceOrigin.fromArray(weapon.def.mount ?? [0, 0, 0]).applyQuaternion(ship.quaternion).add(ship.position);
            scratchAway.copy(player.position).sub(scratchLanceOrigin);
            const along = scratchAway.dot(weapon.lanceDirection);
            if (along < 0 || along > weapon.def.range) continue;
            scratchAway.addScaledVector(weapon.lanceDirection, -along);
            const offAxis = scratchAway.length();
            if (offAxis > weapon.def.corridorRadius + player.boundingRadius + 250) continue;
            if (offAxis < 1) scratchAway.set(0, 1, 0).cross(weapon.lanceDirection);
            return scratchDodge.copy(player.position).addScaledVector(scratchAway.normalize(), 1500);
        }
    }
    return null;
}

/** A simple but honest pilot: it uses the same controls a human has. */
function autopilot(session, focused = true) {
    const { world } = session;
    const player = world.player;
    const controls = { yaw: 0, pitch: 0, roll: 0, throttle: 1, boost: false, firePrimary: false, fireSecondary: false };
    if (!player?.alive) return controls;

    const mustHoldLock = session.director.scene.objectiveKey === 'objective.paintTarget';
    let target = mustHoldLock ? world.findByTag('eclipse') : pickTarget(world, focused);
    if (target && player.target !== target) world.setPlayerTarget(target);

    // Like a human, get out from under the Eclipse's lance once it starts charging.
    const dodge = mustHoldLock ? null : lanceDodgePoint(world, player);
    if (dodge) target = null;

    let destination = dodge ?? target?.position ?? session.waypoint?.position ?? null;
    let keepDistance = 0;
    // Gun batteries are beamed down from outside their 2.6 km reach, where the ship's beams get
    // that far; a short-ranged ship has to close in and trade fire with them.
    const sniping = target?.classId === 'eclipseCannon';
    const beamRange = playerBeamRange(player, WEAPONS.playerBeam);
    const torpedoRange = playerTorpedoRange(player, WEAPONS.playerTorpedo);
    const snipeDistance = Math.min(2750, beamRange * 0.85);
    if (target) keepDistance = target.cls.kind === 'fighter' ? 60 : (mustHoldLock ? 2500 : (sniping ? snipeDistance : 320));
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
    // Holding a lock, brake; too close to a gun battery (a carrier can drift up on you), turn
    // away and open the range again at full throttle.
    controls.throttle = tooClose && mustHoldLock ? -1 : 1;
    controls.boost = !target && distance > 900;
    // A fast ship eases off near its target, as a human would, instead of overshooting into it.
    if (target && !tooClose && surfaceDistance < 1500) controls.throttle = Math.min(1, 160 / player.cls.maxSpeed);

    if (target && scratchLocal.z < -0.9 && direction === 1) {
        controls.firePrimary = surfaceDistance < beamRange * (sniping ? 0.97 : 0.73);
        const shieldsDown = target.shield <= 0 || target.maxShield === 0;
        controls.fireSecondary = shieldsDown && target.cls.kind !== 'fighter'
            && surfaceDistance < Math.min(1400, torpedoRange * 0.8) && scratchLocal.z < -0.97;
    }
    return controls;
}

function createSession() {
    const uiState = {};
    const session = new GameSession({
        ui: { set: (partial) => Object.assign(uiState, partial) },
        settings: { locale: 'en', difficulty: DIFFICULTY_ID, playerShip: SHIP_ID, muted: true, invertY: false },
    });
    return { session, uiState };
}

/**
 * Flies until `stop(session)` is true, the story ends, or time runs out.
 * @returns {{ reason: string, retries: number, seconds: number }}
 */
function fly(session, stop, focused = true) {
    let retries = 0;
    let seconds = 0;
    while (seconds < MAX_STORY_SECONDS) {
        session.comms.skip();
        session.update(STEP, autopilot(session, focused));
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

// --- 3. A careless pilot must also be able to finish ---------------------------------------
log('\nCareless pilot:');
const { session: careless } = createSession();
careless.newGame();
const sloppy = fly(careless, null, false);
if (sloppy.reason !== 'ending') fail(`the careless pilot stopped with "${sloppy.reason}" (objective ${careless.director.scene.objectiveKey})`);
log(`  ✓ finished in ${(careless.stats.time / 60).toFixed(1)} min with ${sloppy.retries} losses`);

console.log(`\nCampaign OK: ${(session.stats.time / 60).toFixed(1)} min of story, ${session.stats.kills} kills, ${full.retries} autopilot losses, ${expected.length} checkpoints.`);
const score = session.finalScore;
if (score) console.log(`Final score: ${score.total} (rank ${score.rank}) = (${score.combat} combat + ${score.missionBonus} mission + ${score.timeBonus} time - ${score.lossPenalty} losses) x ${score.multiplier}`);
