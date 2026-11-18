import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { applyDamage, destroyShip, drainShip } from '../../src/game/core/systems/damage.js';
import en from '../../src/game/i18n/en.js';
import { translate } from '../../src/game/i18n/index.js';
import zh from '../../src/game/i18n/zh.js';
import { PLANET_STATUS } from '../../src/game/modes/battleRoyale/collapse.js';
import {
    FEED_TYPE, FEED_WEIGHT, KILL_CAUSE, KILL_WEAPONS, describeKill, readFor, sanitizeFeedMessage,
} from '../../src/game/net/match/feed.js';
import { WORLD_EVENT } from '../../src/game/net/protocol.js';
import { MESSAGE_FEED, MessageFeed, lineOpacity, shownLines } from '../../src/game/state/MessageFeed.js';
import { FEED_ROLE, feedSegments, feedText } from '../../src/game/ui/feedText.js';
import { FEED_MAX_WIDTH, FEED_RIGHT, FEED_TOP, drawMessageFeed } from '../../src/game/xr/vrMessageFeed.js';
import { createTestMatch } from './support/matchHarness.js';

/**
 * The message feed: the lines at the side of the screen that say who shot whom down. The
 * host says them (net/match/feed.js, MatchServer.announce), every device checks and keeps
 * them for a few seconds (state/MessageFeed.js), and the page and the headset draw the same
 * words (ui/feedText.js, xr/vrMessageFeed.js).
 */

const { DAWN, UMBRA, PIRATE, NEUTRAL } = FACTION;
const PLANETS = STAR_SYSTEM.planets.map((planet) => planet.id);
const [, SECOND, THIRD] = PLANETS;
const tZh = (key, params) => translate('zh', key, params);
const tEn = (key, params) => translate('en', key, params);

/** A ship as the feed's host half reads one. */
const hull = (classId, faction, extra = {}) => ({ classId, faction, isPlayer: false, pilotId: null, callsign: null, parent: null, alive: true, invulnerable: false, ...extra });
const flown = (name, classId, faction) => hull(classId, faction, { isPlayer: true, pilotId: name, callsign: name });
const party = (id, ship, faction) => ({ id, name: id, ship, faction });
const npc = (ship, faction) => ({ id: null, name: null, ship, faction });
const kill = (killer, victim, extra = {}) => ({ type: FEED_TYPE.KILL, killer, victim, weapon: null, cause: killer ? null : KILL_CAUSE.CRASH, ...extra });

// ---- What the host says ---------------------------------------------------------------------

test('a kill names both ends: a pilot by id and name, a computer-flown ship by class and side - and the weapon', () => {
    const line = describeKill(hull('raider', UMBRA), flown('ann', 'kestrel', DAWN), { weapon: WEAPONS.playerBeam });
    assert.deepEqual(line, {
        killer: { id: 'ann', name: 'ann', ship: 'kestrel', faction: DAWN },
        victim: { id: null, name: null, ship: 'raider', faction: UMBRA },
        weapon: 'beam',
        cause: null,
    });
    assert.equal(describeKill(flown('bo', 'swift', PIRATE), hull('dart', DAWN), { weapon: WEAPONS.dartBolt }).weapon, 'bolt');
    assert.equal(describeKill(flown('bo', 'swift', PIRATE), hull('dart', DAWN)).weapon, null, 'no weapon known: none named');
    assert.equal(describeKill(flown('bo', 'swift', PIRATE), hull('dart', DAWN), { weapon: { type: 'tractor' } }).weapon, null, 'nor a kind the feed has no word for');
});

test('every kind of weapon in the game has its word in the feed', () => {
    const kinds = new Set(Object.values(WEAPONS).map((weapon) => weapon.type));
    assert.deepEqual([...kinds].filter((kind) => !KILL_WEAPONS.includes(kind)), []);
});

