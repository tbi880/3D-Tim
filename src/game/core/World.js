import { Vector3 } from 'three';
import { DIFFICULTY, DEFAULT_DIFFICULTY, PLAYER, WORLD } from '../config/gameConfig.js';
import { SECTORS } from '../config/sectors.js';
import { SHIP_CLASSES } from '../config/shipClasses.js';
import { EventBus, GAME_EVENTS } from './EventBus.js';
import { Ship } from './Ship.js';
import { createRng, lookRotation } from './math.js';
import { updateAI } from './systems/aiPilot.js';
import { resolvePlayerCollisions } from './systems/collisions.js';
import { regenerateShield } from './systems/damage.js';
import { generateAsteroids, updateObstacles } from './systems/obstacles.js';
import { IDLE_CONTROLS, updatePlayerFlight } from './systems/playerFlight.js';
import { updateProjectiles } from './systems/projectiles.js';
import { findNearestHostile, findTargetNearCrosshair, getLockCandidates, isValidTarget } from './systems/targeting.js';
import { createWeaponState, updateShipWeapons } from './systems/weapons.js';

const scratchVector = new Vector3();

function toVector3(value, out = new Vector3()) {
    if (!value) return out.set(0, 0, 0);
    return Array.isArray(value) ? out.fromArray(value) : out.copy(value);
}

/**
 * The whole simulation: ships, projectiles, beams and the rules that move them.
 *
 * It has no dependency on React, the DOM or WebGL, which keeps it testable (see
 * scripts/simulate-campaign.mjs) and lets the 3D scene and HUD be plain observers:
 * they read the public fields each frame and listen to `world.events`.
 */
export class World {
    constructor({ seed = 20261111, difficultyId = DEFAULT_DIFFICULTY } = {}) {
        this.rng = createRng(seed);
        this.events = new EventBus();
        this.difficulty = DIFFICULTY[difficultyId] ?? DIFFICULTY[DEFAULT_DIFFICULTY];

        this.time = 0;
        /** @type {Ship[]} */
        this.ships = [];
        this.projectiles = [];
        /** Beams to draw this frame; rebuilt on every update from a pool. */
        this.beams = [];
        this.beamPool = [];
        /** Long-lived beams started by the story (the Dawn cannon). */
        this.scriptedBeams = [];
        this.obstacles = [];
        this.sectorId = null;

        /** @type {Ship | null} */
        this.player = null;
        this.playerControls = IDLE_CONTROLS;
        /** True while the story has the helm (warp jumps, cut-scenes). */
        this.controlsLocked = false;
        this.outOfBounds = false;
        /** Length (seconds) of the most recent simulation step; story timers use it. */
        this.lastStep = 0;
        /** Whether a ship-mounted cannon is on the player this step: 0 no, 1 tracking, 2 locked. */
        this.playerCannonLock = 0;
        /** Ship class the player flies (chosen on the title screen, restored from saves). */
        this.playerClassId = PLAYER.classId;
        /** Assist: the player's beams fire by themselves when something hostile is in the ring. */
        this.autoFire = false;
        /** 0..1 strength of the warp effect; driven by the story's warp beat. */
        this.warpFactor = 0;
    }

    // ---- Lifecycle ----------------------------------------------------------------------

    /** Removes everything from the world but keeps event listeners attached. */
    clear() {
        const removed = this.ships;
        this.ships = [];
        for (const ship of removed) {
            ship.alive = false;
            this.events.emit(GAME_EVENTS.SHIP_REMOVED, { ship });
        }
        this.projectiles = [];
        this.beams.length = 0;
        this.scriptedBeams = [];
        this.obstacles = [];
        this.player = null;
        this.controlsLocked = false;
        this.outOfBounds = false;
        this.warpFactor = 0;
    }

    setDifficulty(difficultyId) {
        this.difficulty = DIFFICULTY[difficultyId] ?? this.difficulty;
    }

