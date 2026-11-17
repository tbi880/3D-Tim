import { Vector3 } from 'three';
import { ABILITIES, ABILITY_PHASES, PASSIVES } from '../../config/abilities.js';
import { FACTION } from '../../config/gameConfig.js';
import { SECTORS } from '../../config/sectors.js';
import { GAME_EVENTS } from '../../core/EventBus.js';
import { PILOT_ACTIONS } from '../../core/systems/pilotActions.js';
import { destroyProjectile, destroyShip } from '../../core/systems/damage.js';
import { damageObstacle, updateObstacles } from '../../core/systems/obstacles.js';
import { IDLE_CONTROLS } from '../../core/systems/playerFlight.js';
import { flyProjectile } from '../../core/systems/projectiles.js';
import { SESSION_EVENTS } from '../../state/GameSession.js';
import { createControls, encodeInput, quantizeControls } from '../codec/inputPacket.js';
import { decodeSnapshot } from '../codec/snapshotPacket.js';
import { NET } from '../netConfig.js';
import { MSG, WORLD_EVENT } from '../protocol.js';
import { cleanUpgrades } from './matchInfo.js';
import { MATCH_PHASE, isMatchOver, sanitizeBasicState } from './matchState.js';
import { EntityIndex, spawnReplicaProjectile, spawnReplicaShip } from './replication.js';
import { ShipPredictor } from './ShipPredictor.js';
import { SnapshotTimeline, applySnapshotSample } from './SnapshotTimeline.js';

/** Packets the pilot's torpedo trigger is repeated in, so a quick tap survives a lost packet. */
const SECONDARY_REPEATS = 3;
/** A copied shot whose "gone" never arrived is dropped this long after its fuel ran out (seconds). */
const PROJECTILE_GRACE = 1.5;
/** Snapshots kept while nothing reads them; older ones are worthless anyway. */
const MAX_UNREAD_SNAPSHOTS = 4;
/** Events that mean something even while this device has not been sent a zone yet. */
const PLACELESS_EVENTS = new Set([WORLD_EVENT.MATCH, WORLD_EVENT.MODE, WORLD_EVENT.STAGE]);
/** Calls the host may make on this device's stage. */
const STAGE_CALLS = new Set(['showTitleCard', 'setHint', 'playMusic', 'playCue']);
const FACTIONS = new Set(Object.values(FACTION));
/** Seconds between requests for the world while none has been answered. */
const HELLO_RETRY_SECONDS = 1.5;
/** Most devices a succession list is taken to hold. */
const MAX_SUCCESSORS = 16;
/**
 * A gap this long (seconds) between two frames is this device stopping, not a slow frame: its
 * page was not drawn (in the background, or busy with a new scene). Silence from the host
 * while this device was stopped does not count against it - nor was this device asking.
 */
const OWN_STALL_SECONDS = 0.5;

const defaultNow = () => performance.now() / 1000;
/** The link of a client that is waiting for a link to its next host: it carries nothing (and its handlers are never called). */
const DETACHED = { isOpen: false, onMessage: null, onState: null, onClose: null, sendMessage() {}, sendState() {} };
const scratchStart = new Vector3();
const scratchEnd = new Vector3();

/**
 * A multiplayer match as one player's device sees it: a copy of the place that player is in.
 * Every device runs one, the host's included (net/match/HostSeat.js), so every player sees
 * the match the same way.
 *
 * Nothing is decided here. The device sends its pilot's controls, and shows what the server
 * reports: ships and shots are built from the server's descriptions, moved by blending its
 * snapshots (SnapshotTimeline), and destroyed when it says so. When the player moves to
 * another place (a "welcome" for a new zone) the copy is thrown away and built again. The one
 * thing that does not wait for the server is the pilot's own ship, which is flown at once and
 * corrected afterwards (ShipPredictor) - that is what keeps the controls instant.
 *
 * Everything received is treated as data to be checked, never as code to trust: a packet
 * this device cannot make sense of is dropped.
 *
 * It plugs into GameSession.beginMatch (see there for the interface). What the match is
 * about is shown by the game mode's presenter (modes/index.js).
 *
 * The host is a device like this one, and can be lost. A client that is told how to go on
 * (`onHostLost`) does not end the match when its host falls silent: it stands still, keeps
 * the last checkpoint and order of succession the host sent it, and is given a link to the
 * device that takes the match over (`switchLink`) - see lobby/LanMultiplayer.js.
 */
