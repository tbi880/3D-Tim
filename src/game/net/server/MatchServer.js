import { Vector3 } from 'three';
import { WORLD } from '../../config/gameConfig.js';
import { applyPilotAction } from '../../core/systems/pilotActions.js';
import { IDLE_CONTROLS } from '../../core/systems/playerFlight.js';
import { ClientGuard } from '../ClientGuard.js';
import { createControls } from '../codec/inputPacket.js';
import { NET } from '../netConfig.js';
import { MSG, WORLD_EVENT } from '../protocol.js';
import { Zone } from './Zone.js';

const STATE_INTERVAL = 0.25;
const scratchForward = new Vector3();
const defaultNow = () => performance.now() / 1000;

/** One player of the match, as the server keeps track of them. What the game mode knows about them is the mode's own. */
class Pilot {
    constructor(player) {
        this.id = player.id;
        this.name = player.name;
        this.classId = player.classId;
        /** Refit levels of their ship ({ rating: levels }); starts as what their account brought. */
        this.upgrades = { ...player.upgrades };
        /** The ship they are flying, or null while they have none. */
        this.ship = null;
        /** The zone they are in (and are told about), or null before the mode has placed them. */
        this.zone = null;
        /** True once they have left the match (left the room, lost the link, or were dropped). */
        this.gone = false;

        this.link = null;
        this.guard = null;
        /** True once their device has asked for the world. */
        this.joined = false;
        /** Their device must be sent the whole zone before anything else (it joined, or they changed zone). */
        this.needsWelcome = false;
        /** Counts welcomes, so their device can tell which place a snapshot belongs to. */
        this.epoch = 0;
        this.controls = createControls();
        this.autoFire = false;
        this.lastInputAt = -Infinity;
        this.snapshotSeq = 0;
        /** Events for this player alone (already JSON), sent with the next batch. */
        this.outbox = [];
    }

    /** Records an event for this player alone. */
    tell(...entry) {
        this.outbox.push(JSON.stringify(entry));
    }
}

/**
 * The one real simulation of a multiplayer match. It runs on the host's device (and, with
 * nothing changed, could run on a server): it has no screen, no sound and no player of its
 * own. Every player, the host included, reaches it over a link.
 *
 * What it does, whatever the game mode:
 *  - flies each player's ship from the controls that player's device sends - controls only;
 *    devices never report positions, damage or kills, and what they do send goes through a
 *    ClientGuard first;
 *  - simulates every zone that has players in it;
 *  - tells each device what happens where its player is: a snapshot of where everything is
 *    many times a second, and a reliable list of events (spawns, hits, kills).
 *
 * What the match is about - who is on which side, what they fight over, who wins - is the
 * game mode's (modes/index.js). The mode uses the services at the bottom of this class.
 */
export class MatchServer {
    /**
     * @param {object} params
     * @param {object} params.info the match as normalizeMatchInfo returns it
     * @param {object} params.mode the game mode's rules (see modes/index.js)
     * @param {() => number} [params.now] clock in seconds (for input timeouts and rate limits)
     */
    constructor({ info, mode, now = defaultNow }) {
        this.info = info;
        this.mode = mode;
        this.now = now;
        /** @type {Map<string, Pilot>} */
        this.pilots = new Map(info.players.map((player) => [player.id, new Pilot(player)]));
        /** @type {Map<string, Zone>} */
        this.zones = new Map();
        this.time = 0;
        this.snapshotTimer = 0;
        this.stateTimer = 0;
        this.started = false;
    }

    // ---- Running the match -------------------------------------------------------------------

    start() {
        if (this.started) return;
        this.started = true;
        this.mode.setup(this);
    }

    update(frameSeconds) {
        // The same cap the worlds use: after a stall (the host's page was in the background) the
        // match picks up where it was instead of leaping ahead of its own ships.
        const dt = Math.min(frameSeconds, WORLD.maxStep);
        const now = this.now();
        for (const pilot of this.pilots.values()) {
            const ship = pilot.ship;
            if (!ship?.alive) continue;
            // A player we have not heard from flies straight on: nobody is holding the stick.
            const silent = now - pilot.lastInputAt > NET.inputTimeout;
            ship.controls = silent ? IDLE_CONTROLS : pilot.controls;
            ship.autoFire = pilot.autoFire && !silent;
        }

        this.time += dt;
        for (const zone of this.zones.values()) {
            if (zone.active) zone.world.update(dt);
        }
        this.mode.update(dt);

        this.stateTimer -= dt;
        if (this.stateTimer <= 0) this.publishState();
        this.flush();
        this.sendSnapshots(dt);
    }