    setSector(sectorId) {
        const sector = SECTORS[sectorId];
        if (!sector) throw new Error(`Unknown sector "${sectorId}"`);
        this.sectorId = sectorId;
        this.obstacles = generateAsteroids(sector.asteroids);
        this.events.emit(GAME_EVENTS.SECTOR_CHANGED, { sectorId });
        return sector;
    }

    // ---- Ships --------------------------------------------------------------------------

    /**
     * @param {string} classId key in SHIP_CLASSES
     * @param {object} [options]
     * @param {Vector3|number[]} [options.position]
     * @param {Vector3|number[]} [options.facing] direction the nose points
     * @param {number[]} [options.quaternion] exact orientation (overrides facing)
     * @param {string} [options.group] label used by the story to count / wait on ships
     * @param {string[]} [options.tags] labels used to look single ships up
     * @param {string} [options.callsign] proper name shown on the HUD
     * @param {boolean} [options.persistent] saved in checkpoints
     * @param {Ship} [options.parent] with `mountOffset`: mounts this ship on another
     * @param {boolean} [options.warpIn] play an arrival flash
     */
    spawnShip(classId, options = {}) {
        const cls = SHIP_CLASSES[classId];
        if (!cls) throw new Error(`Unknown ship class "${classId}"`);
        const ship = new Ship(classId, cls, options);
        toVector3(options.position, ship.position);
        if (options.quaternion) ship.quaternion.fromArray(options.quaternion);
        else if (options.facing) lookRotation(toVector3(options.facing, scratchVector).normalize(), ship.quaternion);

        ship.weapons = cls.weapons.map((weaponId) => createWeaponState(weaponId, this.rng));
        ship.spawnTime = this.time;
        if (options.maxShield != null) {
            ship.maxShield = options.maxShield;
            ship.shield = options.shield ?? options.maxShield;
        }
        if (options.minHullFraction != null) ship.minHull = ship.maxHull * options.minHullFraction;
        if (options.parent) {
            ship.parent = options.parent;
            ship.mountOffset = toVector3(options.mountOffset);
            this.followParent(ship);
        }
        if (ship.cls.behavior === 'fighter' || ship.cls.behavior === 'bomber') ship.speed = cls.maxSpeed * 0.6;
        if (options.warpIn) this.beginWarpIn(ship);

        this.ships.push(ship);
        if (ship.isPlayer) this.player = ship;
        this.events.emit(GAME_EVENTS.SHIP_SPAWNED, { ship });
        return ship;
    }

    /**
     * Starts the warp-in sequence: for a moment the ship is a streak of light decelerating
     * towards its spot (drawn by scene/ShipsLayer.jsx); it cannot act or be hit until it lands.
     * Bigger ships take a little longer, and a random offset keeps a squadron from landing in unison.
     */
    beginWarpIn(ship) {
        ship.warpDuration = WORLD.warpInSeconds * (1 + Math.min(1, ship.boundingRadius / 800)) * (0.8 + this.rng() * 0.5);
        ship.warpTimer = ship.warpDuration;
        this.events.emit(GAME_EVENTS.WARP_IN_STARTED, { ship, duration: ship.warpDuration });
    }

    /** Removes a ship without destroying it (it warped out or the scene changed). */
    removeShip(ship, { flash = false } = {}) {
        const index = this.ships.indexOf(ship);
        if (index === -1) return;
        ship.alive = false;
        this.ships.splice(index, 1);
        if (flash) this.events.emit(GAME_EVENTS.WARP_FLASH, { position: ship.position.clone(), size: ship.boundingRadius, quaternion: ship.quaternion.clone() });
        this.events.emit(GAME_EVENTS.SHIP_REMOVED, { ship });
    }

    followParent(ship) {
        const parent = ship.parent;
        ship.position.copy(ship.mountOffset).applyQuaternion(parent.quaternion).add(parent.position);
        ship.quaternion.copy(parent.quaternion);
        ship.velocity.copy(parent.velocity);
    }

    findByTag(tag) {
        return this.ships.find((ship) => ship.alive && ship.tags.has(tag)) ?? null;
    }

