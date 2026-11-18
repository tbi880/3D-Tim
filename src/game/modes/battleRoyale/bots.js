import { Quaternion, Vector3 } from 'three';
import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { WEAPONS } from '../../config/weapons.js';
import { PLAYER_SHIPS, RATING_ORDER } from '../../config/playerShips.js';
import { clamp, forwardOf, randomUnitVector } from '../../core/math.js';
import { avoidObstacles } from '../../core/systems/aiPilot.js';
import { areHostile } from '../../core/systems/damage.js';
import { applyPilotAction } from '../../core/systems/pilotActions.js';
import { isValidTarget } from '../../core/systems/targeting.js';
import { playerBeamRange, playerTorpedoRange } from '../../core/systems/weapons.js';
import { JUMP_REFUSAL } from './battleRoyaleProtocol.js';
import { PLANET_STATUS } from './collapse.js';
import { EQUIPMENT } from './equipment.js';

/**
 * Computer-flown players for the battle royale (see BATTLE_ROYALE.bots).
 *
 * A bot is not a different kind of ship. The match server gives it a pilot's seat like a
 * person's (MatchServer.addBot) and the rules treat it as a contestant like any other; all
 * that is here is what a person's hands and head would do: every frame it sets the same
 * controls a device would send - stick, throttle, afterburner, triggers - and now and then
 * it asks the rules for the things a player asks for: a jump, a docking, a refit, a comeback -
 * and it presses its ship's ability button (config/abilities.js) when the moment suits it.
 * It can do nothing a player cannot, and its ship answers exactly as a player's would.
 */

const TUNING = BATTLE_ROYALE.bots;
/** Equipment a bot chooses from: the pieces that work by themselves. */
const BOT_EQUIPMENT = Object.freeze([EQUIPMENT.GRAVITY_SHIELD, EQUIPMENT.EMERGENCY_SHIELD]);
/** How hard the stick is pushed per unit of "off to the side" (1 = full deflection at 90 degrees). */
const STICK_GAIN = 2.6;
/** Metres from a point at which a bot flying to it eases off, and at which it has arrived. */
const SLOW_RADIUS = 500;
/** How far down the approach lane from the dock's mouth a bot lines up before flying in (metres). */
const DOCK_APPROACH = 550;

const scratchDesired = new Vector3();
const scratchLocal = new Vector3();
const scratchForward = new Vector3();
const scratchRandom = new Vector3();
const scratchInverse = new Quaternion();
const scratchPoint = new Vector3();

const between = (rng, [least, most]) => least + (most - least) * rng();
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/**
 * Seats bots in a match that is short of players. Call before sides are dealt, so the bots
 * are dealt in with everybody else.
 * @param {import('../../net/server/MatchServer.js').MatchServer} server
 * @param {object} settings the match's settings (`bots: 'none'` keeps the seats empty)
 * @param {() => number} rng 0..1
 * @returns {object[]} the bots' pilots
 */
export function seatBots(server, settings, rng) {
    if ((settings.bots ?? TUNING.defaultSetting) === 'none') return [];
    const names = [...TUNING.names];
    const pilots = [];
    for (let seat = server.pilots.size; seat < TUNING.fillTo && names.length > 0; seat++) {
        const [name] = names.splice(Math.floor(rng() * names.length), 1);
        pilots.push(server.addBot({ id: `bot:${pilots.length + 1}`, name: `${TUNING.namePrefix}${name}`, classId: pick(rng, PLAYER_SHIPS).classId }));
    }
    return pilots;
}

/** One bot's hands and head. */
export class BotPilot {
    /**
     * @param {object} mode the battle royale's rules (BattleRoyaleMode): what a player can ask of them, the bot asks through the same methods
     * @param {object} contestant the bot's own seat in those rules
     * @param {() => number} rng 0..1
     */
    constructor(mode, contestant, rng) {
        this.mode = mode;
        this.contestant = contestant;
        this.rng = rng;
        // Not all at once: each bot thinks on its own beat.
        this.thinkIn = rng() * TUNING.thinkInterval;
        /** What the bot is doing: { kind: 'attack', target } | { kind: 'evade', from } | { kind: 'dock' } | { kind: 'hold' }. */
        this.goal = { kind: 'hold' };
        /** Breaking away from a target that got too close: seconds left, and which way. */
        this.breakLeft = 0;
        this.breakDirection = new Vector3();
        /** The beams' burst: seconds left of this part of it, and whether it is the firing part. */
        this.burstLeft = 0;
        this.bursting = true;
        this.torpedoIn = between(rng, TUNING.torpedoPause);
        /** Seconds with nothing hostile in reach. */
        this.quietFor = 0;
        /** How far its breach warhead was from its target a frame ago (metres), to tell when it stops closing. */
        this.warheadGap = Infinity;
    }