    dispose() {
        for (const pilot of this.pilots.values()) this.releaseLink(pilot);
        for (const zone of this.zones.values()) zone.dispose();
        this.mode.dispose?.();
    }

    // ---- Links to the players' devices -------------------------------------------------------

    /** Gives the match the link to a player's device. Links of players who are not in this match are refused. */
    attachLink(playerId, link) {
        const pilot = this.pilots.get(playerId);
        if (!pilot || pilot.gone) return false;
        this.releaseLink(pilot);
        pilot.link = link;
        pilot.guard = new ClientGuard(this.now);
        link.onState = (data) => this.onInput(pilot, data);
        link.onMessage = (text) => this.onMessage(pilot, text);
        link.onClose = () => this.removePlayer(pilot.id);
        return true;
    }

    releaseLink(pilot) {
        const { link } = pilot;
        if (!link) return;
        link.onState = null;
        link.onMessage = null;
        link.onClose = null;
        pilot.link = null;
        pilot.joined = false;
        pilot.needsWelcome = false;
    }

    /** A player is out of the match (left the room, lost the link, misbehaved): their ship jumps away. */
    removePlayer(playerId) {
        const pilot = this.pilots.get(playerId);
        if (!pilot || pilot.gone) return;
        pilot.gone = true;
        this.releaseLink(pilot);
        if (pilot.ship?.alive) pilot.zone?.world.removeShip(pilot.ship, { flash: true });
        pilot.ship = null;
        pilot.zone?.viewers.delete(pilot);
        this.mode.onPlayerLeft?.(pilot);
        this.publishState();
    }

    onInput(pilot, data) {
        const input = pilot.guard.acceptInput(data);
        if (!input) {
            this.dropIfBanned(pilot);
            return;
        }
        Object.assign(pilot.controls, input.controls);
        pilot.autoFire = input.autoFire;
        pilot.lastInputAt = this.now();
    }

    onMessage(pilot, text) {
        const message = pilot.guard.acceptMessage(text);
        if (!message) {
            this.dropIfBanned(pilot);
            return;
        }
        switch (message.t) {
            case MSG.HELLO:
                if (message.v !== NET.protocolVersion || message.m !== this.info.matchId) {
                    pilot.link.sendMessage(JSON.stringify({ t: MSG.REFUSED, reason: message.v !== NET.protocolVersion ? 'version' : 'match' }));
                    return;
                }
                // Answered at the end of the frame, when the world and the event list agree.
                pilot.joined = true;
                pilot.needsWelcome = true;
                return;
            case MSG.ACTION:
                if (!pilot.joined || !pilot.ship?.alive || pilot.zone.world.controlsLocked) return;
                if (applyPilotAction(pilot.zone.world, pilot.ship, message.a, { forward: message.f ? scratchForward.fromArray(message.f) : null })) {
                    pilot.tell(WORLD_EVENT.STAGE, 'playCue', 'power');
                }
                return;
            case MSG.REQUEST:
                if (pilot.joined) this.mode.onRequest(pilot, message.k, message.d ?? {});
                return;
            case MSG.PING:
                pilot.link.sendMessage(JSON.stringify({ t: MSG.PONG, n: message.n }));
                return;
            default:
        }
    }

    dropIfBanned(pilot) {
        if (!pilot.guard.banned) return;
        const { link } = pilot;
        this.removePlayer(pilot.id);
        link?.close();
    }

    // ---- Telling the devices what happened ---------------------------------------------------

    /** Sends this frame's events to every device, then the whole zone to those that need it. */
    flush() {
        for (const pilot of this.pilots.values()) {
            const open = pilot.joined && pilot.link?.isOpen;
            // A device about to be sent a whole zone gets nothing from the zone it has: what it
            // has is the old one, and the new one arrives complete.
            const shared = pilot.zone && !pilot.needsWelcome ? pilot.zone.frameEvents : [];
            if (open && (shared.length > 0 || pilot.outbox.length > 0)) {
                pilot.link.sendMessage(`{"t":"${MSG.BATCH}","e":[${shared.concat(pilot.outbox).join(',')}]}`);
            }
            pilot.outbox.length = 0;
        }
        for (const zone of this.zones.values()) zone.frameEvents.length = 0;

        for (const pilot of this.pilots.values()) {
            if (!pilot.needsWelcome || !pilot.zone || !pilot.link?.isOpen) continue;
            pilot.needsWelcome = false;
            pilot.epoch = (pilot.epoch + 1) & 0xff;
            pilot.link.sendMessage(JSON.stringify({
                t: MSG.WELCOME,
                v: NET.protocolVersion,
                matchId: this.info.matchId,
                you: pilot.id,
                epoch: pilot.epoch,
                ...pilot.zone.describe(),
                match: this.mode.describeState(pilot),
            }));
        }
    }

