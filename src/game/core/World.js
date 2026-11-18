import { Vector3 } from 'three';
import { DIFFICULTY, DEFAULT_DIFFICULTY, PLAYER, WORLD } from '../config/gameConfig.js';
import { SECTORS } from '../config/sectors.js';
import { SHIP_CLASSES } from '../config/shipClasses.js';
import { EventBus, GAME_EVENTS } from './EventBus.js';
import { Ship } from './Ship.js';
import { createRng, lookRotation } from './math.js';
import { upgradedClass } from './refit.js';
import { updateAbility } from './systems/abilities.js';
import { updateAI } from './systems/aiPilot.js';
import { resolvePlayerCollisions } from './systems/collisions.js';
import { regenerateShield } from './systems/damage.js';
import { generateAsteroids, updateObstacles } from './systems/obstacles.js';
import { IDLE_CONTROLS, updatePlayerFlight } from './systems/playerFlight.js';
import { updateProjectiles } from './systems/projectiles.js';
import { findFriendlyUnderCrosshair, findNearestHostile, findTargetNearCrosshair, getLockCandidates, isValidTarget } from './systems/targeting.js';
import { createWeaponState, updateShipWeapons } from './systems/weapons.js';

const scratchVector = new Vector3();

/** A story beam is over once its time is up or either ship it joins is gone. */
const beamEnded = (beam) => !(beam.remaining > 0 && beam.from.alive && beam.to.alive);

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
        /**
         * Multiplayer: another pilot's ship the camera follows while the player's own is lost
         * (watching a comrade fly), or null. Only the view follows it; it is flown from elsewhere.
         * @type {Ship | null}
         */
        this.spectating = null;
        this.playerControls = IDLE_CONTROLS;
        /** True while the story has the helm (warp jumps, cut-scenes). */
        this.controlsLocked = false;
        /** Length (seconds) of the most recent simulation step; story timers use it. */
        this.lastStep = 0;
        /** Ship class the player flies (chosen on the title screen, restored from saves). */
        this.playerClassId = PLAYER.classId;
        /** Levels bought at refits ({ rating: levels }, core/refit.js); saved with the player. */
        this.playerUpgrades = {};
        /** Multiplayer: players can hurt the computer-flown ships of their own side (see mayAttack). */
        this.friendlyFire = false;
        /** Multiplayer: `(target, source, amount)` called for every bit of damage a ship deals, for whoever keeps the rules. */
        this.onDamage = null;
        /** 0..1 strength of the warp effect; driven by the story's warp beat. */
        this.warpFactor = 0;
        /** 0..1 how far the screen has faded to black (docking cut-scenes); driven by the story's fade beat. */
        this.screenFade = 0;
        /**
         * How a stargate in this world shows (scene/models/GatePortal.jsx), driven by the game
         * mode: `charge` 0..1 how strongly its field glows, `open` 0..1 how far the way through
         * has opened from the middle, `shut` 0..1 how far it has died, `pulse` 1 -> 0 after a
         * ship has gone through, `faction` whose colour it wears (null: its own).
         */
        this.gateField = { charge: 0, open: 0, shut: 0, pulse: 0, faction: null };
        /**
         * The black hole as it bears down on this place (scene/Singularity.jsx), driven by the
         * game mode: `size` 0 (not there) .. 1 (it fills the sky), and the `direction` it comes from.
         */
        this.singularity = { size: 0, direction: new Vector3(0, 0, -1) };
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
        this.spectating = null;
        this.controlsLocked = false;
        this.warpFactor = 0;
        this.screenFade = 0;
        Object.assign(this.gateField, { charge: 0, open: 0, shut: 0, pulse: 0, faction: null });
        this.singularity.size = 0;
    }

    /** Whether the local player is past the sector's edge (the HUD's warning). */
    get outOfBounds() {
        return Boolean(this.player?.outOfBounds);
    }

    /** Whether a ship-mounted cannon is on the local player: 0 no, 1 tracking, 2 locked. */
    get playerCannonLock() {
        return this.player?.cannonLock ?? 0;
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
     * @param {number} [options.warpSeconds] with `warpIn`: exact seconds until it lands (a copy of a ship already arriving elsewhere)
     * @param {number} [options.engageRange] AI: ignore hostiles further away than this until they attack (default: none)
     * @param {string} [options.pilotId] multiplayer: the player who flies this (player-class) ship
     * @param {boolean} [options.local] false for a player ship flown from another device; it never becomes `world.player`
     * @param {object} [options.upgrades] refit levels for a player ship (default: `world.playerUpgrades`)
     */
    spawnShip(classId, options = {}) {
        let cls = SHIP_CLASSES[classId];
        if (!cls) throw new Error(`Unknown ship class "${classId}"`);
        if (cls.behavior === 'player') cls = upgradedClass(classId, cls, options.upgrades ?? this.playerUpgrades);
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
        if (options.warpIn) this.beginWarpIn(ship, options.warpSeconds);

        this.ships.push(ship);
        if (ship.isPlayer && options.local !== false) this.player = ship;
        this.events.emit(GAME_EVENTS.SHIP_SPAWNED, { ship });
        return ship;
    }

    /**
     * Starts the warp-in sequence: for a moment the ship is a streak of light decelerating
     * towards its spot (drawn by scene/ShipsLayer.jsx); it cannot act or be hit until it lands.
     * Bigger ships take a little longer, and a random offset keeps a squadron from landing in unison.
     */
    beginWarpIn(ship, seconds = null) {
        ship.warpDuration = seconds ?? WORLD.warpInSeconds * (1 + Math.min(1, ship.boundingRadius / 800)) * (0.8 + this.rng() * 0.5);
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
        this.events.emit(GAME_EVENTS.SHIP_REMOVED, { ship, flash });
    }

    /**
     * Installs refit upgrades on the player's ship right away: its class is rebuilt with them and
     * hull and shields keep the same fraction of their (new) maximums.
     */
    setPlayerUpgrades(upgrades) {
        this.playerUpgrades = { ...upgrades };
        if (this.player?.alive) this.refitShip(this.player, this.playerUpgrades);
    }

    /** Rebuilds a player ship's class with `upgrades` (see setPlayerUpgrades); multiplayer refits go through here too. */
    refitShip(ship, upgrades) {
        const hullFraction = ship.hullFraction;
        const shieldFraction = ship.shieldFraction;
        ship.upgrades = { ...upgrades };
        ship.cls = upgradedClass(ship.classId, SHIP_CLASSES[ship.classId], ship.upgrades);
        ship.maxHull = ship.cls.hull;
        ship.hull = ship.maxHull * hullFraction;
        ship.maxShield = ship.cls.shield;
        ship.shield = ship.maxShield * shieldFraction;
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
    // `ship` is the player ship doing the locking; it defaults to the one flown on this device.

    setPlayerTarget(target, ship = this.player) {
        if (!ship || ship.target === target) return;
        ship.target = target;
        if (ship === this.player) this.events.emit(GAME_EVENTS.TARGET_CHANGED, { target });
    }

    /** Steps through lockable hostiles by distance. `step` is +1 (next) or -1 (previous). */
    cycleTarget(step = 1, ship = this.player) {
        if (!ship) return;
        const candidates = getLockCandidates(this, ship);
        if (candidates.length === 0) {
            this.setPlayerTarget(null, ship);
            return;
        }
        const index = candidates.indexOf(ship.target);
        const next = (index + step + candidates.length) % candidates.length;
        this.setPlayerTarget(candidates[index === -1 ? 0 : next], ship);
    }

    /** @param {Vector3} [forward] look along this direction instead of the ship's nose (VR gaze) */
    targetNearestToCrosshair(forward = null, ship = this.player) {
        if (!ship) return;
        const target = findTargetNearCrosshair(this, undefined, forward, ship)
            // Nothing hostile in the cone: with friendly fire on, a ship of one's own side dead
            // ahead can be locked - deliberately, never by cycling.
            ?? (this.friendlyFire ? findFriendlyUnderCrosshair(this, forward, ship) : null)
            ?? getLockCandidates(this, ship)[0] ?? null;
        this.setPlayerTarget(target, ship);
    }

    // ---- Beams --------------------------------------------------------------------------

    /**
     * Queues a beam for this frame. `kind` is 'beam', 'lanceCharge', 'lance' or 'cannon'.
     * `from` / `to` are the ships it leaves and lands on, when it has them: the drawing does
     * not need them, a multiplayer host sends them so other devices can pin the beam to the
     * same hulls.
     */
    addBeam(start, end, color, width, kind, from = null, to = null) {
        const index = this.beams.length;
        const beam = this.beamPool[index]
            ?? (this.beamPool[index] = { start: new Vector3(), end: new Vector3(), color: '', width: 1, kind: 'beam', from: null, to: null });
        beam.start.copy(start);
        beam.end.copy(end);
        beam.color = color;
        beam.width = width;
        beam.kind = kind;
        beam.from = from;
        beam.to = to;
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
        if (controls) this.playerControls = controls;
        this.beams.length = 0;

        // The ship flown on this device takes its helm from here; in a multiplayer match the
        // host sets `controls` on the other players' ships itself.
        if (this.player) {
            this.player.controls = this.playerControls;
            this.player.cannonLock = 0;
        }
        for (const ship of this.ships) {
            if (!ship.alive || !ship.isPlayer) continue;
            ship.cannonLock = 0;
            updateAbility(this, ship, step);
            updatePlayerFlight(this, ship, this.controlsLocked ? IDLE_CONTROLS : ship.controls ?? IDLE_CONTROLS, step);
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
                this.addBeam(beam.from.position, beam.to.position, beam.color, beam.width, beam.kind, beam.from, beam.to);
            }
        }
        // A beam also ends when either ship it joins is gone.
        if (this.scriptedBeams.some(beamEnded)) this.scriptedBeams = this.scriptedBeams.filter((beam) => !beamEnded(beam));
    }

    /** Ships that were told to leave disappear when their timer runs out. */
    removeDeparted(dt) {
        // Collected first and removed after, so the list is not changed while it is walked.
        let leaving = null;
        for (const ship of this.ships) {
            if (ship.despawnTimer == null) continue;
            ship.despawnTimer -= dt;
            if (ship.despawnTimer <= 0) (leaving ??= []).push(ship);
        }
        if (leaving) for (const ship of leaving) this.removeShip(ship, { flash: true });
    }

    prune() {
        // The player's wreck stays referenced by `this.player` so the camera has a place to be.
        if (this.ships.some((ship) => !ship.alive)) this.ships = this.ships.filter((ship) => ship.alive);
        if (this.projectiles.some((projectile) => !projectile.alive)) {
            this.projectiles = this.projectiles.filter((projectile) => projectile.alive);
        }
    }

    keepPlayerTargetValid() {
        for (const ship of this.ships) {
            if (!ship.isPlayer || !ship.alive) continue;
            if (ship.target && !isValidTarget(ship.target)) {
                // The lock was destroyed: roll straight on to the nearest remaining hostile.
                this.setPlayerTarget(findNearestHostile(this, ship), ship);
            }
        }
    }

    // ---- Checkpoints --------------------------------------------------------------------

    /** Captures everything a checkpoint needs to rebuild the scene later. */
    serialize() {
        const persistentShips = this.ships.filter((ship) => ship.alive && ship.persistent && !ship.isPlayer);
        return {
            sectorId: this.sectorId,
            player: this.player ? { hullFraction: this.player.hullFraction, classId: this.player.classId, upgrades: { ...this.playerUpgrades } } : null,
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
        this.playerUpgrades = { ...(snapshot.player?.upgrades ?? {}) };
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
