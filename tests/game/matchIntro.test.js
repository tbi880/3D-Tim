import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { BATTLE_ROYALE, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { translate } from '../../src/game/i18n/index.js';
import { gameModeOf } from '../../src/game/modes/index.js';
import { BR_REQUEST } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { sanitizeBattleRoyaleState } from '../../src/game/modes/battleRoyale/battleRoyaleState.js';
import { Exodus, GateVigil, INTRO_ACT, IntroClock, introMoment } from '../../src/game/modes/battleRoyale/introShow.js';
import { GATE_TAG, STATION_TAG, gatePose } from '../../src/game/modes/battleRoyale/station.js';
import { MATCH_PHASE } from '../../src/game/net/match/matchState.js';
import { MatchServer } from '../../src/game/net/server/MatchServer.js';
import { MENU_PLACE, isMenuShown, isStoryShown, matchMenuPlace } from '../../src/game/xr/menuPlacement.js';
import { drawStoryCaption, storyCaption } from '../../src/game/xr/vrCaption.js';
import { createTestMatch, createTestServer } from './support/matchHarness.js';

/**
 * The story before a battle royale: a show in two acts that every device stages for itself
 * while the host counts the seconds (modes/battleRoyale/introShow.js, introStage.js), the
 * skipping of it - which the players do together - and its words in the headset.
 * (What the rules do meanwhile - nobody is in the system - is in battleRoyale.test.js.)
 */

const INTRO = BATTLE_ROYALE.intro;
const { DAWN, UMBRA, PIRATE } = FACTION;
const withIntro = { settings: { intro: 'play' } };
const GATE_SECTOR = STAR_SYSTEM.planets.find((planet) => planet.gate).sectorId;
const forwardOf = (quaternion) => new Vector3(0, 0, -1).applyQuaternion(quaternion);

// ---- The choreography ------------------------------------------------------------------------

test('the story is two acts that fill the introduction, with a line of words for every stretch of it', () => {
    assert.equal(INTRO.fall.seconds + INTRO.gate.seconds, INTRO.seconds);
    assert.deepEqual(introMoment(0, INTRO), { act: INTRO_ACT.FALL, at: 0, line: 0, sides: false });
    assert.equal(introMoment(INTRO.fall.seconds - 0.01, INTRO).act, INTRO_ACT.FALL);
    const second = introMoment(INTRO.fall.seconds + 1, INTRO);
    assert.deepEqual([second.act, second.at], [INTRO_ACT.GATE, 1], 'the second act counts its own seconds');
    assert.equal(introMoment(INTRO.seconds + 5, INTRO).line, INTRO.lines.length - 1, 'past the end it stays on the last line');
    assert.equal(introMoment(-3, INTRO).line, 0);

    assert.equal(INTRO.lines[0], 0);
    INTRO.lines.forEach((at, index) => {
        const until = INTRO.lines[index + 1] ?? INTRO.seconds;
        assert.ok(until - at >= 2, `line ${index + 1} stays up long enough to be read`);
        assert.equal(introMoment(at + 0.01, INTRO).line, index);
        for (const locale of ['zh', 'en']) {
            const text = translate(locale, `mp.intro.line${index + 1}`);
            assert.ok(text && !text.startsWith('mp.'), `line ${index + 1} is written in ${locale}`);
        }
    });
    assert.equal(introMoment(INTRO.sides - 0.01, INTRO).sides, false);
    assert.equal(introMoment(INTRO.sides, INTRO).sides, true, 'the sides stand under the story from the second act on');
});

test('a device\'s clock of the story runs by itself and is pulled back to the host\'s count', () => {
    const clock = new IntroClock(INTRO.seconds);
    for (let frame = 0; frame < 30; frame++) clock.advance(1 / 60);
    assert.ok(Math.abs(clock.elapsed - 0.5) < 1e-9, 'between the host\'s words it runs on');
    clock.hear(INTRO.seconds);
    assert.ok(Math.abs(clock.elapsed - 0.5) < 1e-9, 'a word that agrees changes nothing');

    // A page that was in the background for five seconds: the host is at "9 left".
    clock.hear(9);
    assert.ok(clock.elapsed >= INTRO.seconds - 9 - 0.31 && clock.elapsed <= INTRO.seconds - 8 + 0.31, `${clock.elapsed}`);
    // A device that ran ahead is pulled back the same way.
    clock.elapsed = 12;
    clock.hear(9);
    assert.ok(clock.elapsed <= INTRO.seconds - 8 + 0.31);

    clock.hear(NaN);
    clock.hear(undefined);
    assert.ok(Number.isFinite(clock.elapsed));
    clock.advance(1000);
    assert.equal(clock.elapsed, INTRO.seconds, 'and never runs past the end');
});

test('act one: the eye drifts at the black hole without ever turning, while ships run from it past the eye', () => {
    const show = new Exodus(INTRO.fall);
    const hole = new Vector3().fromArray(SECTORS[INTRO.fall.sectorId].backdrop[0].direction).normalize();
    assert.ok(show.hole.distanceTo(hole) < 1e-9, 'the hole is where the sector\'s sky has it');

    const eye = new Vector3();
    const facing = new Quaternion();
    const first = new Quaternion();
    show.placeViewer(0, eye, first);
    assert.ok(forwardOf(first).distanceTo(hole) < 1e-6, 'looking at it');
    const start = eye.clone();
    for (let time = 0; time <= show.seconds; time += 0.25) {
        show.placeViewer(time, eye, facing);
        assert.ok(facing.angleTo(first) < 1e-6, 'a view that turned by itself would sicken a pilot in a headset');
    }
    assert.ok(eye.distanceTo(start) / show.seconds <= 40, 'and it only creeps');

    // The runners: every one passes the eye during the act, clear of it, heading out of the hole.
    const position = new Vector3();
    const heading = new Quaternion();
    const passes = [];
    INTRO.fall.cast.forEach(([classId], index) => {
        let nearest = Infinity;
        let nearestAt = 0;
        let gone = false;
        for (let time = 0; time <= show.seconds + 2; time += 1 / 60) {
            show.placeViewer(Math.min(time, show.seconds), eye, facing);
            gone = show.placeShip(index, time, position, heading);
            const distance = position.distanceTo(eye);
            if (distance < nearest) {
                nearest = distance;
                nearestAt = time;
            }
        }
        assert.ok(forwardOf(heading).dot(hole) < -0.999, 'nose straight out of the hole');
        assert.ok(nearest >= INTRO.fall.clear[0] + SHIP_CLASSES[classId].radius - 1, `${classId} ${index} stays clear of the eye (${nearest.toFixed(0)} m)`);
        assert.ok(nearest <= INTRO.fall.clear[1] * 1.3 + SHIP_CLASSES[classId].radius, 'and close enough to be seen going by');
        assert.ok(gone, 'and is let go of once it is well behind');
        passes.push(nearestAt);
    });
    assert.deepEqual(passes, [...passes].sort((a, b) => a - b), 'one after another');
    assert.ok(passes[0] > 0.5 && passes.at(-2) < show.seconds, 'through the whole act');
});

test('act one: the one that did not get away falls into the hole, is drawn out and torn apart', () => {
    const show = new Exodus(INTRO.fall);
    const position = new Vector3();
    const heading = new Quaternion();
    const from = new Vector3();
    show.placeStraggler(0, from, heading);
    assert.ok(forwardOf(heading).dot(show.hole) < -0.999, 'its nose is out of the hole, engines burning');

    const tornAt = INTRO.fall.straggler.torn * show.seconds;
    let last = 0;
    let lastTidal = 0;
    for (let time = 0; time <= tornAt + 0.5; time += 0.1) {
        const { tidal, torn } = show.placeStraggler(time, position, heading);
        const fallen = position.clone().sub(from).dot(show.hole);
        assert.ok(fallen >= last - 1e-9, 'and it goes backwards all the same');
        assert.ok(tidal >= lastTidal - 1e-9);
        assert.equal(torn, time >= tornAt);
        last = fallen;
        lastTidal = tidal;
    }
    assert.equal(show.placeStraggler(tornAt - INTRO.fall.straggler.stretch - 0.1, position, heading).tidal, 0);
    assert.equal(show.placeStraggler(tornAt, position, heading).tidal, 1, 'drawn right out as it bursts');
    assert.ok(tornAt < show.seconds - 1, 'with the act still on to show it');
    assert.ok(show.fallSpeed(tornAt) > 0);

    assert.equal(show.fade(0), 1, 'the picture comes up from black');
    assert.equal(show.fade(INTRO.fall.cut + 0.1), 0);
    assert.equal(show.fade(show.seconds), 1, 'and goes dark for the cut to the gate');
});

function vigil() {
    const gate = gatePose(SECTORS[GATE_SECTOR].playerStart, BATTLE_ROYALE.station, BATTLE_ROYALE.gate);
    return { gate, show: new GateVigil({ gate, timing: INTRO.gate, charge: BATTLE_ROYALE.gate.charge }) };
}

test('act two: the eye closes on the stargate without turning, the fleets either side of the road to it', () => {
    const { gate, show } = vigil();
    const eye = new Vector3();
    const facing = new Quaternion();
    const first = new Quaternion();
    show.placeViewer(0, eye, first);
    const start = eye.clone();
    const toGate = gate.position.clone().sub(eye);
    assert.ok(forwardOf(first).angleTo(toGate) < 1e-6, 'looking straight at the gate');
    const distance = toGate.length();
    show.placeViewer(show.seconds, eye, facing);
    assert.ok(facing.angleTo(first) < 1e-6);
    assert.ok(eye.distanceTo(gate.position) < distance, 'closing on it');
    assert.ok(eye.distanceTo(start) / show.seconds <= 60, 'slowly');
    assert.ok(eye.distanceTo(gate.position) > SHIP_CLASSES.stargate.radius * 1.5, 'and still well short of it at the end');

    // The fleets: the guards either side of the road, the pirates under the eye, nobody in the eye's way.
    const right = new Vector3(1, 0, 0).applyQuaternion(gate.quaternion);
    const sideOf = (ship) => ship.position.clone().sub(gate.position).dot(right);
    const fleet = (faction) => show.ships.filter((ship) => ship.faction === faction);
    const count = (faction) => INTRO.gate.fleets[faction].ships.reduce((sum, [, ships]) => sum + ships, 0);
    for (const faction of [DAWN, UMBRA, PIRATE]) assert.equal(fleet(faction).length, count(faction));
    assert.equal(Math.sign(sideOf(fleet(DAWN)[0])), -Math.sign(sideOf(fleet(UMBRA)[0])), 'the two garrisons face each other across the road');
    const look = forwardOf(first);
    const position = new Vector3();
    const heading = new Quaternion();
    show.ships.forEach((ship, index) => {
        for (const time of [0, show.seconds]) {
            show.placeShip(index, time, position, heading);
            show.placeViewer(time, eye, facing);
            const ahead = position.clone().sub(eye).dot(look);
            assert.ok(ahead > 150, `${ship.classId} is in front of the eye`);
            assert.ok(position.distanceTo(eye) > SHIP_CLASSES[ship.classId].radius + 120, `${ship.classId} is clear of the eye`);
            assert.ok(forwardOf(heading).dot(gate.lane) > 0.5, 'nose to the gate');
        }
    });
    for (const ship of [...fleet(DAWN), ...fleet(UMBRA)]) {
        assert.ok(forwardOf(ship.quaternion).dot(right) * sideOf(ship) < 0, 'and half turned on the fleet across the road');
    }
    // Always the same picture, on every device.
    assert.deepEqual(vigil().show.ships.map((ship) => ship.position.toArray()), show.ships.map((ship) => ship.position.toArray()));
});

test('act two: the gate sleeps and stirs once, and the act ends in the streaks of a jump', () => {
    const { show } = vigil();
    const { asleep } = BATTLE_ROYALE.gate.charge;
    const field = { charge: 9, open: 9, shut: 9, pulse: 9, faction: DAWN };
    show.field(0, field);
    assert.deepEqual(field, { charge: asleep, open: 0, shut: 0, pulse: 0, faction: null });

    let strongest = 0;
    for (let time = 0; time <= show.seconds; time += 0.05) {
        show.field(time, field);
        assert.equal(field.open, 0, 'it opens for nobody yet');
        assert.equal(field.shut, 0);
        strongest = Math.max(strongest, field.charge);
    }
    assert.ok(Math.abs(strongest - INTRO.gate.stir.charge) < 0.02, 'it stirs');
    show.field(show.seconds, field);
    assert.ok(Math.abs(field.charge - asleep) < 0.01, 'and sleeps again');

    assert.equal(show.warp(show.seconds - INTRO.gate.warp - 0.01), 0);
    assert.ok(show.warp(show.seconds - INTRO.gate.warp / 2) > 0);
    assert.ok(Math.abs(show.warp(show.seconds) - 1) < 1e-9);
    assert.equal(show.fade(0), 1);
    assert.equal(show.fade(show.seconds), 0, 'the jump takes the picture, not the dark');
    assert.ok(forwardOf(show.view).dot(show.hole) < 0, 'the black hole is behind: where everybody will come from');
});

// ---- Skipping it, together -------------------------------------------------------------------

const ask = (game, name, request = BR_REQUEST.SKIP_INTRO) => game.mode.onRequest(game.server.pilots.get(name), request, {});
const stateOf = (game, name) => game.mode.describeState(game.server.pilots.get(name));

test('the introduction goes on until every player has asked to skip it: then everybody enters at once', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: withIntro });
    game.run(2);
    assert.deepEqual(stateOf(game, 'ann').skip, { voted: 0, voters: 3, you: false });

    ask(game, 'ann');
    ask(game, 'ann');
    assert.deepEqual(stateOf(game, 'ann').skip, { voted: 1, voters: 3, you: true }, 'asking twice is asking once');
    assert.deepEqual(stateOf(game, 'bo').skip, { voted: 1, voters: 3, you: false });
    game.run(1);
    assert.ok(game.mode.introLeft > 0, 'one player cannot cut the story short for the others');
    assert.equal(game.server.pilots.get('ann').ship, null, 'nor go in ahead of them');

    ask(game, 'bo');
    assert.ok(game.mode.introLeft > 0);
    ask(game, 'cy');
    assert.equal(game.mode.introLeft, 0);
    assert.ok(Math.abs(game.mode.startedAt - 3) < 0.1, 'the clocks start now, not when the story would have ended');
    for (const contestant of game.mode.contestants.values()) {
        assert.ok(contestant.pilot.ship?.alive, `${contestant.pilot.id} is in the system`);
        assert.equal(contestant.pilot.ship.arriving, true, 'out of a jump, like any start');
        assert.ok(Math.abs(contestant.jumpReadyAt - (game.server.time + BATTLE_ROYALE.jump.cooldown)) < 0.1);
    }
    assert.equal(stateOf(game, 'ann').intro, null);
    assert.equal(stateOf(game, 'ann').skip, null);
});