test('a kill by a gun bolted on to a hull is the hull\'s', () => {
    const carrier = hull('penumbra', UMBRA);
    const battery = hull('eclipseCannon', UMBRA, { parent: carrier });
    assert.deepEqual(describeKill(flown('ann', 'kestrel', DAWN), battery, { weapon: WEAPONS.eclipseCannon }).killer, npc('penumbra', UMBRA));
});

test('what goes down with its hull, scenery, and a computer-flown ship nobody shot are not news', () => {
    const ann = flown('ann', 'kestrel', DAWN);
    const carrier = hull('penumbra', UMBRA, { alive: false });
    assert.equal(describeKill(hull('eclipseCannon', UMBRA, { parent: carrier }), ann), null, 'a battery lost with its mothership');
    assert.ok(describeKill(hull('eclipseCannon', UMBRA, { parent: hull('penumbra', UMBRA) }), ann), 'a battery shot off a living one is');
    assert.equal(describeKill(hull('lanternStation', NEUTRAL), ann), null);
    assert.equal(describeKill(hull('wreck', UMBRA, { invulnerable: true }), ann), null);
    assert.equal(describeKill(hull('raider', UMBRA), null, { cause: KILL_CAUSE.COLLAPSE }), null, 'the black hole takes garrisons by the dozen');
});

test('a pilot nobody shot down is in the feed with what ended them', () => {
    const ann = flown('ann', 'kestrel', DAWN);
    assert.deepEqual(describeKill(ann, null, { cause: KILL_CAUSE.COLLAPSE }), { killer: null, victim: party('ann', 'kestrel', DAWN), weapon: null, cause: KILL_CAUSE.COLLAPSE });
    assert.equal(describeKill(ann, null).cause, KILL_CAUSE.CRASH, 'with nothing said, they flew into something');
    assert.equal(describeKill(ann, ann, { weapon: WEAPONS.playerTorpedo }).killer, null, 'a ship that ends itself was shot down by nobody');
});

// ---- What a device accepts ------------------------------------------------------------------

test('a line from the host comes out in a known shape, whatever else was in it', () => {
    const raw = {
        killer: { id: 'ann', name: 'Ann', ship: 'kestrel', faction: DAWN, hacked: true },
        victim: { id: null, name: 'not a pilot', ship: 'raider', faction: UMBRA },
        weapon: 'torpedo', cause: 'collapse', extra: 1,
    };
    assert.deepEqual(sanitizeFeedMessage(FEED_TYPE.KILL, raw), {
        type: FEED_TYPE.KILL,
        killer: { id: 'ann', name: 'Ann', ship: 'kestrel', faction: DAWN },
        // (Only a pilot has a name of their own.)
        victim: { id: null, name: null, ship: 'raider', faction: UMBRA },
        weapon: 'torpedo',
        // (Somebody shot them down: nothing else did.)
        cause: null,
    });
    const long = sanitizeFeedMessage(FEED_TYPE.KILL, { killer: null, victim: { id: 'bo', name: 'x'.repeat(500), ship: 'swift', faction: PIRATE }, cause: 'collapse' });
    assert.equal(long.victim.name.length, 40);
    assert.equal(long.cause, KILL_CAUSE.COLLAPSE);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { killer: null, victim: party('bo', 'swift', PIRATE), cause: 'boredom' }).cause, KILL_CAUSE.CRASH);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { killer: party('ann', 'kestrel', DAWN), victim: party('bo', 'swift', PIRATE), weapon: 'spoon' }).weapon, null);
});

test('a line that is not one is dropped: an unknown type, a ship or a side the game has not got, no victim', () => {
    const good = { killer: party('ann', 'kestrel', DAWN), victim: npc('raider', UMBRA) };
    assert.ok(sanitizeFeedMessage(FEED_TYPE.KILL, good));
    // A kind of line a later build may send (what players say to each other): not this build's to show.
    assert.equal(sanitizeFeedMessage('chat', { from: 'ann', text: 'hello' }), null);
    assert.equal(sanitizeFeedMessage('toString', good), null);
    assert.equal(sanitizeFeedMessage(7, good), null);
    for (const data of [null, 'kill', [], 5]) assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, data), null);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { ...good, victim: null }), null);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { ...good, victim: npc('deathStar', UMBRA) }), null);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { ...good, victim: npc('raider', 'rebels') }), null);
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { ...good, victim: npc('lanternStation', NEUTRAL) }), null, 'a ship of no side is in no line');
    assert.equal(sanitizeFeedMessage(FEED_TYPE.KILL, { ...good, killer: { id: 'ann' } }), null, 'a killer that is not a party spoils the line');
});