    sendSnapshots(dt) {
        this.snapshotTimer -= dt;
        if (this.snapshotTimer > 0) return;
        // Keep the remainder, so the rate holds whatever the frame rate.
        this.snapshotTimer = Math.max(0, this.snapshotTimer + 1 / NET.snapshotHz);
        const captured = new Set();
        for (const pilot of this.pilots.values()) {
            const { zone } = pilot;
            if (!zone || !pilot.joined || pilot.needsWelcome || !pilot.link?.isOpen) continue;
            if (!captured.has(zone)) {
                zone.encoder.captureWorld(zone.world);
                captured.add(zone);
            }
            pilot.snapshotSeq += 1;
            pilot.link.sendState(zone.encoder.packetFor(pilot.epoch, pilot.snapshotSeq, pilot.guard.lastSeq, pilot.ship?.alive ? pilot.ship : null));
        }
    }

    // ---- Services for the game mode ----------------------------------------------------------

    /** Adds a place to the match. `options` are Zone's. */
    addZone(id, sectorId, options) {
        const zone = new Zone(id, sectorId, options);
        zone.listen({
            onShipDestroyed: (where, ship, killer) => {
                const pilot = ship.pilotId != null ? this.pilots.get(ship.pilotId) : null;
                if (pilot?.ship === ship) pilot.ship = null;
                this.mode.onShipDestroyed(where, ship, killer);
            },
            onPlayerCollision: (where, ship, speed) => this.pilots.get(ship.pilotId)?.tell(WORLD_EVENT.BUMP, speed),
        });
        zone.world.onDamage = (target, source, amount) => this.mode.onDamage?.(zone, target, source, amount);
        this.zones.set(id, zone);
        return zone;
    }

    /** Makes `zone` the place a pilot is in and is told about (their device is sent it whole). */
    moveToZone(pilot, zone) {
        if (pilot.zone === zone) return;
        pilot.zone?.viewers.delete(pilot);
        pilot.zone = zone;
        zone.viewers.add(pilot);
        if (pilot.joined) pilot.needsWelcome = true;
    }

    /**
     * Puts a pilot in a new ship in `zone` (and moves them there).
     * @param {object} options World.spawnShip options: position, facing, faction, warpIn, hullFraction...
     */
    spawnPilotShip(pilot, zone, options = {}) {
        this.moveToZone(pilot, zone);
        pilot.ship = zone.world.spawnShip(pilot.classId, {
            callsign: pilot.name,
            ...options,
            pilotId: pilot.id,
            upgrades: pilot.upgrades,
            // The server has no player of its own.
            local: false,
        });
        return pilot.ship;
    }

    /** Installs refit levels on a pilot's ship, now and for every ship they fly after it. */
    refitPilot(pilot, upgrades) {
        pilot.upgrades = { ...upgrades };
        const ship = pilot.ship;
        if (!ship?.alive) return;
        pilot.zone.world.refitShip(ship, pilot.upgrades);
        pilot.zone.share(WORLD_EVENT.REFIT, ship.id, pilot.upgrades);
    }

    /** Changes the side a ship is on, for everybody who can see it. */
    setShipFaction(zone, ship, faction) {
        ship.faction = faction;
        // Whatever was locked on it or by it was chosen under the old allegiance.
        ship.target = null;
        zone.share(WORLD_EVENT.FACTION, ship.id, faction);
    }

    /** Sends every player their match state now instead of at the next regular update. */
    publishState() {
        this.stateTimer = STATE_INTERVAL;
        for (const pilot of this.pilots.values()) {
            if (pilot.joined && !pilot.gone) pilot.tell(WORLD_EVENT.MATCH, this.mode.describeState(pilot));
        }
    }
}