test('the computer-flown players are not asked: one player among them skips for the match', () => {
    const game = createTestServer(['ann'], { start: { settings: { intro: 'play', bots: 'fill' } } });
    game.run(1);
    assert.ok(game.server.pilots.size > 1);
    assert.deepEqual(stateOf(game, 'ann').skip, { voted: 0, voters: 1, you: false });

    const bot = [...game.server.pilots.values()].find((pilot) => pilot.bot);
    game.mode.onRequest(bot, BR_REQUEST.SKIP_INTRO, {});
    assert.ok(game.mode.introLeft > 0, 'and a bot cannot ask');

    ask(game, 'ann');
    assert.equal(game.mode.introLeft, 0);
    assert.ok([...game.server.pilots.values()].every((pilot) => pilot.ship?.alive));
});

test('a player who leaves during the introduction is not waited for', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: withIntro });
    game.run(1);
    ask(game, 'ann');
    ask(game, 'bo');
    assert.ok(game.mode.introLeft > 0);

    game.server.removePlayer('cy');
    assert.equal(game.mode.introLeft, 0);
    assert.ok(game.server.pilots.get('ann').ship?.alive && game.server.pilots.get('bo').ship?.alive);
    assert.equal(game.server.pilots.get('cy').ship, null);
});

test('nobody has asked: a player leaving does not end the introduction, and it runs its seconds', () => {
    const game = createTestServer(['ann', 'bo'], { start: withIntro });
    game.run(1);
    game.server.removePlayer('bo');
    assert.ok(game.mode.introLeft > 0);
    game.run(INTRO.seconds - 1.5);
    assert.ok(game.mode.introLeft > 0);
    game.run(1);
    assert.equal(game.mode.introLeft, 0);
});