test('a line is read by a player: theirs when they are in it, weightier when any pilot is', () => {
    const duel = kill(party('ann', 'kestrel', DAWN), party('bo', 'swift', PIRATE));
    assert.deepEqual([readFor(duel, 'ann').you, readFor(duel, 'ann').weight], ['killer', FEED_WEIGHT.OWN]);
    assert.deepEqual([readFor(duel, 'bo').you, readFor(duel, 'bo').weight], ['victim', FEED_WEIGHT.OWN]);
    assert.deepEqual([readFor(duel, 'cy').you, readFor(duel, 'cy').weight], [null, FEED_WEIGHT.PILOT]);
    const garrisons = kill(npc('dart', DAWN), npc('raider', UMBRA));
    assert.deepEqual([readFor(garrisons, 'ann').you, readFor(garrisons, 'ann').weight], [null, FEED_WEIGHT.BACKGROUND]);
    assert.equal(readFor(kill(null, party('ann', 'kestrel', DAWN), { cause: KILL_CAUSE.COLLAPSE }), 'ann').you, 'victim');
    assert.equal(readFor(kill(npc('dart', DAWN), party('bo', 'swift', PIRATE)), 'cy').weight, FEED_WEIGHT.PILOT);
});

// ---- Keeping the lines -----------------------------------------------------------------------

function feedWithLog(config) {
    const changes = [];
    const feed = new MessageFeed({ onChange: (lines) => changes.push(lines), ...(config ? { config } : {}) });
    return { feed, changes, last: () => changes.at(-1) };
}

test('a line stays up for its seconds and goes; one about the player stays longer; with none left the feed is empty', () => {
    const { feed, changes, last } = feedWithLog();
    feed.post({ type: 'kill', weight: FEED_WEIGHT.PILOT });
    feed.update(1);
    feed.post({ type: 'kill', weight: FEED_WEIGHT.OWN });
    assert.deepEqual(last().map((line) => [line.id, line.at, line.until]), [[1, 0, MESSAGE_FEED.seconds], [2, 1, 1 + MESSAGE_FEED.ownSeconds]]);
    const before = changes.length;
    feed.update(MESSAGE_FEED.seconds - 1.5);
    assert.equal(changes.length, before, 'nothing is published while nothing comes or goes');
    feed.update(0.6);
    assert.deepEqual(last().map((line) => line.id), [2]);
    feed.update(MESSAGE_FEED.ownSeconds);
    assert.deepEqual(last(), []);
    assert.ok(MESSAGE_FEED.ownSeconds > MESSAGE_FEED.seconds);
});

test('every change is a new list, oldest line first', () => {
    const { feed, changes } = feedWithLog();
    feed.post({ type: 'kill', weight: 0 });
    feed.post({ type: 'kill', weight: 0 });
    assert.notEqual(changes[0], changes[1]);
    assert.deepEqual(changes[1].map((line) => line.id), [1, 2]);
    feed.clear();
    assert.deepEqual(changes.at(-1), []);
    const count = changes.length;
    feed.clear();
    assert.equal(changes.length, count, 'clearing an empty feed changes nothing');
});