export class ClientMatch {
    /**
     * @param {object} params
     * @param {object} params.info the match as normalizeMatchInfo returns it
     * @param {string} params.localPlayerId this device's player id
     * @param {object} params.link the link to the server (transport/MemoryLink.js describes the interface)
     * @param {object} [params.presenter] the game mode's presenter (modes/index.js)
     * @param {number} [params.interpolationDelay] seconds other ships are drawn behind the host's newest word (see NET)
     * @param {() => boolean} [params.onHostLost] called when the host is lost; true if somebody will find this client
     *        another host (it then waits for `switchLink` or `giveUp`), false to end the match here
     * @param {() => { stepCost: number, rtt: Record<string, number> } | null} [params.linkReport] this device's
     *        fitness to host, sent to the host with every ping so it can keep the order of succession
     * @param {number} [params.hostLostTimeout] seconds of silence after which a client with `onHostLost` turns
     *        elsewhere (NET.hostLostTimeout; across the internet NET.internetHostLostTimeout)
     * @param {() => number} [params.now] clock in seconds
     */
    constructor({ info, localPlayerId, link, presenter = null, interpolationDelay = NET.interpolationDelay, onHostLost = null, linkReport = null, hostLostTimeout = NET.hostLostTimeout, now = defaultNow }) {
        this.info = info;
        this.localPlayerId = localPlayerId;
        this.link = link;
        this.presenter = presenter;
        this.onHostLost = onHostLost;
        this.linkReport = linkReport;
        this.hostLostTimeout = hostLostTimeout;
        this.now = now;
        /** True from losing the host until another one has sent its welcome: the picture stands still. */
        this.migrating = false;
        /** Who takes the match over, in order, as the host last said (player ids; this device may be among them). */
        this.succession = info.succession.filter((id) => id !== info.hostPlayerId);
        /** The host's term: 0 for the match's first host, one more for every takeover. */
        this.term = 0;
        /** The newest complete checkpoint the host sent (JSON text), if this device is high in the line; and one being received. */
        this.latestCheckpoint = null;
        this.incomingCheckpoint = null;
        /** Number of the welcome this device is showing; snapshots of any other are stale. */
        this.epoch = -1;

        this.index = new EntityIndex();
        this.timeline = new SnapshotTimeline(interpolationDelay);
        this.predictor = null;
        /** Raw packets received since the last frame; applied at the start of the next one. */
        this.inbox = { messages: [], states: [] };
        this.welcomed = false;
        /** True once the game mode has taken the picture for itself (`takeStage`). */
        this.staged = false;
        /** Id of the zone this device is showing, or null. */
        this.zoneId = null;
        this.state = null;
        this.inputSeq = 0;
        this.sendControls = createControls();
        this.secondaryRepeats = 0;
        this.lastReconcileAt = null;
        this.lastHeardAt = null;
        /** True once the host this client listens to has said anything at all (see NET.firstContactTimeout). */
        this.heardFromHost = false;
        /** When this device last ran a frame of the match (see OWN_STALL_SECONDS). */
        this.lastUpdateAt = null;
        this.lastHelloAt = -Infinity;
        this.lastPingAt = -Infinity;
        /** Round trip to the host in milliseconds, or null until measured. */
        this.rtt = null;
        this.session = null;
        this.world = null;
    }

    // ---- GameSession interface ---------------------------------------------------------------

    begin(session) {
        this.session = session;
        this.world = session.world;
        this.predictor = new ShipPredictor(this.world);
        this.presenter?.begin(this, session);
        this.listen();
    }

    /**
     * Still no welcome: asks again every so often. A device taking a match over may not have
     * been listening on this link when the first request reached it.
     */
    /** True if the host has been heard from in the last `seconds` (by this client's clock). */
    heardWithin(seconds) {
        return this.lastHeardAt !== null && this.now() - this.lastHeardAt <= seconds;
    }

    askAgain() {
        const now = this.now();
        if (now - this.lastHelloAt < HELLO_RETRY_SECONDS) return;
        this.lastHelloAt = now;
        this.send({ t: MSG.HELLO, v: NET.protocolVersion, m: this.info.matchId });
    }