test('once the ships are in, asking to skip means nothing', () => {
    const game = createTestServer(['ann', 'bo'], { start: withIntro });
    game.run(INTRO.seconds + 0.5);
    const startedAt = game.mode.startedAt;
    ask(game, 'ann');
    ask(game, 'bo');
    assert.equal(game.mode.startedAt, startedAt);
    assert.equal(game.mode.introSkips.size, 0);
});

test('who has skipped is handed on with the match', () => {
    const game = createTestServer(['ann', 'bo', 'cy'], { start: withIntro });
    game.run(2);
    ask(game, 'bo');
    const checkpoint = JSON.parse(JSON.stringify(game.server.capture()));
    checkpoint.mode.introSkips.push('nobody', 7, null);

    const server = new MatchServer({ info: game.info, mode: gameModeOf(game.info).createRules(game.info), hostPlayerId: 'bo', checkpoint, term: 1, now: () => 0 });
    server.start();
    assert.deepEqual([...server.mode.introSkips], ['bo'], 'and only real players are counted');
    assert.ok(server.mode.introLeft > 0 && server.mode.introLeft <= INTRO.seconds - 2 + 0.1);
    server.mode.onRequest(server.pilots.get('ann'), BR_REQUEST.SKIP_INTRO, {});
    server.mode.onRequest(server.pilots.get('cy'), BR_REQUEST.SKIP_INTRO, {});
    assert.equal(server.mode.introLeft, 0);
    assert.ok([...server.pilots.values()].every((pilot) => pilot.ship?.alive));
});

