import { SECTORS } from '../../../src/game/config/sectors.js';
import { gameModeOf } from '../../../src/game/modes/index.js';
import { ClientMatch } from '../../../src/game/net/match/ClientMatch.js';
import { HostSeat } from '../../../src/game/net/match/HostSeat.js';
import { normalizeMatchInfo } from '../../../src/game/net/match/matchInfo.js';
import { MATCH_PHASE, sanitizeBasicState } from '../../../src/game/net/match/matchState.js';
import { MatchServer } from '../../../src/game/net/server/MatchServer.js';
import { createMemoryLinkPair } from '../../../src/game/net/transport/MemoryLink.js';
import { GameSession } from '../../../src/game/state/GameSession.js';

/** Controls with nothing held (a fresh object each time: tests change them). */
export const idle = () => ({ yaw: 0, pitch: 0, roll: 0, throttle: 0, throttleTarget: null, boost: false, firePrimary: false, fireSecondary: false });

/** A headless GameSession, with everything it publishes to the UI collected in `ui`. */
export function createTestSession(settings = {}) {
    const ui = {};
    const session = new GameSession({
        ui: { set: (partial) => Object.assign(ui, partial) },
        settings: { locale: 'en', difficulty: 'captain', playerShip: 'kestrel', muted: true, invertY: false, autoFire: false, ...settings },
    });
    return { session, ui };
}

/** What the lobby server would announce for a match between `names` (the first one hosts). */
export function matchStart(names, overrides = {}) {
    return {
        matchId: 'match-1',
        seed: 7,
        hostPlayerId: names[0],
        mode: 'battleRoyale',
        players: names.map((name) => ({ playerId: name, displayName: name, shipClassId: 'kestrel', loadout: { upgrades: {}, equipment: [] } })),
        ...overrides,
        // Straight into the system: the introduction has tests of its own (settings.intro = 'play').
        settings: { intro: 'skip', ...overrides.settings },
    };
}

/**
 * The simplest possible game mode, for testing the match machinery without any rules in
 * the way: one zone, everybody on the Federation's side, abreast at the sector's start
 * point, and nothing ever ends. `populate(zone)` may add other ships.
 */
export function arenaRules({ sectorId = 'cinder', spacing = 70, populate = null } = {}) {
    return {
        requests: [],
        setup(server) {
            this.server = server;
            const zone = server.addZone('arena', sectorId);
            const start = SECTORS[sectorId].playerStart;
            const pilots = [...server.pilots.values()];
            pilots.forEach((pilot, slot) => {
                const position = [start.position[0] + (slot - (pilots.length - 1) / 2) * spacing, start.position[1], start.position[2]];
                server.spawnPilotShip(pilot, zone, { position, facing: [0, 0, -1] });
            });
            populate?.(zone);
        },
        update() {},
        onShipDestroyed() {},
        onRequest(pilot, name, data) { this.requests.push({ pilot: pilot.id, name, data }); },
        describeState() {
            return { mode: 'arena', phase: MATCH_PHASE.PLAYING, players: [...this.server.pilots.values()].filter((pilot) => !pilot.gone).map((pilot) => ({ id: pilot.id })) };
        },
    };
}

/** A presenter that lets the arena's state through whole, so tests can read what it reports. */
const arenaPresenter = () => ({
    sanitizeState: (raw) => (sanitizeBasicState(raw) ? raw : null),
    begin() {},
    onEvent() {},
    update() {},
    dispose() {},
});

/**
 * A whole match in one process: the server and the host's own client on one "device", one
 * session per other player, joined by in-memory links that share a clock.
 *
 *   const match = createTestMatch(['host', 'ann', 'bo']);
 *   match.run(2);                         // two seconds for everybody
 *   match.server, match.host.world, match.clients[0].controls.yaw = 1 ...
 *
 * @param {string[]} names player ids; the first is the host
 * @param {object} [options]
 * @param {number} [options.latency] one-way link delay in seconds (not for the host's own link)
 * @param {number} [options.loss] chance that an unreliable packet is lost
 * @param {object} [options.start] overrides for the lobby server's match announcement
 * @param {object} [options.rules] game mode rules instead of the announced mode's (see arenaRules)
 */
export function createTestMatch(names, { latency = 0, loss = 0, start = {}, rules = null } = {}) {
    let time = 0;
    const clock = () => time;
    let seed = 12345;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const info = normalizeMatchInfo(matchStart(names, start));
    const mode = gameModeOf(info);
    const createPresenter = rules ? arenaPresenter : mode.createPresenter;
    const server = new MatchServer({ info, mode: rules ?? mode.createRules(info), now: clock });
    const createClient = (id, link) => new ClientMatch({ info, localPlayerId: id, link, presenter: createPresenter(), now: clock });

    const hostSide = createTestSession();
    const seat = new HostSeat({ server, localPlayerId: names[0], createClient: (link) => createClient(names[0], link) });
    const host = { ...hostSide, match: seat.client, seat, world: hostSide.session.world, controls: idle(), id: names[0] };

    const links = [];
    const clients = names.slice(1).map((id) => {
        const [serverEnd, clientEnd] = createMemoryLinkPair({ latency, loss, clock, random });
        links.push(serverEnd, clientEnd);
        const side = createTestSession();
        server.attachLink(id, serverEnd);
        return { ...side, match: createClient(id, clientEnd), world: side.session.world, controls: idle(), id, link: clientEnd, serverLink: serverEnd };
    });

    hostSide.session.beginMatch(seat);
    for (const client of clients) client.session.beginMatch(client.match);

    const step = (dt = 1 / 60) => {
        time += dt;
        for (const link of links) link.deliver();
        host.session.update(dt, host.controls);
        for (const link of links) link.deliver();
        for (const client of clients) client.session.update(dt, client.controls);
    };
    const run = (seconds, dt = 1 / 60) => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) step(dt);
    };

    return { info, server, host, clients, devices: [host, ...clients], links, step, run, clock, advanceClock: (seconds) => { time += seconds; } };
}

/** A server with no clients at all, driven directly: for testing a mode's rules. */
export function createTestServer(names, { start = {}, rules = null } = {}) {
    let time = 0;
    const info = normalizeMatchInfo(matchStart(names, start));
    const mode = rules ?? gameModeOf(info).createRules(info);
    const server = new MatchServer({ info, mode, now: () => time });
    server.start();
    const run = (seconds, dt = 1 / 30) => {
        for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
            time += dt;
            server.update(dt);
        }
    };
    return { info, server, mode, run };
}

/** The ship a player flies, looked up in any world (a server zone's or a device's). */
export function shipOf(world, playerId) {
    return world.ships.find((ship) => ship.alive && ship.pilotId === playerId) ?? null;
}

/** The server's own ship of a player, wherever they are. */
export function serverShipOf(server, playerId) {
    const ship = server.pilots.get(playerId)?.ship;
    return ship?.alive ? ship : null;
}