test('short of room, the weightier lines are shown, the newer among equals, in the order they came', () => {
    const lines = [
        { id: 1, weight: 0 }, { id: 2, weight: 1 }, { id: 3, weight: 0 }, { id: 4, weight: 2 }, { id: 5, weight: 0 }, { id: 6, weight: 0 },
    ];
    const ids = (rows) => shownLines(lines, rows).map((line) => line.id);
    assert.deepEqual(ids(6), [1, 2, 3, 4, 5, 6]);
    assert.equal(shownLines(lines, 9), lines, 'with room for all, the list itself');
    assert.deepEqual(ids(3), [2, 4, 6], 'a pilot\'s line is not pushed off by garrisons shooting each other');
    assert.deepEqual(ids(2), [2, 4]);
    assert.deepEqual(ids(1), [4]);
    assert.deepEqual(ids(0), []);
});

test('the feed keeps no more lines than its capacity, and lets the lightest go first', () => {
    const { feed, last } = feedWithLog({ ...MESSAGE_FEED, capacity: 3 });
    feed.post({ type: 'kill', weight: FEED_WEIGHT.OWN, tag: 'mine' });
    for (let index = 0; index < 5; index++) feed.post({ type: 'kill', weight: FEED_WEIGHT.BACKGROUND });
    assert.equal(last().length, 3);
    assert.equal(last()[0].tag, 'mine');
    assert.deepEqual(last().map((line) => line.id), [1, 5, 6]);
    assert.ok(MESSAGE_FEED.capacity >= Math.max(...Object.values(MESSAGE_FEED.rows)), 'more is kept than any screen shows');
});

test('a line comes in quickly, holds, and fades out at the end of its time', () => {
    const line = { at: 10, until: 16 };
    assert.equal(lineOpacity(line, 9.9), 0);
    assert.ok(lineOpacity(line, 10.05) > 0 && lineOpacity(line, 10.05) < 1);
    assert.equal(lineOpacity(line, 10.5), 1);
    assert.equal(lineOpacity(line, 15), 1);
    assert.ok(Math.abs(lineOpacity(line, 16 - MESSAGE_FEED.fadeOut / 2) - 0.5) < 1e-9);
    assert.equal(lineOpacity(line, 16), 0);
});

// ---- The words -------------------------------------------------------------------------------

test('a kill reads: side and name of who did it, the weapon, side and name of who was shot down', () => {
    const line = kill(party('Vega', 'kestrel', DAWN), npc('raider', UMBRA), { weapon: 'torpedo' });
    assert.deepEqual(feedSegments(tZh, line), [
        { text: '联邦', tone: DAWN, role: FEED_ROLE.TAG },
        { text: 'Vega', tone: DAWN, role: FEED_ROLE.NAME },
        { text: '鱼雷', tone: 'muted', role: FEED_ROLE.LINK },
        { text: '异星', tone: UMBRA, role: FEED_ROLE.TAG },
        { text: zh['ship.raider'], tone: UMBRA, role: FEED_ROLE.NAME },
    ]);
    assert.equal(feedText(tEn, line), `FED Vega torpedo UMB ${en['ship.raider']}`);
    assert.equal(feedText(tZh, { ...line, weapon: null }), `联邦 Vega 击毁 异星 ${zh['ship.raider']}`);
});

test('a phone gets the short way of saying it: colours for the sides, an arrow for the weapon', () => {
    const line = kill(npc('harrier', DAWN), party('AI·Rigel', 'swift', PIRATE), { weapon: 'beam' });
    const pieces = feedSegments(tZh, line, { compact: true });
    assert.deepEqual(pieces.map((piece) => piece.text), [zh['ship.harrier'], '▸', 'AI·Rigel']);
    assert.deepEqual(pieces.map((piece) => piece.tone), [DAWN, 'muted', PIRATE]);
    assert.ok(pieces.every((piece) => piece.role !== FEED_ROLE.TAG));
});

test('between the two there is a middle way: the sides named, an arrow for the weapon', () => {
    const line = kill(party('Vega', 'kestrel', DAWN), npc('raider', UMBRA), { weapon: 'torpedo' });
    assert.equal(feedText(tEn, line, { weapons: false }), `FED Vega ▸ UMB ${en['ship.raider']}`);
    assert.equal(feedText(tEn, line, { tags: false }), `Vega torpedo ${en['ship.raider']}`);
});