test('what a device is told of the skipping is checked like the rest of the state', () => {
    const game = createTestServer(['ann', 'bo'], { start: withIntro });
    game.run(1);
    const raw = stateOf(game, 'ann');
    assert.deepEqual(sanitizeBattleRoyaleState(raw).skip, { voted: 0, voters: 2, you: false });
    assert.deepEqual(sanitizeBattleRoyaleState({ ...raw, skip: { voted: '2', voters: -4, you: 'yes' } }).skip, { voted: 0, voters: 0, you: true });
    assert.equal(sanitizeBattleRoyaleState({ ...raw, skip: 'all' }).skip, null);
    assert.equal(sanitizeBattleRoyaleState({ ...raw, intro: null }).skip, null, 'there is nothing to skip once the story is over');
});

// ---- On each device --------------------------------------------------------------------------

const stageOf = (device) => device.match.presenter?.intro ?? device.session.match.client?.presenter.intro ?? null;
const presenterOf = (device) => device.session.match.presenter ?? device.session.match.client.presenter;

test('each device stages the first act for itself: the dying sun, the ships that run and an eye that is no ship', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { start: withIntro });
    match.run(1.5);

    for (const device of match.devices) {
        const { world, ui } = device;
        assert.equal(world.sectorId, INTRO.fall.sectorId);
        assert.deepEqual(ui.matchIntro, { act: INTRO_ACT.FALL, line: 0, sides: false, skipped: false }, device.id);
        assert.equal(world.ships.length, INTRO.fall.cast.length + 1, 'the runners and the one that did not get away');
        assert.equal(world.ships.some((ship) => ship.pilotId != null), false, 'nobody\'s ship is among them');
        assert.ok(world.ships.every((ship) => ship.speed > 0), 'all under full burn');
        // The eye: a place to see from, with nothing of a ship or a cockpit about it.
        assert.equal(world.player.alive, false);
        assert.ok(world.player.position.distanceTo(new Vector3().fromArray(INTRO.fall.seat)) < INTRO.fall.drift * 2);
        assert.equal(world.controlsLocked, true);
        assert.ok(world.time > 1, 'time passes on the stage, for whatever glows there');
    }
    // Every device shows the same moment of it.
    const elapsed = match.devices.map((device) => presenterOf(device).intro.clock.elapsed);
    assert.ok(Math.max(...elapsed) - Math.min(...elapsed) < 0.05, `${elapsed}`);
    assert.ok(Math.abs(elapsed[0] - 1.5) < 0.35);

    match.run(INTRO.fall.straggler.torn * INTRO.fall.seconds - 1.5 + 0.2);
    for (const device of match.devices) {
        assert.equal(device.world.ships.some((ship) => ship.classId === INTRO.fall.straggler.classId), false, 'the straggler has been torn apart');
        assert.equal(device.ui.matchIntro.line, 1);
    }
    assert.equal(match.server.pilots.get('ann').guard.strikes, 0, 'none of this is the host\'s business');
});

