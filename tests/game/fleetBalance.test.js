import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATTLE_ROYALE } from '../../src/game/config/battleRoyale.js';
import { FACTION } from '../../src/game/config/gameConfig.js';
import { Hangar, berthCarrier } from '../../src/game/modes/battleRoyale/carriers.js';
import { stationGarrison } from '../../src/game/modes/battleRoyale/garrisons.js';
import { buildStation } from '../../src/game/modes/battleRoyale/station.js';
import { Zone } from '../../src/game/net/server/Zone.js';

/**
 * The two fleets of a match are not built alike - the Federation's frigates and darts, the
 * Umbra's mothership, corvettes and swarms - but neither is the stronger: headless battles on
 * a real station's layout, at the match's own difficulty (BATTLE_ROYALE.difficulty, its
 * `classes` and `pilotsFirst` included). The seeds are fixed, so the numbers are always the same;
 * a change to a ship, a weapon, a garrison or a hangar that tilts the scales fails here.
 */

const { DAWN, UMBRA } = FACTION;
const STEP = 1 / 30;
const GARRISONS = BATTLE_ROYALE.garrisons;
const SECTORS = ['cinder', 'forge', 'home', 'veil', 'graveyard', 'lantern'];
const isCarrier = ([classId]) => classId === BATTLE_ROYALE.carrier.classId;

/** A planet's station with the garrisons of `sides` ({ faction: list }), mothership and hangar included. */
function planet(seed, sides, onGuard) {
    const sectorId = SECTORS[seed % SECTORS.length];
    const zone = new Zone(sectorId, sectorId, { seed, difficulty: BATTLE_ROYALE.difficulty });
    const station = buildStation(zone, BATTLE_ROYALE.station);
    const hangars = [];
    for (const [faction, list] of Object.entries(sides)) {
        stationGarrison(zone, station, faction, list.filter((entry) => !isCarrier(entry)), GARRISONS, onGuard);
        if (list.some(isCarrier)) {
            const ship = berthCarrier(zone, station, faction, BATTLE_ROYALE.carrier, hangars.length + 1);
            hangars.push(new Hangar({ id: hangars.length + 1, ship, dock: station.mouth, layout: BATTLE_ROYALE.carrier }));
        }
    }
    const step = () => {
        zone.world.update(STEP);
        for (const hangar of hangars) hangar.update(zone.world, STEP);
    };
    return { world: zone.world, station, step };
}

/** Battles between the two garrisons: how many each side wins outright in `seconds`. */
function battles(dawn, umbra, seeds = 12, seconds = 300) {
    const wins = { [DAWN]: 0, [UMBRA]: 0 };
    for (let seed = 1; seed <= seeds; seed++) {
        const { world, step } = planet(seed, { [DAWN]: dawn, [UMBRA]: umbra }, false);
        const standing = (faction) => world.ships.some((ship) => ship.alive && ship.faction === faction && !ship.parent);
        for (let elapsed = 0; elapsed < seconds && standing(DAWN) && standing(UMBRA); elapsed += STEP) step();
        if (!standing(UMBRA)) wins[DAWN] += 1;
        else if (!standing(DAWN)) wins[UMBRA] += 1;
    }
    return wins;
}

/** Damage a second a pilot's ship sitting at the dock takes from a garrison on guard there, over a minute. */
function fireAtTheDock(faction, list, seeds = 6, seconds = 60) {
    let taken = 0;
    for (let seed = 1; seed <= seeds; seed++) {
        const { world, station, step } = planet(seed, { [faction]: list }, true);
        const pilot = world.spawnShip('kestrel', {
            faction: faction === DAWN ? UMBRA : DAWN, position: station.mouth.toArray(), facing: [0, 0, 1], local: false, maxShield: 1e7,
        });
        for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
            const before = pilot.shield + pilot.hull;
            pilot.velocity.set(0, 0, 0);
            pilot.speed = 0;
            step();
            taken += Math.max(0, before - pilot.shield - pilot.hull);
        }
    }
    return taken / seeds / seconds;
}

const notOneSided = (wins, what) => {
    const decided = wins[DAWN] + wins[UMBRA];
    assert.ok(decided >= 6, `${what}: most battles are decided (${JSON.stringify(wins)})`);
    for (const faction of [DAWN, UMBRA]) {
        assert.ok(wins[faction] >= decided * 0.25 && wins[faction] <= decided * 0.75, `${what}: ${JSON.stringify(wins)}`);
    }
};

test('a planet\'s two garrisons, fought out, win about as often as each other', () => {
    notOneSided(battles(GARRISONS[DAWN], GARRISONS[UMBRA]), 'an ordinary planet');
});

test('so do the stargate\'s, in strength', () => {
    notOneSided(battles(GARRISONS.gate[DAWN], GARRISONS.gate[UMBRA]), 'the gate');
});

test('a pilot at the dock is under about the same fire from either side\'s garrison', () => {
    for (const [what, lists] of [['an ordinary planet', GARRISONS], ['the gate', GARRISONS.gate]]) {
        const dawn = fireAtTheDock(DAWN, lists[DAWN]);
        const umbra = fireAtTheDock(UMBRA, lists[UMBRA]);
        assert.ok(dawn > 5 && umbra > 5, `${what}: the garrisons do fire (${dawn.toFixed(1)}, ${umbra.toFixed(1)})`);
        assert.ok(Math.max(dawn, umbra) / Math.min(dawn, umbra) < 1.6, `${what}: Federation ${dawn.toFixed(1)}/s, Umbra ${umbra.toFixed(1)}/s`);
    }
});