test('a pilot nobody shot down: who, and what ended them', () => {
    const line = kill(null, party('Bo', 'swift', UMBRA), { cause: KILL_CAUSE.COLLAPSE });
    assert.equal(feedText(tZh, line), '异星 Bo 被黑洞吞没');
    assert.equal(feedSegments(tZh, line).at(-1).tone, 'warn');
    assert.equal(feedText(tEn, { ...line, cause: KILL_CAUSE.CRASH }, { compact: true }), 'Bo crashed');
});

test('a very long name is cut short, and a line of a kind without words has none', () => {
    const line = kill(party('TheLongestNameAnyoneEverTyped', 'kestrel', DAWN), npc('drone', UMBRA));
    const name = feedSegments(tEn, line)[1].text;
    assert.ok(name.length <= 14 && name.endsWith('…'), name);
    assert.deepEqual(feedSegments(tEn, { type: 'chat', text: 'hello' }), []);
});

test('everything the feed can say has its words, in both languages', () => {
    const keys = [
        'mp.feed.title', 'mp.feed.kill',
        ...KILL_WEAPONS.map((weapon) => `mp.feed.weapon.${weapon}`),
        ...Object.values(KILL_CAUSE).map((cause) => `mp.feed.cause.${cause}`),
        ...[DAWN, UMBRA, PIRATE].map((faction) => `mp.feed.side.${faction}`),
    ];
    assert.deepEqual(keys.filter((key) => !(key in en) || !(key in zh)), []);
});

// ---- From the host to every device -----------------------------------------------------------

/** A battle royale between three devices, each pilot put on a side at a planet with nothing else flying there. */
function threeDevices() {
    const match = createTestMatch(['host', 'ann', 'bo']);
    match.run(0.5);
    const { server } = match;
    const { mode } = server;
    const put = (name, faction, planet) => {
        const contestant = mode.contestants.get(name);
        const { pilot } = contestant;
        if (pilot.ship?.alive) pilot.zone.world.removeShip(pilot.ship);
        contestant.faction = faction;
        mode.launch(contestant, mode.places.get(planet), { warpIn: false }).throttle = 0;
    };
    for (const planet of [SECOND, THIRD]) {
        const { world } = mode.places.get(planet).zone;
        for (const ship of world.ships.filter((other) => other.alive && !other.isPlayer && !other.invulnerable && other.faction !== NEUTRAL)) world.removeShip(ship);
    }
    put('host', DAWN, SECOND);
    put('ann', UMBRA, SECOND);
    put('bo', PIRATE, THIRD);
    match.run(0.5);
    const world = (planet) => mode.places.get(planet).zone.world;
    const ship = (name) => server.pilots.get(name).ship;
    /** What a device's store holds (a real store starts with an empty list; the test's sink with nothing). */
    const feedOf = (name) => match.devices.find((device) => device.id === name).ui.feed ?? [];
    return { match, server, mode, world, ship, feedOf };
}

test('a pilot shot down is on every device\'s feed at once, wherever its player is - and each reads it their own way', () => {
    const { match, world, ship, feedOf } = threeDevices();
    assert.deepEqual(feedOf('bo'), [], 'nothing to say yet');
    applyDamage(world(SECOND), ship('ann'), 1e6, { source: ship('host'), weapon: WEAPONS.playerTorpedo });
    match.run(0.2);
    for (const name of ['host', 'ann', 'bo']) {
        assert.equal(feedOf(name).length, 1, `${name}'s device`);
        const [line] = feedOf(name);
        assert.equal(line.type, FEED_TYPE.KILL);
        assert.deepEqual(line.killer, { id: 'host', name: 'host', ship: 'kestrel', faction: DAWN });
        assert.deepEqual(line.victim, { id: 'ann', name: 'ann', ship: 'kestrel', faction: UMBRA });
        assert.equal(line.weapon, 'torpedo');
    }
    // (Bo is at another planet: the news travels, where it happened does not.)
    assert.deepEqual(['host', 'ann', 'bo'].map((name) => feedOf(name)[0].you), ['killer', 'victim', null]);
    assert.equal(feedText(tEn, feedOf('bo')[0]), 'FED host torpedo UMB ann');
});