    /** Takes the link's packets and asks its other end for the world. */
    listen() {
        this.lastHeardAt = this.now();
        this.lastHelloAt = this.lastHeardAt;
        this.heardFromHost = false;
        const { link, inbox } = this;
        // Heard when it arrives, not when the next frame reads it: a page that is not being
        // drawn still receives, and what came in meanwhile shows the host was there.
        const heard = () => {
            this.lastHeardAt = this.now();
            this.heardFromHost = true;
        };
        link.onMessage = (text) => {
            heard();
            inbox.messages.push(text);
        };
        link.onState = (data) => {
            heard();
            inbox.states.push(data);
            // A page that is not being drawn (in the background) is not reading these: keep the newest only.
            if (inbox.states.length > MAX_UNREAD_SNAPSHOTS) inbox.states.shift();
        };
        link.onClose = () => { if (this.link === link) this.hostLost(); };
        link.sendMessage(JSON.stringify({ t: MSG.HELLO, v: NET.protocolVersion, m: this.info.matchId }));
    }

    /**
     * Goes on with another host: lets go of the link to the old one (without closing it: the
     * links are the lobby's) and asks the new one for the world. Until its welcome arrives
     * the picture stands still.
     */
    switchLink(link) {
        const old = this.link;
        if (old !== link) {
            old.onMessage = null;
            old.onState = null;
            old.onClose = null;
        }
        this.link = link;
        this.inbox = { messages: [], states: [] };
        this.migrating = true;
        this.welcomed = false;
        this.epoch = -1;
        this.lastReconcileAt = null;
        this.timeline.reset();
        this.predictor?.reset();
        this.listen();
    }

    /**
     * Another host is on its way, but there is no link to it yet: this client lets go of the
     * link it has (the old host's, which may still talk - it must not be taken for the new
     * one), and the picture stands still until `switchLink` and the new host's welcome.
     */
    awaitHost() {
        const old = this.link;
        if (old !== DETACHED) {
            old.onMessage = null;
            old.onState = null;
            old.onClose = null;
            this.link = DETACHED;
        }
        this.inbox = { messages: [], states: [] };
        if (!this.migrating) this.session?.showToast('mp.host.lost');
        this.migrating = true;
        this.welcomed = false;
    }

    /** Nobody could take the match over: it ends here after all. */
    giveUp() {
        this.migrating = false;
        this.disconnect();
    }

    /**
     * Hands this device's picture to the game mode: the world is emptied and set in
     * `sectorId`, and from here on nothing the host sends about ships and shots is drawn -
     * whatever the mode puts on the stage is all there is. The match itself is still heard
     * (its state, its cues). Used for an ending that is played somewhere of its own.
     */
    takeStage(sectorId) {
        const { world } = this;
        this.staged = true;
        world.clear();
        world.setSector(sectorId);
        world.controlsLocked = true;
        this.index.clear();
        this.timeline.reset();
        this.predictor.reset();
    }

    update(dt, controls) {
        const { world } = this;
        this.noteOwnStall();
        this.receive();
        this.checkLink();
        this.presenter?.update(dt);
        if (this.staged) {
            // The mode moves what is on its stage; time still passes for whatever glows there.
            world.time += dt;
            world.lastStep = dt;
            world.prune();
            return;
        }
        if (!this.welcomed) {
            this.askAgain();
            return;
        }

        const own = world.player?.alive ? world.player : null;
        this.sendInput(own, controls, dt);

        this.timeline.advance(dt);
        const sample = this.timeline.sample();
        if (sample) {
            world.time = this.timeline.clock;
            applySnapshotSample(world, this.index.ships, sample, own);
        }
        world.lastStep = dt;
        this.stepScenery(dt);
        this.rebuildBeams();
        world.prune();
    }

    /**
     * One-shot actions: the game mode's own (open the map...) stay on this device; a pilot's
     * are the server's to carry out, so this only asks.
     */
    handleAction(action, params) {
        if (this.presenter?.handleAction?.(action, params) || !PILOT_ACTIONS.includes(action)) return;
        const forward = params?.forward;
        this.send({ t: MSG.ACTION, a: action, ...(forward ? { f: [forward.x, forward.y, forward.z] } : {}) });
    }

    /** The refit window was confirmed (GameSession.applyRefit): the mode decides what that buys. */
    applyRefit(added) {
        this.presenter?.applyRefit?.(added);
    }

    /** Asks the game mode's rules for something (jump to a planet, spend refit points...). */
    request(name, data = null) {
        this.send({ t: MSG.REQUEST, k: name, ...(data ? { d: data } : {}) });
    }