test('the second act cuts to the stargate: the station, the sleeping gate and the fleets that guard it', () => {
    const match = createTestMatch(['host', 'ann'], { start: withIntro });
    match.run(INTRO.fall.seconds + 1.5);

    const fleetSize = Object.values(INTRO.gate.fleets).reduce((sum, fleet) => sum + fleet.ships.reduce((ships, [, count]) => ships + count, 0), 0);
    for (const device of match.devices) {
        const { world, ui } = device;
        assert.equal(world.sectorId, GATE_SECTOR);
        assert.equal(ui.matchIntro.act, INTRO_ACT.GATE);
        assert.equal(ui.matchIntro.sides, true);
        assert.ok(world.findByTag(STATION_TAG) && world.findByTag(GATE_TAG));
        assert.equal(world.ships.length, fleetSize + 2);
        assert.equal(world.ships.some((ship) => ship.classId === INTRO.fall.straggler.classId && ship.tidal > 0), false, 'nothing of the first act is left');
        for (const faction of [DAWN, UMBRA, PIRATE]) assert.ok(world.ships.some((ship) => ship.faction === faction), `${faction} is there`);
        assert.equal(world.player.alive, false);
        assert.equal(world.gateField.open, 0);
        assert.ok(world.gateField.charge >= BATTLE_ROYALE.gate.charge.asleep);
        assert.ok(world.singularity.size > 0 && world.singularity.size < 0.1, 'the black hole is in the sky already, far off');
        assert.equal(world.warpFactor, 0);
    }

    // The last moments: the jump's streaks come up, and its sound once.
    const warps = [];
    match.clients[0].session.events.on('warp', ({ stage }) => warps.push(stage));
    match.run(INTRO.gate.seconds - 1.5 - 0.4);
    for (const device of match.devices) assert.ok(device.world.warpFactor > 0.3, `${device.id}: ${device.world.warpFactor}`);
    assert.deepEqual(warps, ['spool']);
});