test('computer-flown ships are news too: who shot one down, and what one shot down', () => {
    const { match, world, ship, feedOf } = threeDevices();
    const raider = world(THIRD).spawnShip('raider', { faction: UMBRA, position: ship('bo').position.clone().add({ x: 0, y: 0, z: -600 }) });
    const dart = world(THIRD).spawnShip('dart', { faction: DAWN, position: ship('bo').position.clone().add({ x: 0, y: 300, z: -600 }) });
    destroyShip(world(THIRD), raider, dart, { weapon: WEAPONS.dartBolt });
    match.run(0.2);
    assert.equal(feedText(tEn, feedOf('host').at(-1)), `FED ${en['ship.dart']} guns UMB ${en['ship.raider']}`);
    assert.equal(feedOf('host').at(-1).weight, FEED_WEIGHT.BACKGROUND);
    destroyShip(world(THIRD), ship('bo'), dart, { weapon: WEAPONS.dartBolt });
    match.run(0.2);
    const line = feedOf('ann').at(-1);
    assert.deepEqual([line.killer.id, line.killer.ship, line.victim.id, line.weight], [null, 'dart', 'bo', FEED_WEIGHT.PILOT]);
    assert.equal(feedOf('bo').at(-1).you, 'victim');
});

test('a pilot the black hole takes is announced as its own; the garrison it takes with them is not', () => {
    const { match, mode, world, ship, feedOf } = threeDevices();
    const raider = world(THIRD).spawnShip('raider', { faction: UMBRA, position: ship('bo').position.clone().add({ x: 0, y: 0, z: -900 }) });
    mode.places.get(THIRD).status = PLANET_STATUS.SWALLOWED;
    drainShip(world(THIRD), raider, 1e6);
    drainShip(world(THIRD), ship('bo'), 1e6);
    match.run(0.2);
    assert.equal(feedOf('host').length, 1);
    assert.deepEqual([feedOf('host')[0].killer, feedOf('host')[0].cause, feedOf('host')[0].victim.id], [null, KILL_CAUSE.COLLAPSE, 'bo']);
    // At a planet that stands, a pilot nobody shot down flew into something.
    destroyShip(world(SECOND), ship('ann'), null);
    match.run(0.2);
    assert.equal(feedOf('bo').at(-1).cause, KILL_CAUSE.CRASH);
});

test('with nothing new the feed empties by itself, and a match that is left takes its lines with it', () => {
    const { match, world, ship, feedOf } = threeDevices();
    applyDamage(world(SECOND), ship('ann'), 1e6, { source: ship('host'), weapon: WEAPONS.playerBeam });
    match.run(MESSAGE_FEED.seconds + 0.5);
    assert.deepEqual(feedOf('bo'), [], 'six seconds for a bystander');
    assert.equal(feedOf('host').length, 1, 'longer for the two it is about');
    assert.equal(feedOf('ann').length, 1);
    match.run(MESSAGE_FEED.ownSeconds - MESSAGE_FEED.seconds);
    assert.deepEqual(feedOf('host'), []);

    applyDamage(world(THIRD), ship('bo'), 1e6, { source: ship('host'), weapon: WEAPONS.playerBeam });
    match.run(0.2);
    assert.equal(feedOf('bo').length, 1);
    match.devices.find((device) => device.id === 'bo').session.enterTitle();
    assert.deepEqual(feedOf('bo'), []);
});

