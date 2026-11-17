import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityOf, passiveOf } from '../../src/game/config/abilities.js';
import { PLAYER } from '../../src/game/config/gameConfig.js';
import { PLAYER_SHIPS, RATING_ORDER, shipSpecs } from '../../src/game/config/playerShips.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import { WEAPONS } from '../../src/game/config/weapons.js';
import { upgradedClass } from '../../src/game/core/refit.js';
import { Ship } from '../../src/game/core/Ship.js';
import { playerBeamRange, playerTorpedoRange } from '../../src/game/core/systems/weapons.js';
import { LOCALES, translate } from '../../src/game/i18n/index.js';
import { shipAbilityText, shipSpecRows } from '../../src/game/ui/shipText.js';

/** The ship pages (ui/Hangar.jsx, xr/VRShipSheet.js): the numbers and the text they show for every player ship. */

test('a ship page shows the numbers the simulation flies the ship with', () => {
    for (const { classId } of PLAYER_SHIPS) {
        const cls = SHIP_CLASSES[classId];
        const specs = shipSpecs(classId);
        const ship = new Ship(classId, cls);
        assert.equal(specs.shield, ship.maxShield, classId);
        assert.equal(specs.hull, ship.maxHull, classId);
        assert.equal(specs.shieldRegen, cls.shieldRegen, classId);
        assert.equal(specs.speed, cls.maxSpeed, classId);
        assert.equal(specs.boostSpeed, cls.maxSpeed * PLAYER.boostMultiplier * (cls.handling?.boostMultiplier ?? 1), classId);
        assert.equal(specs.beamRange, playerBeamRange(ship, WEAPONS.playerBeam), classId);
        assert.equal(specs.torpedoRange, playerTorpedoRange(ship, WEAPONS.playerTorpedo), classId);
        assert.equal(specs.beamDps, WEAPONS.playerBeam.dps * (cls.weaponDamage ?? 1), classId);
        assert.equal(specs.torpedoDamage, WEAPONS.playerTorpedo.damage * (cls.weaponDamage ?? 1), classId);
        assert.equal(specs.torpedoCount, WEAPONS.playerTorpedo.capacity, classId);
        // As the weapons table promises: a ship's beams outreach its own torpedoes.
        assert.ok(specs.beamRange > specs.torpedoRange, classId);
    }
});

test('the Kestrel, the yardstick: 3 km beams, 1.8 km torpedoes, 360 m/s on the afterburner', () => {
    const specs = shipSpecs('kestrel');
    assert.equal(specs.beamRange, 3000);
    assert.equal(Math.round(specs.torpedoRange), 1806);
    assert.equal(specs.boostSpeed, 360);
    assert.equal(shipSpecs('buoyant-nonsense'), null);
});

test('a refitted class is shown with its upgrades', () => {
    const refitted = upgradedClass('kestrel', SHIP_CLASSES.kestrel, { range: 2, hull: 1 });
    const base = shipSpecs('kestrel');
    const specs = shipSpecs('kestrel', refitted);
    assert.ok(specs.beamRange > base.beamRange);
    assert.ok(specs.torpedoRange > base.torpedoRange);
    assert.ok(specs.hull > base.hull);
    assert.equal(specs.shield, base.shield);
});

test('every player ship has all its ship-page text in every language', () => {
    for (const locale of LOCALES) {
        const t = (key, params) => {
            const text = translate(locale, key, params);
            assert.notEqual(text, key, `${locale}: ${key} is missing`);
            assert.doesNotMatch(text, /\{\w+\}/, `${locale}: ${key} has an unfilled placeholder`);
            return text;
        };
        for (const { classId, ratings } of PLAYER_SHIPS) {
            t(`ship.${classId}`);
            t(`playerShip.${classId}.role`);
            t(`playerShip.${classId}.text`);
            for (const rating of RATING_ORDER) {
                t(`ui.rating.${rating}`);
                assert.ok(ratings[rating] >= 1, `${classId}: ${rating}`);
            }
            const rows = shipSpecRows(t, classId);
            assert.deepEqual(rows.map((row) => row.id), ['shields', 'hull', 'speed', 'beam', 'torpedo']);
            for (const row of rows) assert.ok(row.label && row.value, `${classId}: ${row.id}`);

            const cls = SHIP_CLASSES[classId];
            const { heading, text } = shipAbilityText(t, classId);
            const ability = abilityOf(cls) ?? passiveOf(cls);
            assert.ok(ability, `${classId} has an ability or a passive one`);
            assert.ok(heading.includes(t(`ability.${ability.id}.name`)), classId);
            assert.equal(text, t(`ability.${ability.id}.text`));
            // Only an ability on a button has a cooldown to quote.
            assert.equal(heading.includes(t('ui.ability.cooldown', { seconds: ability.cooldown })), Boolean(abilityOf(cls)), classId);
        }
        t('mp.ship.versusNote', { percent: 25 });
        t('mp.ship.versusShort', { percent: 25 });
        for (const key of ['ui.hangar.title', 'ui.hangar.confirm', 'ui.spec.weapons', 'mp.ship.title', 'mp.ship.open', 'ui.vr.shipDetails', 'ui.vr.shipHint']) t(key);
    }
});

test('the numbers on a ship page read as the game says them', () => {
    const zh = (key, params) => translate('zh', key, params);
    const rows = Object.fromEntries(shipSpecRows(zh, 'bulwark').map((row) => [row.id, row.value]));
    assert.equal(rows.shields, '310 · 每秒回充 24');
    assert.equal(rows.hull, '330');
    assert.equal(rows.speed, '66 米/秒 · 加力 198');
    assert.equal(rows.beam, '射程 5.1 公里 · 每秒 67 伤害');
    assert.equal(rows.torpedo, '航程 3.1 公里 · 每枚 278 伤害 · 共 6 枚');
    assert.equal(shipAbilityText(zh, 'bulwark').heading, '被动技能 · 反应堆殉爆');
    assert.equal(shipAbilityText(zh, 'swift').heading, '技能 · 超载引擎 · 冷却 12 秒');
});