test('when the host lets the ships in, every device drops the story in the same moment and shows its own planet', () => {
    const match = createTestMatch(['host', 'ann', 'bo', 'cy'], { start: withIntro });
    const arrived = new Map();
    const warps = [];
    match.clients[0].session.events.on('warp', ({ stage }) => warps.push(stage));
    for (let time = 0; time < INTRO.seconds + 1; time += 1 / 60) {
        match.step();
        for (const device of match.devices) {
            if (!arrived.has(device.id) && device.world.player?.alive) arrived.set(device.id, match.clock());
        }
    }

    assert.equal(arrived.size, 4);
    const times = [...arrived.values()];
    assert.ok(Math.max(...times) - Math.min(...times) < 0.04, `everybody is in within a frame or two of each other: ${times}`);
    assert.ok(Math.abs(times[0] - INTRO.seconds) < 0.1, 'when the host\'s count ran out');
    for (const device of match.devices) {
        const pilot = match.server.pilots.get(device.id);
        assert.equal(device.world.player.pilotId, device.id);
        assert.equal(device.world.sectorId, pilot.zone.sectorId, 'at the planet their side starts on');
        assert.equal(device.ui.matchIntro, null);
        assert.equal(device.ui.match.intro, null);
        assert.equal(device.world.ships.filter((ship) => ship.classId === BATTLE_ROYALE.station.classId).length, 1, 'the place is the host\'s: nothing of the stage is left in it');
        assert.equal(device.world.singularity.size, 0);
        assert.equal(presenterOf(device).intro, null);
    }
    assert.deepEqual(warps, ['spool', 'arrive'], 'out of the story\'s jump into the system');
    match.run(2);
    for (const device of match.devices) assert.equal(device.world.warpFactor, 0, 'and the streaks let go');
});

test('a device on a slow link shows the same story and enters with the rest', () => {
    const match = createTestMatch(['host', 'ann'], { start: withIntro, latency: 0.15 });
    match.run(5);
    const [ann] = match.clients;
    const host = presenterOf(match.host).intro.clock.elapsed;
    assert.ok(Math.abs(presenterOf(ann).intro.clock.elapsed - host) < 0.5);

    // Its page is in the background for a while: its own clock stops, the host's does not.
    presenterOf(ann).intro.clock.elapsed = 1;
    match.run(0.6);
    assert.ok(Math.abs(presenterOf(ann).intro.clock.elapsed - presenterOf(match.host).intro.clock.elapsed) < 1.4, 'the host\'s next word puts it right');

    match.run(INTRO.seconds - 5.6 + 0.4);
    assert.ok(ann.world.player?.alive && match.host.world.player?.alive, 'in together, a link\'s delay apart');
});