    get pilot() {
        return this.contestant.pilot;
    }

    /** Once per server frame. */
    update(dt) {
        const { pilot } = this;
        const ship = pilot.ship;
        this.attendToChoices();
        if (!this.contestant.alive || !ship?.alive || ship.arriving || !pilot.zone) {
            this.release();
            return;
        }
        this.thinkIn -= dt;
        if (this.thinkIn <= 0 || !isValidTarget(this.goal.target ?? this.goal.from ?? ship)) {
            this.thinkIn = TUNING.thinkInterval;
            this.think(ship, pilot.zone.world);
        }
        this.fly(ship, pilot.zone.world, dt);
    }

    /** Lets go of everything (the ship is gone, or still dropping out of warp). */
    release() {
        const { controls } = this.pilot;
        controls.yaw = 0;
        controls.pitch = 0;
        controls.roll = 0;
        controls.boost = false;
        controls.firePrimary = false;
        controls.fireSecondary = false;
        controls.throttleTarget = 0;
    }

    // ---- What a player does in the windows: equipment, refits, coming back ---------------------

    attendToChoices() {
        const { mode, contestant, rng } = this;
        if (contestant.inventory.picks > 0) mode.pickEquipment(contestant, pick(rng, BOT_EQUIPMENT));
        if (contestant.alive && contestant.points > 0) mode.spendPoints(contestant, { [pick(rng, RATING_ORDER)]: 1 });
        // Shot down: back the moment the wait is over, at the station the rules would send it to anyway.
        if (!contestant.alive && contestant.respawnAt !== null && mode.server.time >= contestant.respawnAt && mode.holdsStation(contestant.faction)) {
            const [station] = mode.respawnStations(contestant);
            if (station && mode.respawnRefusal(contestant, station) === null) mode.respawn(contestant, station);
        }
    }

    // ---- Deciding ------------------------------------------------------------------------------

    think(ship, world) {
        const { mode, contestant } = this;
        const place = mode.placeOf(contestant);
        const enemy = this.nearestHostile(ship, world);
        this.quietFor = enemy ? 0 : this.quietFor + TUNING.thinkInterval;
        const mine = place.owner === contestant.faction;

        if (this.shouldLeave(place, mine)) {
            const outward = mode.map.planets[place.orbit + 1];
            if (outward && mode.jumpRefusal(contestant, outward.id) === null) {
                mode.requestJump(contestant, outward.id);
                return;
            }
        }
        if (contestant.dock) {
            // Docked and being shot to pieces: let go and fight. Otherwise sit it out.
            if (enemy && ship.shieldFraction < TUNING.undockShield) mode.undock(contestant);
            else return;
        }
        // In danger with no way out, the only shelter is the station's bubble: go for the dock whatever is shooting.
        const desperate = !mine && place.status !== PLANET_STATUS.SAFE;
        const dockIsClear = !enemy || enemy.position.distanceTo(place.station.mouth) > TUNING.dockClearRange;
        // Shot nearly bare: run until the shield is back, unless running is no use here.
        const running = this.goal.kind === 'evade';
        if (enemy && !desperate && ship.shieldFraction < (running ? TUNING.recoverShield : TUNING.retreatShield)) {
            this.goal = { kind: 'evade', from: enemy };
        } else if (!mine && (desperate || dockIsClear)) {
            this.goal = { kind: 'dock' };
        } else if (enemy) {
            if (this.goal.target !== enemy) world.setPlayerTarget(enemy, ship);
            this.goal = { kind: 'attack', target: enemy };
            if (contestant.summons > 0) mode.summon(contestant);
        } else {
            this.goal = { kind: 'hold' };
        }
    }

    /**
     * Time to jump outwards: the planet is falling in (or about to) and is not under the
     * bot's own bubble - or its side holds the station, all is quiet, and there is more to take.
     */
    shouldLeave(place, mine) {
        const { mode, contestant } = this;
        if (contestant.jump || place.orbit >= mode.map.count - 1) return false;
        if (!mine) {
            if (place.status === PLANET_STATUS.COLLAPSING) return true;
            if (place.status === PLANET_STATUS.SWALLOWED) return mode.jumpRefusal(contestant, mode.map.planets[place.orbit + 1].id) !== JUMP_REFUSAL.TRAPPED;
            const wait = mode.clock.secondsToChange(place.orbit);
            return wait !== null && wait < TUNING.fleeAhead;
        }
        // Its own side's planet, and quiet: on to the next - but not racing ahead of the collapse to the gate.
        const front = mode.map.planets.findIndex((planet) => mode.places.get(planet.id).status !== PLANET_STATUS.SWALLOWED);
        return this.quietFor >= TUNING.restSeconds && place.orbit - front < TUNING.maxAhead;
    }

