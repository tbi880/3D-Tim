import { Vector3 } from 'three';
import { WORLD } from '../../config/gameConfig.js';
import { isPlayerShip } from '../../config/playerShips.js';
import { applyPilotAction } from '../../core/systems/pilotActions.js';
import { IDLE_CONTROLS } from '../../core/systems/playerFlight.js';
import { ClientGuard } from '../ClientGuard.js';
import { createControls } from '../codec/inputPacket.js';
import { NET } from '../netConfig.js';
import { cleanUpgrades } from '../match/matchInfo.js';
import { MSG, WORLD_EVENT } from '../protocol.js';
import { captureZone, restoreZone } from './checkpoint.js';
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
        /** True once they have left the match (left the room, lost the link for good, or were dropped). */
        this.gone = false;
        /**
         * While their link is lost but their place is kept (see MatchServer's `rejoinGrace`): the
         * time (server clock) at which they are out of the match unless their device is back. Null otherwise.
         */
        this.awayUntil = null;
        /** Set by the game mode while it has their ship in hand (docked, say): their controls are ignored. */
        this.helmHeld = false;
        /**
         * True for a computer-flown player (see MatchServer.addBot): a pilot with nobody's device
         * behind it. Whoever added it writes `controls`, as a device's packets would.
         */
        this.bot = false;

        this.link = null;
        this.guard = null;
        /** True once their device has asked for the world. */
        this.joined = false;
        /** Their device must be sent the whole zone before anything else (it joined, or they changed zone). */
        this.needsWelcome = false;
        /** Counts welcomes, so their device can tell which place a snapshot belongs to. */
        this.epoch = 0;
        /** What their device says of its fitness to host: { stepCost, rtt: { playerId: ms } }, or null (see MSG.LINKS). */
        this.fitness = null;
        this.controls = createControls();
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
 *
 * Which device this runs on is chosen when the match starts, and it is not the match's only
 * chance: every few seconds the server writes the whole match down (`capture`) for the
 * devices next in line, and if this device is lost one of them makes a new MatchServer from
 * that checkpoint and the match goes on (net/README.md, "The host").
 */
export class MatchServer {
    /**
     * @param {object} params
     * @param {object} params.info the match as normalizeMatchInfo returns it
     * @param {object} params.mode the game mode's rules (see modes/index.js)
     * @param {() => number} [params.now] clock in seconds (for input timeouts and rate limits)
     * @param {string} [params.hostPlayerId] the player whose device this is (default: the match's first host)
     * @param {object} [params.checkpoint] a checkpoint of this match from its previous host (see `capture`):
     *        the match goes on from it instead of starting
     * @param {number} [params.term] 0 for the match's first host, one more for every device that has taken it over
     * @param {number} [params.rejoinGrace] seconds a player whose link closes keeps their ship and their place, for
     *        their device to come back on a new link (NET.rejoinGrace across the internet); 0: they are out at once
     */
    constructor({ info, mode, now = defaultNow, hostPlayerId = info.hostPlayerId, checkpoint = null, term = 0, rejoinGrace = 0 }) {
        this.info = info;
        this.mode = mode;
        this.now = now;
        this.hostPlayerId = hostPlayerId;
        this.checkpoint = checkpoint;
        this.term = term;
        /** Player ids, the next host first (see `rankSuccessors`); what was last told to the devices. */
        this.succession = info.succession.filter((id) => id !== hostPlayerId);
        this.checkpointTimer = 0;
        this.checkpointSeq = 0;
        this.rejoinGrace = rejoinGrace;
        /**
         * Called every NET.serverSnapshotInterval seconds when set: the device sends the lobby
         * server a snapshot (`capture`) - across the internet the server is the referee of who runs the match.
         */
        this.onSnapshotDue = null;
        this.snapshotDueTimer = 0;
        /** Called with (fromPlayerId, term, hostPlayerId) when a device announces that it has taken the match over. */
        this.onTakeover = null;
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
        if (this.checkpoint) this.resume(this.checkpoint);
        else this.mode.setup(this);
        this.checkpoint = null;
    }

    /** True when the game mode can hand a match on to another device (it has `saveState` and `restoreState`). */
    get canMigrate() {
        return typeof this.mode.saveState === 'function' && typeof this.mode.restoreState === 'function';
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
            // Nor is anybody while the game mode has the ship in hand. (A bot's controls are
            // written here on the server every frame: there is nothing to hear from.)
            const handsOff = pilot.helmHeld || (!pilot.bot && now - pilot.lastInputAt > NET.inputTimeout);
            ship.controls = handsOff ? IDLE_CONTROLS : pilot.controls;
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
        this.checkpointTimer -= dt;
        if (this.checkpointTimer <= 0) {
            this.checkpointTimer = NET.checkpointInterval;
            this.provideForSuccession();
        }
        if (this.onSnapshotDue) {
            this.snapshotDueTimer -= dt;
            if (this.snapshotDueTimer <= 0) {
                this.snapshotDueTimer = NET.serverSnapshotInterval;
                this.onSnapshotDue();
            }
        }
        this.dropOverdue(now);
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
        if (!pilot || pilot.gone || pilot.bot) return false;
        this.releaseLink(pilot);
        pilot.link = link;
        pilot.awayUntil = null;
        pilot.guard = new ClientGuard(this.now);
        link.onState = (data) => this.onInput(pilot, data);
        link.onMessage = (text) => this.onMessage(pilot, text);
        link.onClose = () => this.linkLost(pilot.id);
        return true;
    }