test('a player skips: their device says so and goes on waiting; when all have, all are in at once, early', () => {
    const match = createTestMatch(['host', 'ann', 'bo'], { start: withIntro });
    const [ann, bo] = match.clients;
    match.run(0.3);
    presenterOf(ann).skipIntro();
    match.run(0.3);
    assert.equal(ann.ui.matchIntro.skipped, false, 'a press in the first moment is the one that started the match');
    assert.equal(match.server.mode.introSkips.size, 0);

    match.run(1.4);
    presenterOf(ann).skipIntro();
    presenterOf(ann).skipIntro();
    match.run(0.3);
    assert.equal(ann.ui.matchIntro.skipped, true);
    assert.deepEqual(ann.ui.match.skip, { voted: 1, voters: 3, you: true });
    assert.deepEqual(bo.ui.match.skip, { voted: 1, voters: 3, you: false }, 'the others see that somebody has');
    assert.equal(bo.ui.matchIntro.skipped, false);
    assert.equal(ann.world.player.alive, false, 'she is not in the system before the others');
    assert.equal(ann.world.sectorId, INTRO.fall.sectorId, 'the story goes on behind her list of the sides');

    presenterOf(bo).skipIntro();
    presenterOf(match.host).skipIntro();
    match.run(0.2);
    assert.ok(match.clock() < 3, 'well before the story would have ended');
    for (const device of match.devices) {
        assert.ok(device.world.player?.alive, `${device.id} is in`);
        assert.equal(device.ui.matchIntro, null);
        assert.equal(device.ui.match.intro, null);
    }
});

test('a wish to skip that a new host never heard of is told again', () => {
    const match = createTestMatch(['host', 'ann'], { start: withIntro });
    const [ann] = match.clients;
    match.run(1);
    presenterOf(ann).skipIntro();
    match.run(0.2);
    assert.ok(match.server.mode.introSkips.has('ann'));

    // As after a takeover from a checkpoint written before she asked.
    match.server.mode.introSkips.clear();
    match.run(2);
    assert.ok(match.server.mode.introSkips.has('ann'));
    assert.equal(match.server.pilots.get('ann').guard.strikes, 0);
});

test('leaving during the story leaves nothing of it behind', () => {
    const match = createTestMatch(['host', 'ann'], { start: withIntro });
    match.run(INTRO.fall.seconds + 2);
    const [ann] = match.clients;
    assert.ok(ann.world.singularity.size > 0);

    ann.session.enterTitle();

    assert.equal(ann.ui.matchIntro, null);
    assert.equal(ann.world.singularity.size, 0);
    assert.equal(ann.world.screenFade, 0);
    assert.equal(ann.world.warpFactor, 0);
    assert.equal(ann.session.phase, 'title');
});

test('a device that gives its picture back to the host is sent the place it is in again, whole', () => {
    // The mechanism under the story's end (ClientMatch.leaveStage), here in the middle of a match:
    // the host's welcome for this place came long ago, so the device has to ask for it again.
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    const [ann] = match.clients;
    const sectorId = ann.world.sectorId;
    const ships = ann.world.ships.length;

    ann.match.takeStage(INTRO.fall.sectorId);
    match.run(0.5);
    assert.equal(ann.world.ships.length, 0);
    assert.equal(ann.world.sectorId, INTRO.fall.sectorId);

    ann.match.leaveStage();
    ann.match.leaveStage();
    match.run(0.5);
    assert.equal(ann.world.sectorId, sectorId);
    assert.equal(ann.world.player?.pilotId, 'ann');
    assert.ok(ann.world.player.alive);
    assert.equal(ann.world.ships.length, ships);
    assert.equal(match.server.pilots.get('ann').guard.strikes, 0);
});

test('a match with no introduction shows none', () => {
    const match = createTestMatch(['host', 'ann']);
    match.run(0.5);
    for (const device of match.devices) {
        assert.equal(device.ui.matchIntro ?? null, null);
        assert.ok(device.world.player?.alive);
        assert.equal(presenterOf(device).intro, null);
    }
});