    /**
     * The ship to fight: hostile, hurtable, and within reach - or whoever shot this ship last.
     * The nearest one, except that a fighter near enough comes before any big ship: a capital
     * ship's guns are no place to fly into while its escorts are still about.
     */
    nearestHostile(ship, world) {
        let best = null;
        let bestScore = Infinity;
        for (const other of world.ships) {
            if (!isValidTarget(other) || other.invulnerable || other.cls.kind === 'module' || !areHostile(ship, other)) continue;
            // Whoever shot this ship last counts at any distance; anybody else only within reach.
            const distance = other.distanceToPoint(ship.position, ship.lastAttacker === other ? Infinity : TUNING.engageRange);
            if (distance > TUNING.engageRange && ship.lastAttacker !== other) continue;
            const small = other.cls.kind === 'fighter' && distance < TUNING.fighterFirstRange;
            const score = small ? distance : distance + TUNING.engageRange;
            if (score < bestScore) {
                bestScore = score;
                best = other;
            }
        }
        return best;
    }

    // ---- Flying --------------------------------------------------------------------------------

    fly(ship, world, dt) {
        const { controls } = this.pilot;
        controls.firePrimary = false;
        controls.fireSecondary = false;
        controls.boost = false;
        controls.roll = 0;
        this.useAbility(ship, world);
        switch (this.goal.kind) {
            case 'attack': this.flyAttack(ship, world, controls, dt); break;
            case 'evade':
                // Straight away from the trouble, with everything the engines have.
                controls.boost = true;
                this.steer(ship, world, scratchDesired.copy(ship.position).sub(this.goal.from.position).normalize(), controls, 1, true);
                break;
            case 'dock': this.flyToDock(ship, world, controls); break;
            default:
                controls.yaw = 0;
                controls.pitch = 0;
                controls.throttleTarget = 0;
        }
    }

    /** An attack run: close in firing, break away when too close, come round again. */
    flyAttack(ship, world, controls, dt) {
        const { goal, rng } = this;
        const { target } = goal;
        const distance = target.distanceToPoint(ship.position);
        this.burstLeft -= dt;
        this.torpedoIn -= dt;
        if (this.burstLeft <= 0) {
            this.bursting = !this.bursting;
            this.burstLeft = TUNING.burst[this.bursting ? 0 : 1] * (0.7 + rng() * 0.6);
        }

        if (this.breakLeft > 0) {
            this.breakLeft -= dt;
            // Running with the shield going: that is what the afterburner is for.
            controls.boost = ship.shieldFraction < 0.5;
            this.steer(ship, world, scratchDesired.copy(this.breakDirection), controls, 1, true);
            return;
        }
        if (distance < TUNING.breakDistance) {
            this.breakLeft = between(rng, TUNING.breakSeconds);
            forwardOf(ship.quaternion, scratchForward);
            randomUnitVector(rng, scratchRandom);
            this.breakDirection.copy(ship.position).sub(target.position).normalize().multiplyScalar(0.35)
                .addScaledVector(scratchRandom, 0.9).addScaledVector(scratchForward, 0.7).normalize();
            return;
        }

        scratchDesired.copy(target.position).sub(ship.position).normalize();
        forwardOf(ship.quaternion, scratchForward);
        const offAxis = scratchForward.angleTo(scratchDesired);
        const beam = ship.weapons.find((weapon) => weapon.def.type === 'beam');
        const torpedoes = ship.weapons.find((weapon) => weapon.def.type === 'torpedo');
        // The beams find their own mark inside their arc: the bot only has to point roughly and hold the trigger.
        // (The Shrike's lance is fired with the same trigger, in the same bursts; it does not run dry.)
        if (beam && this.bursting && (!beam.depleted || ship.effect('lance')) && distance < playerBeamRange(ship, beam.def) * 0.95 && offAxis < (beam.def.arcDeg * Math.PI) / 180 * 0.8) {
            controls.firePrimary = true;
        }
        if (torpedoes && torpedoes.ammo > 0 && this.torpedoIn <= 0 && ship.target === target
            && distance < playerTorpedoRange(ship, torpedoes.def) * 0.8 && offAxis < 0.3) {
            controls.fireSecondary = true;
            this.torpedoIn = between(rng, TUNING.torpedoPause);
        }
        this.steer(ship, world, scratchDesired, controls, distance > 900 ? 1 : 0.65, true);
    }

    // ---- The ability button -------------------------------------------------------------------