test('the host\'s lines travel as feed entries with a type, and a type a device does not know does it no harm', () => {
    const { match, server, world, ship, feedOf } = threeDevices();
    const heard = [];
    const ann = server.pilots.get('ann');
    const tell = ann.tell.bind(ann);
    ann.tell = (...entry) => { heard.push(entry); tell(...entry); };
    applyDamage(world(SECOND), ship('ann'), 1e6, { source: ship('host'), weapon: WEAPONS.playerBeam });
    const entries = heard.filter((entry) => entry[0] === WORLD_EVENT.FEED);
    assert.equal(entries.length, 1);
    assert.equal(entries[0][1], FEED_TYPE.KILL);
    assert.equal(entries[0][2].victim.id, 'ann');
    // What a later build's host might say: this one's devices let it pass.
    server.announce('chat', { from: 'host', text: 'gg' });
    server.announce(FEED_TYPE.KILL, { victim: 'nobody' });
    match.run(0.2);
    for (const name of ['host', 'ann', 'bo']) assert.equal(feedOf(name).length, 1, name);
    // And a line can be for some pilots only.
    server.announce(FEED_TYPE.KILL, { killer: null, victim: { id: 'bo', name: 'bo', ship: 'kestrel', faction: PIRATE }, cause: KILL_CAUSE.CRASH }, [server.pilots.get('bo')]);
    match.run(0.2);
    assert.deepEqual(['host', 'ann', 'bo'].map((name) => feedOf(name).length), [1, 1, 2]);
});

// ---- In the headset ---------------------------------------------------------------------------

/** A pretend canvas that writes down what was drawn, with the colours in force - and where, through translate and scale. */
function recordingContext() {
    const calls = [];
    const state = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', globalAlpha: 1, x: 0, y: 0, sx: 1 };
    const stack = [];
    const note = (name, x, width, extra = {}) => calls.push({ name, left: state.x + x * state.sx, right: state.x + (x + width) * state.sx, y: state.y, fillStyle: state.fillStyle, alpha: state.globalAlpha, ...extra });
    const measure = (text) => [...String(text)].length * 7;
    const methods = {
        measureText: (text) => ({ width: measure(text) }),
        save: () => stack.push({ ...state }),
        restore: () => Object.assign(state, stack.pop()),
        translate: (x, y) => { state.x += x * state.sx; state.y += y; },
        scale: (x) => { state.sx *= x; },
        fillText: (text, x) => note('fillText', x, measure(text), { text }),
        fillRect: (x, y, width) => note('fillRect', x, width, { top: y }),
        strokeRect: (x, y, width) => note('strokeRect', x, width),
        moveTo: (x, y) => note('moveTo', x, 0, { top: y }),
        fill: () => calls.push({ name: 'fill', fillStyle: state.fillStyle, alpha: state.globalAlpha }),
    };
    const ctx = new Proxy(state, {
        get(target, name) {
            if (name in methods) return methods[name];
            if (name in target) return target[name];
            return () => {};
        },
        set(target, name, value) {
            target[name] = value;
            return true;
        },
    });
    return { ctx, calls };
}

const kept = (message, id, at = 0) => ({ ...message, id, at, until: at + MESSAGE_FEED.seconds });

test('in the headset the lines stand in a column at the right edge, none wider than it, none over the middle', () => {
    const { ctx, calls } = recordingContext();
    const lines = [
        kept(readFor(kill(party('Vega', 'kestrel', DAWN), npc('raider', UMBRA), { weapon: 'beam' }), 'me'), 1),
        kept(readFor(kill(npc('penumbra', UMBRA), party('TheLongestNameAnyoneEverTyped', 'bulwark', PIRATE), { weapon: 'lance' }), 'me'), 2),
        kept(readFor(kill(null, party('Bo', 'swift', UMBRA), { cause: KILL_CAUSE.COLLAPSE }), 'me'), 3),
    ];
    drawMessageFeed(ctx, lines, tEn, 1);
    const texts = calls.filter((call) => call.name === 'fillText');
    assert.ok(texts.length >= 8);
    for (const call of calls.filter((entry) => 'left' in entry)) {
        assert.ok(call.right <= FEED_RIGHT + 1e-6, `${call.name} ${call.text ?? ''} ends at ${call.right}`);
        assert.ok(call.left >= FEED_RIGHT - FEED_MAX_WIDTH - 1e-6, `${call.name} ${call.text ?? ''} starts at ${call.left}`);
    }
    // Three rows, one under the other from the column's top.
    const rows = [...new Set(texts.map((call) => call.y))].sort((a, b) => a - b);
    assert.equal(rows.length, 3);
    assert.ok(rows[0] > FEED_TOP && rows[2] < FEED_TOP + 80);
    assert.ok(texts.some((call) => call.text === 'Vega') && texts.some((call) => call.text === en['mp.feed.cause.collapse']));
});