    missionHud() {
        return this.presenter?.missionHud?.() ?? { escort: null, boss: null, progress: null, objective: null };
    }

    dispose() {
        const { link } = this;
        link.onMessage = null;
        link.onState = null;
        link.onClose = null;
        this.presenter?.dispose();
        this.index.clear();
    }

    // ---- Sending -----------------------------------------------------------------------------

    send(message) {
        if (this.link.isOpen) this.link.sendMessage(JSON.stringify(message));
    }

    sendInput(own, controls, dt) {
        const { world, sendControls } = this;
        // No helm to hold while the ship is gone, the server has the controls locked, or the
        // pilot is looking at something else (the map).
        const atTheHelm = own && !world.controlsLocked && !this.presenter?.holdsAttention?.();
        quantizeControls(atTheHelm ? controls : IDLE_CONTROLS, sendControls);
        if (sendControls.fireSecondary) this.secondaryRepeats = SECONDARY_REPEATS;
        else if (this.secondaryRepeats > 0 && own) {
            this.secondaryRepeats -= 1;
            sendControls.fireSecondary = true;
        }
        this.inputSeq += 1;
        if (this.link.isOpen) this.link.sendState(encodeInput(this.inputSeq, sendControls));
        if (own) this.predictor.step(own, this.inputSeq, sendControls, dt);

        const now = this.now();
        if (now - this.lastPingAt >= NET.pingInterval) {
            this.lastPingAt = now;
            this.send({ t: MSG.PING, n: now });
            // With the ping: how good a host this device would make, should it come to that.
            const report = this.linkReport?.();
            if (report) this.send({ t: MSG.LINKS, c: report.stepCost, r: report.rtt });
        }
    }

    // ---- Receiving ---------------------------------------------------------------------------

    receive() {
        const { messages, states } = this.inbox;
        for (const text of messages.splice(0)) this.onMessage(text);
        for (const data of states.splice(0)) this.onSnapshot(data);
    }

    /**
     * This device has not run a frame for a while (its page was hidden, or busy setting up a
     * scene): the host's silence in that time is not held against it - it was not listening
     * for long, nor asking (a hello that went unanswered is not repeated while nothing runs).
     * The clock of silence stops while this device does, and a request for the world goes out
     * again at once.
     */
    noteOwnStall() {
        const now = this.now();
        const last = this.lastUpdateAt;
        this.lastUpdateAt = now;
        if (last === null || now - last < OWN_STALL_SECONDS) return;
        // Heard of while stopped: that counts as it is. Otherwise the silence goes on from where it had got to.
        if (this.lastHeardAt <= last) this.lastHeardAt = now - (last - this.lastHeardAt);
        this.lastHelloAt = -Infinity;
    }

    checkLink() {
        if (this.state?.phase === MATCH_PHASE.DISCONNECTED || this.migrating) return;
        // Until the host has said anything it may still be setting the match up; after that,
        // with somebody to turn to there is no point in waiting long for a host that has gone quiet.
        const patience = !this.heardFromHost ? Math.max(NET.firstContactTimeout, this.hostLostTimeout)
            : this.onHostLost ? this.hostLostTimeout : NET.linkTimeout;
        if (!this.link.isOpen || this.now() - this.lastHeardAt > patience) this.hostLost();
    }

    /**
     * The host has fallen silent. If the match can go on under another device the picture
     * stands still until that one's welcome; otherwise this is the end of it.
     */
    hostLost() {
        if (this.state?.phase === MATCH_PHASE.DISCONNECTED || !this.session) return;
        const already = this.migrating;
        if (!isMatchOver(this.state?.phase) && this.onHostLost?.()) {
            // (Whoever answered may already have given this client another link: `switchLink` stands.)
            this.migrating = true;
            this.welcomed = false;
            if (!already) this.session.showToast('mp.host.lost');
            return;
        }
        this.migrating = false;
        this.disconnect();
    }

    /** The host is gone and nobody takes its place: nothing more will happen in this match. */
    disconnect() {
        if (this.state?.phase === MATCH_PHASE.DISCONNECTED || !this.session) return;
        this.setState({ ...(this.state ?? { mode: this.info.mode, players: [] }), phase: MATCH_PHASE.DISCONNECTED });
    }