// ---- In the headset --------------------------------------------------------------------------

const WATCHING = { act: INTRO_ACT.GATE, line: 4, sides: true, skipped: false };
const introState = (matchIntro, skip = { voted: 0, voters: 2, you: false }) => ({
    match: {
        phase: MATCH_PHASE.PLAYING, intro: 3, skip, you: { faction: UMBRA },
        players: [{ id: 'a', name: 'Ann', faction: DAWN }, { id: 'b', name: 'Bo', faction: UMBRA }, { id: 'c', name: 'Cy', faction: UMBRA }],
    },
    matchIntro,
    matchOutro: null,
});

test('in the headset nothing is put over the story - until the pilot skips it', () => {
    const watching = introState(WATCHING);
    assert.equal(isStoryShown(watching), true);
    assert.equal(matchMenuPlace(watching, false), MENU_PLACE.NONE);
    assert.equal(isMenuShown(matchMenuPlace(watching, false)), false);

    const skipped = introState({ ...WATCHING, skipped: true });
    assert.equal(isStoryShown(skipped), false);
    assert.equal(matchMenuPlace(skipped, false), MENU_PLACE.FRONT, 'then the list of the sides hangs in front');

    const flying = { ...watching, match: { ...watching.match, intro: null }, matchIntro: null };
    assert.equal(isStoryShown(flying), false);
    assert.equal(matchMenuPlace(flying, false), MENU_PLACE.FRONT);
    assert.equal(isStoryShown({ match: null, matchIntro: null }), false);
});

const words = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

test('the headset\'s caption: the line that is up, the pilot\'s own side first, and how to skip', () => {
    const last = INTRO.lines.length - 1;
    const first = storyCaption({ act: INTRO_ACT.FALL, line: 0, sides: false, skipped: false }, introState(null).match, words, last);
    assert.equal(first.title, 'mp.intro.title');
    assert.equal(first.line, 'mp.intro.line1');
    assert.deepEqual([first.last, first.yours, first.others], [false, null, null]);
    assert.ok(first.hint.startsWith('mp.intro.skipVR') && first.hint.includes('mp.intro.entering{"seconds":3}'));

    const end = storyCaption(WATCHING, introState(null, { voted: 1, voters: 2, you: false }).match, words, last);
    assert.equal(end.title, null);
    assert.equal(end.line, 'mp.intro.line5');
    assert.equal(end.last, true);
    assert.ok(end.yours.includes('mp.faction.umbra') && end.yours.includes('"count":2'), end.yours);
    assert.ok(end.others.includes('mp.faction.dawn') && end.others.includes('mp.faction.pirate') && !end.others.includes('umbra'), end.others);
    assert.ok(end.hint.includes('mp.intro.votes{"voted":1,"voters":2'), 'and that somebody has skipped already');
});

test('the caption is drawn under the line of sight, clear of the middle of the view', () => {
    const calls = [];
    const state = { font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 1, lineJoin: '' };
    const ctx = new Proxy(state, {
        get(target, name) {
            if (name === 'measureText') return (text) => ({ width: [...String(text)].length * 9 });
            if (name in target) return target[name];
            return (...args) => calls.push({ name, args, font: target.font });
        },
        set(target, name, value) {
            target[name] = value;
            return true;
        },
    });
    const last = INTRO.lines.length - 1;
    const long = { ...storyCaption(WATCHING, introState(null).match, (key) => translate('en', key).replace(/\{\w+\}/g, '4'), last), title: 'Helion is dying' };
    drawStoryCaption(ctx, long, 640, 'sans-serif');

    const texts = calls.filter((call) => call.name === 'fillText');
    assert.ok(texts.length >= 5, 'title, the line (wrapped), the sides, the hint');
    for (const { args: [text, x, y] } of texts) {
        assert.equal(x, 320, 'centred');
        assert.ok(y > 300 && y < 460, `"${text}" at ${y}: well under the line of sight (240), inside the pane (480)`);
        assert.ok([...text].length * 9 <= 640, 'and never wider than the pane');
    }
    assert.equal(calls.filter((call) => call.name === 'fillRect' || call.name === 'rect').length, 0, 'words only: no panel behind them');
    assert.equal(calls.filter((call) => call.name === 'strokeText').length, texts.length, 'each with a dark edge, to read over a bright sky');
});