    /**
     * Presses the ship's ability button when a person would: the dash and the cloak to get out
     * of trouble, the breach torpedo at a target whose shield is worth taking down (and again to
     * set it off beside a target it is about to miss), the lance with a target in front of it.
     */
    useAbility(ship, world) {
        const ability = ship.ability;
        // Docked, the ship is not the bot's to throw about (as for a person: MatchServer).
        if (!ability || this.pilot.helmHeld || world.controlsLocked) return;
        const press = () => applyPilotAction(world, ship, 'ability');
        const tuning = TUNING.ability;
        const { goal } = this;
        const { kind } = ability.def;

        if (ability.projectile?.alive) {
            const warhead = ability.projectile;
            const mark = warhead.target;
            const gap = mark?.alive ? mark.distanceToPoint(warhead.position) : Infinity;
            if (gap < tuning.detonateWithin && gap >= this.warheadGap) press();
            this.warheadGap = gap;
            return;
        }
        this.warheadGap = Infinity;
        if (ability.cooldown > 0 || ability.active > 0) return;

        if (kind === 'overdrive' || kind === 'cloak') {
            const running = goal.kind === 'evade' || (goal.kind === 'attack' && this.breakLeft > 0);
            if (running && ship.shieldFraction < tuning.dashShield) press();
            return;
        }
        const target = goal.kind === 'attack' ? goal.target : null;
        if (!target || ship.target !== target || this.breakLeft > 0) return;
        const distance = target.distanceToPoint(ship.position);
        forwardOf(ship.quaternion, scratchForward);
        const offAxis = scratchForward.angleTo(scratchPoint.copy(target.position).sub(ship.position));
        if (kind === 'torpedo') {
            const def = WEAPONS[ability.def.weapon];
            if (target.maxShield > 0 && target.shieldFraction >= tuning.torpedoShield && !target.invulnerable
                && distance < playerTorpedoRange(ship, def) * tuning.torpedoRange && offAxis < tuning.torpedoOffAxis) press();
        } else if (kind === 'lance') {
            if (distance < tuning.lanceRange && offAxis < tuning.lanceOffAxis) press();
        }
    }

    /** To the station's dock: line up on the approach lane, fly into the mouth, clamp on. */
    flyToDock(ship, world, controls) {
        const { mode, contestant } = this;
        if (contestant.dock) {
            controls.yaw = 0;
            controls.pitch = 0;
            controls.throttleTarget = 0;
            return;
        }
        const { station } = mode.placeOf(contestant);
        if (station.inRange(ship.position)) {
            mode.requestDock(contestant);
            return;
        }
        // The lane runs from out in the ring to the door; a ship beside or behind the door first goes out to the lane.
        const lane = scratchForward.copy(station.mouth).sub(station.berth).normalize();
        const alongLane = scratchPoint.copy(station.mouth).sub(ship.position).dot(lane);
        const offLane = scratchPoint.copy(ship.position).sub(station.mouth).addScaledVector(lane, alongLane).length();
        const linedUp = alongLane > 0 && offLane < Math.max(120, alongLane * 0.5);
        const goTo = linedUp ? station.mouth : scratchPoint.copy(station.mouth).addScaledVector(lane, -DOCK_APPROACH);
        const distance = ship.position.distanceTo(goTo);
        scratchDesired.copy(goTo).sub(ship.position).normalize();
        controls.boost = distance > 2500 && ship.boost > 0.5;
        // On the last stretch the hull beside the door is not something to shy away from.
        this.steer(ship, world, scratchDesired, controls, distance > SLOW_RADIUS ? 1 : 0.4, !linedUp || distance > SLOW_RADIUS);
    }

    /**
     * Turns the stick towards `desired` (a unit direction; changed here) and sets the throttle.
     * With `avoid` the direction is first bent away from hulls and rocks, as the computer-flown
     * fleets' pilots do.
     */
    steer(ship, world, desired, controls, throttle, avoid) {
        if (avoid) avoidObstacles(world, ship, desired);
        scratchLocal.copy(desired).normalize().applyQuaternion(scratchInverse.copy(ship.quaternion).invert());
        // The nose is the ship's -z: a mark behind it (local z > 0) needs a hard turn, not a nudge.
        const behind = scratchLocal.z > 0;
        controls.yaw = behind ? (scratchLocal.x >= 0 ? 1 : -1) : clamp(scratchLocal.x * STICK_GAIN, -1, 1);
        controls.pitch = clamp(scratchLocal.y * STICK_GAIN, -1, 1);
        // A ship turning hard around slows down: it turns in less room.
        controls.throttleTarget = behind ? Math.min(throttle, 0.5) : throttle;
    }
}