    onMessage(text) {
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return;
        }
        if (!message || typeof message !== 'object') return;
        switch (message.t) {
            case MSG.WELCOME:
                this.onWelcome(message);
                break;
            case MSG.BATCH:
                if (!Array.isArray(message.e)) break;
                for (const entry of message.e) {
                    // Before the player is anywhere (a mode's introduction) there is no world to
                    // change, but the match can already speak: its state, its cues.
                    // The same once the mode has taken the stage: the world on screen is no longer the host's.
                    const placed = this.welcomed && !this.staged;
                    if (placed || (Array.isArray(entry) && PLACELESS_EVENTS.has(entry[0]))) this.applyEvent(entry);
                }
                break;
            case MSG.PONG:
                if (Number.isFinite(message.n)) this.rtt = Math.max(0, Math.round((this.now() - message.n) * 1000));
                break;
            case MSG.REFUSED:
                this.disconnect();
                break;
            case MSG.SUCCESSION:
                if (Array.isArray(message.o) && Number.isInteger(message.n)) {
                    this.succession = message.o.filter((id) => typeof id === 'string').slice(0, MAX_SUCCESSORS);
                    this.term = Math.max(this.term, message.n);
                }
                break;
            case MSG.CHECKPOINT:
                this.onCheckpointPiece(message);
                break;
            case MSG.TAKEOVER:
                // The device this client turned to has just taken the match over, and listens now: a
                // request for the world that reached it before it did went unheard - ask again at once.
                if (!this.welcomed) this.lastHelloAt = -Infinity;
                break;
            default:
        }
    }

    /** Collects a checkpoint that arrives in pieces; only a complete one replaces the last. */
    onCheckpointPiece({ id, i, n, d }) {
        if (!Number.isInteger(id) || !Number.isInteger(i) || !Number.isInteger(n) || typeof d !== 'string') return;
        if (n < 1 || n > NET.checkpointMaxChunks || i < 0 || i >= n || d.length > NET.checkpointChunk) return;
        if (this.incomingCheckpoint?.id !== id) this.incomingCheckpoint = { id, pieces: new Array(n).fill(null), missing: n };
        const incoming = this.incomingCheckpoint;
        if (incoming.pieces.length !== n || incoming.pieces[i] !== null) return;
        incoming.pieces[i] = d;
        incoming.missing -= 1;
        if (incoming.missing > 0) return;
        this.latestCheckpoint = incoming.pieces.join('');
        this.incomingCheckpoint = null;
    }

    onWelcome(message) {
        if (message.v !== NET.protocolVersion || message.matchId !== this.info.matchId || !SECTORS[message.sectorId] || !Number.isInteger(message.epoch)) {
            this.disconnect();
            return;
        }
        const { world } = this;
        if (this.staged) {
            // The picture is the mode's own by now: only the match's word is taken.
            this.epoch = message.epoch;
            this.welcomed = true;
            this.migrating = false;
            this.applyMatchState(message.match);
            return;
        }
        // A welcome is a whole place: whatever was here before is gone.
        world.clear();
        world.setSector(message.sectorId);
        this.epoch = message.epoch;
        this.zoneId = typeof message.zoneId === 'string' ? message.zoneId : null;
        this.index.clear();
        this.timeline.reset();
        this.predictor.reset();

        // Rocks that were gone before this device arrived are simply not there: no blast to show.
        if (Array.isArray(message.rocks)) {
            const gone = new Set(message.rocks);
            for (const rock of world.obstacles) {
                if (gone.has(rock.serial)) rock.alive = false;
            }
        }
        // Parents before the turrets and generators that ride on them.
        const ships = Array.isArray(message.ships) ? [...message.ships] : [];
        ships.sort((a, b) => Number(a?.parentId != null) - Number(b?.parentId != null));
        for (const description of ships) spawnReplicaShip(world, description, this.index, this.localPlayerId);

        this.welcomed = true;
        if (this.migrating) {
            // Another device has the match now: it goes on from that device's last checkpoint.
            this.migrating = false;
            this.session.showToast('mp.host.resumed');
        }
        this.applyMatchState(message.match);
        this.presenter?.onZoneEntered?.(this.zoneId);
    }

    onSnapshot(data) {
        if (!this.welcomed || this.staged) return;
        let snapshot;
        try {
            snapshot = decodeSnapshot(data);
        } catch {
            return;
        }
        if (snapshot.epoch !== this.epoch || !this.timeline.push(snapshot)) return;
        this.world.controlsLocked = snapshot.controlsLocked || isMatchOver(this.state?.phase);
        this.applyOwnShip(snapshot);
    }

    /** The host's word on this player's own ship: corrects the prediction and fills the HUD's numbers. */
    applyOwnShip(snapshot) {
        const { world } = this;
        const own = snapshot.own;
        const ship = own ? this.index.ships.get(own.id) : null;
        if (!ship || !ship.alive || ship !== world.player) return;

        const now = this.now();
        this.predictor.reconcile(ship, own, snapshot.ack, this.lastReconcileAt === null ? 1 : now - this.lastReconcileAt);
        this.lastReconcileAt = now;

        ship.energy = own.energy;
        ship.cannonLock = own.cannonLock;
        ship.beamFiring = own.beamFiring;
        for (const weapon of ship.weapons) {
            if (weapon.def.type === 'beam') {
                weapon.depleted = own.beamDepleted;
                weapon.firing = own.beamFiring;
            } else if (weapon.def.type === 'torpedo') {
                weapon.ammo = own.torpedoes;
                weapon.reloadTimer = own.torpedoReload;
            }
        }
        world.setPlayerTarget(own.targetId ? this.index.ships.get(own.targetId) ?? null : null);
        if (ship.ability) {
            ship.ability.cooldown = own.abilityCooldown;
            ship.ability.active = own.abilityActive;
            ship.ability.armed = own.abilityArmed;
        }
        ship.shieldDown = own.shieldDown;
    }

    // ---- World events from the host ----------------------------------------------------------

    applyEvent(entry) {
        if (!Array.isArray(entry)) return;
        const { world, index, session } = this;
        const [kind, a, b, c, d, e, f] = entry;
        switch (kind) {
            case WORLD_EVENT.SPAWN:
                spawnReplicaShip(world, a, index, this.localPlayerId);
                break;
            case WORLD_EVENT.REMOVE: {
                const ship = index.ships.get(a);
                index.ships.delete(a);
                if (ship) world.removeShip(ship, { flash: Boolean(b) });
                break;
            }
            case WORLD_EVENT.DESTROY: {
                const ship = index.ships.get(a);
                index.ships.delete(a);
                // The host has worked out what the ship's end did to those around it.
                if (ship) destroyShip(world, ship, index.ships.get(b) ?? null, { shown: true });
                break;
            }
            case WORLD_EVENT.HIT: {
                if (![b, c, d, f].every(Number.isFinite)) break;
                const target = index.ships.get(a) ?? null;
                if (target) {
                    target.lastDamagedAt = world.time;
                    if (e) target.lastShieldHitAt = world.time;
                }
                world.events.emit(GAME_EVENTS.HIT, { target, position: new Vector3(b, c, d), shield: Boolean(e), amount: f });
                break;
            }
            case WORLD_EVENT.FIRE:
                spawnReplicaProjectile(world, a, index);
                break;
            case WORLD_EVENT.PROJECTILE_GONE: {
                const projectile = index.projectiles.get(a);
                index.projectiles.delete(a);
                if (!projectile) break;
                // Where the host saw it end, so the blast is on the hull and not beside it.
                if ([c, d, e].every(Number.isFinite)) projectile.position.set(c, d, e);
                destroyProjectile(world, projectile, Boolean(b));
                break;
            }
            case WORLD_EVENT.ROCK:
                this.destroyRock(a);
                break;
            case WORLD_EVENT.LANCE: {
                const ship = index.ships.get(a);
                const weapon = ship?.weapons[b];
                if (weapon) world.events.emit(c ? GAME_EVENTS.LANCE_FIRING : GAME_EVENTS.LANCE_CHARGING, { ship, weapon });
                break;
            }
            case WORLD_EVENT.BUMP:
                if (world.player && Number.isFinite(a)) world.events.emit(GAME_EVENTS.PLAYER_COLLISION, { speed: a, ship: world.player });
                break;
            case WORLD_EVENT.FACTION: {
                const ship = index.ships.get(a);
                if (ship && FACTIONS.has(b)) {
                    ship.faction = b;
                    // The roster is how the scene learns a ship looks different now.
                    session.publishRoster();
                }
                break;
            }
            case WORLD_EVENT.REFIT: {
                const ship = index.ships.get(a);
                if (ship?.alive && ship.isPlayer) world.refitShip(ship, cleanUpgrades(b));
                break;
            }
            case WORLD_EVENT.ABILITY: {
                if (!(Object.hasOwn(ABILITIES, b) || Object.hasOwn(PASSIVES, b)) || !ABILITY_PHASES.includes(c)) break;
                const blast = [d, e, f, entry[7]].every(Number.isFinite);
                world.events.emit(GAME_EVENTS.ABILITY, {
                    ship: index.ships.get(a) ?? null, ability: b, phase: c,
                    ...(blast ? { position: new Vector3(d, e, f), radius: entry[7] } : {}),
                });
                break;
            }
            case WORLD_EVENT.STAGE:
                if (STAGE_CALLS.has(a) && (b === null || typeof b === 'string')) session[a](b);
                break;
            case WORLD_EVENT.MODE:
                if (typeof a === 'string') this.presenter?.onEvent(a, b ?? null);
                break;
            case WORLD_EVENT.MATCH:
                this.applyMatchState(a);
                break;
            case WORLD_EVENT.SCORE:
                if (Number.isFinite(a) && typeof b === 'string' && Number.isFinite(c)) {
                    session.events.emit(SESSION_EVENTS.SCORE, { points: a, classId: b, total: c });
                }
                break;
            default:
        }
    }

    destroyRock(serial) {
        const rock = this.world.obstacles.find((obstacle) => obstacle.alive && obstacle.serial === serial);
        if (rock) damageObstacle(this.world, rock, Infinity, rock.position);
    }

    /** A match state from the server: checked by the mode's presenter before anything shows it. */
    applyMatchState(raw) {
        const state = this.presenter ? this.presenter.sanitizeState(raw) : sanitizeBasicState(raw);
        // Once the link is lost that is the end of it, whatever was still in the queue.
        if (!state || this.state?.phase === MATCH_PHASE.DISCONNECTED) return;
        this.setState(state);
    }

    setState(state) {
        const wasOver = isMatchOver(this.state?.phase);
        this.state = state;
        this.session.ui.set({ match: { ...state, localId: this.localPlayerId, rtt: this.rtt } });
        if (!isMatchOver(state.phase)) return;
        // The helm is nobody's once the match is decided.
        this.world.controlsLocked = true;
        const showResults = () => { if (this.session.match) this.session.showMatchResults(); };
        // A lost link ends things at once; otherwise the mode may have an ending to play first.
        if (state.phase === MATCH_PHASE.DISCONNECTED) showResults();
        else if (!wasOver && !this.presenter?.onMatchOver?.(state, showResults)) showResults();
    }

    // ---- The parts of the world this device moves by itself ----------------------------------

    stepScenery(dt) {
        const { world, index } = this;
        for (const ship of world.ships) {
            if (ship.warpTimer > 0) world.advanceWarpIn(ship, dt);
        }
        for (const [id, projectile] of index.projectiles) {
            if (!projectile.alive) {
                index.projectiles.delete(id);
                continue;
            }
            // Shots only fly here; the host says when one has hit or burnt out. One it never
            // mentions again (a lost link, a rejoin) is quietly dropped a moment after its fuel is gone.
            if (!flyProjectile(projectile, dt) && projectile.life < -PROJECTILE_GRACE) {
                projectile.alive = false;
                index.projectiles.delete(id);
            } else if (projectile.life <= 0) {
                projectile.position.addScaledVector(projectile.velocity, dt);
            }
        }
        updateObstacles(world, dt);
    }

    /** Draws the host's beams between the hulls as this device shows them. */
    rebuildBeams() {
        const { world, index } = this;
        world.beams.length = 0;
        const latest = this.timeline.latest;
        if (!latest) return;
        for (const beam of latest.beams) {
            if (!this.resolveBeamEnd(beam.from, scratchStart) || !this.resolveBeamEnd(beam.to, scratchEnd)) continue;
            world.addBeam(scratchStart, scratchEnd, beam.color, beam.width, beam.kind, index.ships.get(beam.from.shipId) ?? null, index.ships.get(beam.to.shipId) ?? null);
        }
    }

    resolveBeamEnd(end, out) {
        if (!end.shipId) {
            out.copy(end.point);
            return true;
        }
        const ship = this.index.ships.get(end.shipId);
        if (!ship?.alive) return false;
        out.copy(end.point).applyQuaternion(ship.quaternion).add(ship.position);
        return true;
    }
}