    /**
     * A player's link is gone. Without `rejoinGrace` that is the end of them in this match.
     * With it they are away: their ship stays where it is, flying on with nobody at the helm,
     * and a new link from their device (`attachLink`) puts them back in it - unless the grace
     * runs out first. Across the internet a link that breaks is far more often a network
     * catching its breath than a player gone, and a side that loses its player for a moment
     * should not lose the match for it.
     */
    linkLost(playerId) {
        const pilot = this.pilots.get(playerId);
        if (!pilot || pilot.gone) return;
        if (this.rejoinGrace <= 0) {
            this.removePlayer(playerId);
            return;
        }
        this.releaseLink(pilot);
        pilot.awayUntil ??= this.now() + this.rejoinGrace;
    }

    /** Players away longer than the grace are out. */
    dropOverdue(now) {
        if (this.rejoinGrace <= 0) return;
        for (const pilot of this.pilots.values()) {
            if (pilot.awayUntil !== null && !pilot.link && now >= pilot.awayUntil) this.removePlayer(pilot.id);
        }
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
        pilot.awayUntil = null;
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
            case MSG.ACTION: {
                if (!pilot.joined || !pilot.ship?.alive || pilot.zone.world.controlsLocked) return;
                // A ship the game mode has in hand (docked, say) is not the pilot's to throw about.
                if (message.a === 'ability' && pilot.helmHeld) return;
                const cue = applyPilotAction(pilot.zone.world, pilot.ship, message.a, { forward: message.f ? scratchForward.fromArray(message.f) : null });
                if (cue) pilot.tell(WORLD_EVENT.STAGE, 'playCue', cue);
                return;
            }
            case MSG.REQUEST:
                if (pilot.joined) this.mode.onRequest(pilot, message.k, message.d ?? {});
                return;
            case MSG.PING:
                pilot.link.sendMessage(JSON.stringify({ t: MSG.PONG, n: message.n }));
                return;
            case MSG.LINKS:
                pilot.fitness = { stepCost: message.stepCost, rtt: message.rtt };
                return;
            case MSG.TAKEOVER:
                // Another device says it runs this match now. Whether to believe it is the controller's business.
                this.onTakeover?.(pilot.id, message.n, message.h);
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
            const own = pilot.ship?.alive ? pilot.ship : null;
            pilot.link.sendState(zone.encoder.packetFor(pilot.epoch, pilot.snapshotSeq, pilot.guard.lastSeq, own, own ? null : this.watchedShipOf(pilot)));
        }
    }

    /**
     * The ship whose instruments a player without a ship of their own is sent with each
     * snapshot: that of the pilot the game mode has them watching (`watchedPilot`), as long as
     * it flies in the place the player is told about. Null otherwise.
     */
    watchedShipOf(pilot) {
        const watched = this.mode.watchedPilot?.(pilot) ?? null;
        return watched && watched !== pilot && watched.zone === pilot.zone && watched.ship?.alive ? watched.ship : null;
    }

    // ---- Handing the match on ----------------------------------------------------------------

    /**
     * The whole match as plain data: enough for another device to go on from if this one is
     * lost (pass it to a new MatchServer as `checkpoint`).
     */
    capture() {
        return {
            v: NET.protocolVersion,
            matchId: this.info.matchId,
            time: this.time,
            pilots: [...this.pilots.values()].map((pilot) => ({
                id: pilot.id, name: pilot.name, classId: pilot.classId, upgrades: pilot.upgrades, bot: pilot.bot, gone: pilot.gone, zone: pilot.zone?.id ?? null,
            })),
            zones: Object.fromEntries([...this.zones].map(([id, zone]) => [id, captureZone(zone)])),
            mode: this.mode.saveState(),
        };
    }

    /** Goes on from a checkpoint: the pilots as they were, then the mode rebuilds its places and its own state. */
    resume(checkpoint) {
        if (checkpoint?.v !== NET.protocolVersion || checkpoint.matchId !== this.info.matchId) throw new Error('This checkpoint is not of this match');
        this.time = Number.isFinite(checkpoint.time) ? Math.max(0, checkpoint.time) : 0;
        for (const saved of Array.isArray(checkpoint.pilots) ? checkpoint.pilots : []) {
            let pilot = this.pilots.get(saved?.id);
            // Bots are not in the lobby's list of players: they come back from the checkpoint.
            if (!pilot && saved?.bot === true && typeof saved.id === 'string' && isPlayerShip(saved.classId)) {
                pilot = this.addBot({ id: saved.id, name: String(saved.name ?? '').slice(0, 40), classId: saved.classId });
            }
            if (!pilot) continue;
            pilot.upgrades = cleanUpgrades(saved.upgrades);
            pilot.gone = Boolean(saved.gone);
        }
        this.mode.restoreState(this, checkpoint);
        // A player who is down stays where they were watching from (their ship's place came back with the ship).
        for (const saved of Array.isArray(checkpoint.pilots) ? checkpoint.pilots : []) {
            const pilot = this.pilots.get(saved?.id);
            const zone = typeof saved?.zone === 'string' ? this.zones.get(saved.zone) : null;
            if (pilot && zone && !pilot.bot && !pilot.gone && !pilot.zone) this.moveToZone(pilot, zone);
        }
    }

    /**
     * Rebuilds a place from a checkpoint (for the game mode's `restoreState`): the zone as `addZone`
     * makes it, with the checkpoint's ships in it and each pilot back in their own.
     */
    restoreZone(id, sectorId, options, data) {
        const zone = this.addZone(id, sectorId, options);
        for (const ship of restoreZone(zone, data)) {
            if (ship.pilotId == null) continue;
            const pilot = this.pilots.get(ship.pilotId);
            // A player's ship with no player to fly it (none of that name, one who has left, a second ship) is not kept.
            if (!pilot || pilot.gone || pilot.ship) {
                zone.world.removeShip(ship);
                continue;
            }
            pilot.ship = ship;
            this.moveToZone(pilot, zone);
        }
        return zone;
    }

    /**
     * The devices that could take the match over, best first. A good next host is linked to
     * all the others with short round trips and simulates fast (what each device reports with
     * MSG.LINKS); devices that have reported nothing keep the order the lobby server gave them.
     */
    rankSuccessors() {
        const candidates = [...this.pilots.values()].filter((pilot) => !pilot.bot && !pilot.gone && pilot.id !== this.hostPlayerId && pilot.link?.isOpen);
        const rtt = (from, to) => from.fitness?.rtt[to.id] ?? to.fitness?.rtt[from.id] ?? null;
        const scored = candidates.map((pilot) => {
            const others = candidates.filter((other) => other !== pilot).map((other) => rtt(pilot, other));
            const average = others.length === 0 ? 0 : others.reduce((sum, ms) => sum + (ms ?? NET.unlinkedRtt), 0) / others.length;
            const given = this.info.succession.indexOf(pilot.id);
            return {
                id: pilot.id,
                unlinked: others.filter((ms) => ms === null).length,
                score: average + (pilot.fitness?.stepCost ?? 0) * NET.stepCostWeight,
                given: given === -1 ? Infinity : given,
            };
        });
        scored.sort((a, b) => a.unlinked - b.unlinked || a.score - b.score || a.given - b.given);
        return scored.map((entry) => entry.id);
    }

    /**
     * Tells every device who is next in line, and sends those at the head of the line a
     * checkpoint to go on from. Without both a lost host is a lost match.
     */
    provideForSuccession() {
        if (!this.canMigrate) return;
        this.succession = this.rankSuccessors();
        const order = JSON.stringify({ t: MSG.SUCCESSION, o: this.succession, n: this.term });
        for (const pilot of this.pilots.values()) {
            if (pilot.joined && pilot.link?.isOpen) pilot.link.sendMessage(order);
        }
        const heirs = this.succession.slice(0, NET.checkpointCopies).map((id) => this.pilots.get(id)).filter((pilot) => pilot.joined);
        if (heirs.length === 0) return;
        const text = JSON.stringify(this.capture());
        const pieces = Math.ceil(text.length / NET.checkpointChunk);
        if (pieces > NET.checkpointMaxChunks) return;
        this.checkpointSeq += 1;
        for (let piece = 0; piece < pieces; piece++) {
            const message = JSON.stringify({ t: MSG.CHECKPOINT, id: this.checkpointSeq, i: piece, n: pieces, d: text.slice(piece * NET.checkpointChunk, (piece + 1) * NET.checkpointChunk) });
            for (const heir of heirs) heir.link.sendMessage(message);
        }
    }

    // ---- Services for the game mode ----------------------------------------------------------

    /**
     * Adds a computer-flown player to the match: a pilot like the others - the same ships, the
     * same flight model, the same rules - whose controls the game mode writes instead of a
     * device. It runs here, on the host, and costs the other devices nothing but one more ship.
     * @param {{ id: string, name: string, classId: string }} player `id` must not be a real player's
     * @returns {Pilot}
     */
    addBot({ id, name, classId }) {
        if (this.pilots.has(id)) throw new Error(`A pilot "${id}" is already in the match`);
        const pilot = new Pilot({ id, name, classId, upgrades: {} });
        pilot.bot = true;
        this.pilots.set(id, pilot);
        return pilot;
    }

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
     * Takes a pilot out of the place they are in: they are told nothing more about it, and it
     * is no longer kept running for them. (A player whose ship is lost stays to watch the
     * wreck; a bot has no eyes to watch with.)
     */
    leaveZone(pilot) {
        pilot.zone?.viewers.delete(pilot);
        pilot.zone = null;
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