test('in the headset a line about the pilot themself is on its own colour, a fading line is fainter, and no lines draw nothing', () => {
    const mine = kept(readFor(kill(party('me', 'kestrel', DAWN), npc('raider', UMBRA)), 'me'), 1);
    const lost = kept(readFor(kill(npc('raider', UMBRA), party('me', 'kestrel', DAWN)), 'me'), 2);
    const other = kept(readFor(kill(npc('dart', DAWN), npc('raider', UMBRA)), 'me'), 3);
    const strips = (time, lines) => {
        const { ctx, calls } = recordingContext();
        drawMessageFeed(ctx, lines, tEn, time);
        return calls.filter((call) => call.name === 'fill');
    };
    const fills = strips(1, [mine, lost, other]).map((call) => call.fillStyle);
    assert.equal(new Set(fills).size, 3, 'the player\'s kill, the player\'s end and somebody else\'s each have a strip of their own');
    assert.ok(strips(1, [other])[0].alpha === 1);
    const fading = strips(other.until - MESSAGE_FEED.fadeOut / 2, [other])[0].alpha;
    assert.ok(fading > 0 && fading < 1);
    assert.deepEqual(strips(other.until + 1, [other]), []);
    const { ctx, calls } = recordingContext();
    drawMessageFeed(ctx, [], tEn, 0);
    assert.deepEqual(calls, []);
});

test('in the headset a line too wide for the column is told a shorter way before it is squeezed', () => {
    const texts = (line) => {
        const { ctx, calls } = recordingContext();
        drawMessageFeed(ctx, [kept(readFor(line, 'me'), 1)], tEn, 1);
        return calls.filter((call) => call.name === 'fillText').map((call) => call.text);
    };
    // (The pretend canvas draws seven pixels a character.)
    assert.deepEqual(texts(kill(party('Al', 'kestrel', DAWN), party('Bo', 'swift', UMBRA), { weapon: 'beam' })), ['FED', 'Al', 'beam', 'UMB', 'Bo'], 'all of it while it fits');
    assert.deepEqual(texts(kill(party('Altair', 'kestrel', DAWN), party('Bo', 'swift', UMBRA), { weapon: 'torpedo' })), ['FED', 'Altair', '▸', 'UMB', 'Bo'], 'then an arrow for the weapon');
    assert.deepEqual(texts(kill(party('Altair', 'kestrel', DAWN), party('Betelgeuse', 'swift', UMBRA), { weapon: 'torpedo' })), ['Altair', '▸', 'Betelgeuse'], 'then the sides left to the colours');
});

test('in the headset only as many lines as it has rows are drawn: the weightier ones', () => {
    const { ctx, calls } = recordingContext();
    const lines = Array.from({ length: 7 }, (_, index) => kept(readFor(kill(npc('dart', DAWN), index === 1 ? party('Ann', 'swift', UMBRA) : npc('raider', UMBRA)), 'me'), index + 1));
    drawMessageFeed(ctx, lines, tEn, 1);
    const rows = new Set(calls.filter((call) => call.name === 'fillText').map((call) => call.y));
    assert.equal(rows.size, MESSAGE_FEED.rows.vr);
    assert.ok(calls.some((call) => call.text === 'Ann'), 'the one with a pilot in it is among them');
});