    getGroup(group) {
        return this.ships.filter((ship) => ship.alive && ship.group === group);
    }

    countGroup(group) {
        let count = 0;
        for (const ship of this.ships) if (ship.alive && ship.group === group) count++;
        return count;
    }

    countFaction(faction) {
        let count = 0;
        for (const ship of this.ships) if (ship.alive && ship.faction === faction && ship.targetable) count++;
        return count;
    }

    // ---- Player targeting ---------------------------------------------------------------

    setPlayerTarget(target) {
        if (!this.player || this.player.target === target) return;
        this.player.target = target;
        this.events.emit(GAME_EVENTS.TARGET_CHANGED, { target });
    }

    /** Steps through lockable hostiles by distance. `step` is +1 (next) or -1 (previous). */
    cycleTarget(step = 1) {
        const candidates = getLockCandidates(this);
        if (candidates.length === 0) {
            this.setPlayerTarget(null);
            return;
        }
        const index = candidates.indexOf(this.player.target);
        const next = (index + step + candidates.length) % candidates.length;
        this.setPlayerTarget(candidates[index === -1 ? 0 : next]);
    }

    targetNearestToCrosshair() {
        const target = findTargetNearCrosshair(this) ?? getLockCandidates(this)[0] ?? null;
        this.setPlayerTarget(target);
    }

    // ---- Beams --------------------------------------------------------------------------

    /** Queues a beam for this frame. `kind` is 'beam', 'lanceCharge', 'lance' or 'cannon'. */
    addBeam(start, end, color, width, kind) {
        const index = this.beams.length;
        const beam = this.beamPool[index] ?? (this.beamPool[index] = { start: new Vector3(), end: new Vector3(), color: '', width: 1, kind: 'beam' });
        beam.start.copy(start);
        beam.end.copy(end);
        beam.color = color;
        beam.width = width;
        beam.kind = kind;
        this.beams.push(beam);
    }

    /**
     * Starts a story-driven beam between two ships. It lasts `duration` seconds (Infinity =
     * until one of the ships is gone). `kind` picks the drawing style (see scene/BeamsLayer.jsx).
     */
    addScriptedBeam({ from, to, color, width, duration = Infinity, kind = 'cannon' }) {
        this.scriptedBeams.push({ from, to, color, width, kind, remaining: duration });
    }

    // ---- Simulation step ----------------------------------------------------------------

    /**
     * Advances the simulation.
     * @param {number} dt seconds since the previous step
     * @param {object} [controls] the player's current control state (see IDLE_CONTROLS)
     */
    update(dt, controls) {
        const step = Math.min(dt, WORLD.maxStep);
        this.time += step;
        this.lastStep = step;
        this.playerCannonLock = 0;
        if (controls) this.playerControls = controls;
        this.beams.length = 0;

        const player = this.player;
        if (player?.alive) {
            updatePlayerFlight(this, player, this.controlsLocked ? IDLE_CONTROLS : this.playerControls, step);
        }
        for (const ship of this.ships) {
            if (ship.alive && !ship.isPlayer) updateAI(this, ship, step);
        }
        for (const ship of this.ships) {
            if (!ship.alive) continue;
            if (ship.warpTimer > 0) this.advanceWarpIn(ship, step);
            if (ship.parent) this.followParent(ship);
            else if (!ship.arriving) ship.position.addScaledVector(ship.velocity, step);
        }
        for (const ship of this.ships) {
            updateShipWeapons(this, ship, step);
            regenerateShield(this, ship, step);
        }
        updateProjectiles(this, step);
        updateObstacles(this, step);
        this.updateScriptedBeams(step);
        resolvePlayerCollisions(this);
        this.removeDeparted(step);
        this.prune();
        this.keepPlayerTargetValid();
    }

    advanceWarpIn(ship, dt) {
        ship.warpTimer -= dt;
        if (ship.warpTimer > 0) return;
        ship.warpTimer = 0;
        this.events.emit(GAME_EVENTS.WARP_FLASH, { position: ship.position.clone(), size: ship.boundingRadius, quaternion: ship.quaternion.clone(), ship });
    }

    updateScriptedBeams(dt) {
        for (const beam of this.scriptedBeams) {
            beam.remaining -= dt;
            if (beam.from.alive && beam.to.alive) {
                this.addBeam(beam.from.position, beam.to.position, beam.color, beam.width, beam.kind);
            }
        }
        // A beam also ends when either ship it joins is gone.
        this.scriptedBeams = this.scriptedBeams.filter((beam) => beam.remaining > 0 && beam.from.alive && beam.to.alive);
    }

    /** Ships that were told to leave disappear when their timer runs out. */
    removeDeparted(dt) {
        for (const ship of [...this.ships]) {
            if (ship.despawnTimer == null) continue;
            ship.despawnTimer -= dt;
            if (ship.despawnTimer <= 0) this.removeShip(ship, { flash: true });
        }
    }

    prune() {
        // The player's wreck stays referenced by `this.player` so the camera has a place to be.
        if (this.ships.some((ship) => !ship.alive)) this.ships = this.ships.filter((ship) => ship.alive);
        if (this.projectiles.some((projectile) => !projectile.alive)) {
            this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
        }
    }

    keepPlayerTargetValid() {
        const player = this.player;
        if (!player?.alive) return;
        if (player.target && !isValidTarget(player.target)) {
            // The lock was destroyed: roll straight on to the nearest remaining hostile.
            this.setPlayerTarget(findNearestHostile(this, player));
        }
    }

    // ---- Checkpoints --------------------------------------------------------------------

    /** Captures everything a checkpoint needs to rebuild the scene later. */
    serialize() {
        const persistentShips = this.ships.filter((ship) => ship.alive && ship.persistent && !ship.isPlayer);
        return {
            sectorId: this.sectorId,
            player: this.player ? { hullFraction: this.player.hullFraction, classId: this.player.classId } : null,
            ships: persistentShips.map((ship) => ({
                classId: ship.classId,
                // Only differs from the class's for ships the story lends to another side (Lantern's guns).
                faction: ship.faction,
                callsign: ship.callsign,
                group: ship.group,
                tags: [...ship.tags],
                position: ship.position.toArray(),
                quaternion: ship.quaternion.toArray(),
                hullFraction: ship.hullFraction,
                maxShield: ship.maxShield,
                minHullFraction: ship.maxHull > 0 ? ship.minHull / ship.maxHull : 0,
                invulnerable: ship.invulnerable,
                targetable: ship.targetable,
                weaponsOnline: ship.weaponsOnline,
                aiMode: ship.ai.mode,
                parentTag: ship.parent ? [...ship.parent.tags][0] ?? null : null,
                mountOffset: ship.mountOffset ? ship.mountOffset.toArray() : null,
            })),
        };
    }

    /** Rebuilds the world from `serialize()` output. Enemies are not saved: the story respawns them. */
    restore(snapshot) {
        this.clear();
        const sector = this.setSector(snapshot.sectorId);
        const hullFraction = Math.max(PLAYER.checkpointMinHull, snapshot.player?.hullFraction ?? 1);
        // Saves from before ships were selectable have no class: they were all Kestrels.
        this.playerClassId = SHIP_CLASSES[snapshot.player?.classId] ? snapshot.player.classId : PLAYER.classId;
        this.spawnShip(this.playerClassId, { ...sector.playerStart, hullFraction });

        // Parents first, so mounted modules can find them.
        const ordered = [...snapshot.ships].sort((a, b) => Number(Boolean(a.parentTag)) - Number(Boolean(b.parentTag)));
        for (const saved of ordered) {
            const parent = saved.parentTag ? this.findByTag(saved.parentTag) : null;
            if (saved.parentTag && !parent) continue;
            this.spawnShip(saved.classId, {
                ...saved,
                persistent: true,
                shield: saved.maxShield,
                parent,
            });
        }
    }
}
