import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ABILITIES, PASSIVES } from '../../src/game/config/abilities.js';
import { PLAYER_FACTIONS, STAR_SYSTEM } from '../../src/game/config/battleRoyale.js';
import { CHARACTERS } from '../../src/game/config/characters.js';
import { DIFFICULTY_ORDER } from '../../src/game/config/gameConfig.js';
import { GRAPHICS_ORDER } from '../../src/game/config/graphics.js';
import { PLAYER_SHIPS, RATING_ORDER } from '../../src/game/config/playerShips.js';
import { SECTORS } from '../../src/game/config/sectors.js';
import { SHIP_CLASSES } from '../../src/game/config/shipClasses.js';
import en from '../../src/game/i18n/en.js';
import { translate } from '../../src/game/i18n/index.js';
import zh from '../../src/game/i18n/zh.js';
import { DOCK_END, DOCK_REFUSAL, JUMP_REFUSAL, RESPAWN_REFUSAL } from '../../src/game/modes/battleRoyale/battleRoyaleProtocol.js';
import { EQUIPMENT_ORDER } from '../../src/game/modes/battleRoyale/equipment.js';

/**
 * The texts (i18n/en.js, i18n/zh.js). A key that is missing shows up on screen as the key
 * itself, which no test of the game would notice, so these check the dictionaries against
 * each other and against the code and tables that name their keys.
 */

const GAME_DIR = fileURLToPath(new URL('../../src/game/', import.meta.url));

/** The `{name}` placeholders a text fills, in order of name. */
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** Every .js / .jsx file of the game outside i18n/. */
function gameSources(dir = GAME_DIR) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'i18n' ? [] : gameSources(path);
        return /\.jsx?$/.test(entry.name) ? [path] : [];
    });
}

test('the Chinese and English dictionaries have the same keys', () => {
    const missingInZh = Object.keys(en).filter((key) => !(key in zh));
    const missingInEn = Object.keys(zh).filter((key) => !(key in en));
    assert.deepEqual(missingInZh, [], 'in en.js but not zh.js');
    assert.deepEqual(missingInEn, [], 'in zh.js but not en.js');
});

test('every translation fills the same placeholders as the English text', () => {
    const mismatched = Object.keys(en).filter((key) => key in zh && placeholders(en[key]).join() !== placeholders(zh[key]).join());
    assert.deepEqual(mismatched, []);
    for (const dictionary of [en, zh]) {
        for (const [key, text] of Object.entries(dictionary)) assert.equal(typeof text, 'string', key);
    }
});

test('every text key written out in the game code is in the dictionaries', () => {
    // A quoted word.word... whose first part starts some key (ui., hud., objective., ...) is a key.
    const families = new Set(Object.keys(en).map((key) => key.split('.')[0]));
    const missing = [];
    let named = 0;
    for (const file of gameSources()) {
        for (const [, , key] of readFileSync(file, 'utf8').matchAll(/(['"])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)\1/g)) {
            if (!families.has(key.split('.')[0]) || /\.(jsx?|mjs|json|glb|webp|png)$/.test(key)) continue;
            named++;
            if (!(key in en)) missing.push(`${relative(GAME_DIR, file)}: ${key}`);
        }
    }
    assert.deepEqual(missing, []);
    assert.ok(named > 500, `only ${named} keys found: has the way keys are written changed?`);
});

test('everything the tables name has its texts', () => {
    const expected = [
        ...Object.keys(SHIP_CLASSES).map((id) => `ship.${id}`),
        ...PLAYER_SHIPS.flatMap(({ classId }) => [`playerShip.${classId}.role`, `playerShip.${classId}.text`]),
        ...RATING_ORDER.map((rating) => `ui.rating.${rating}`),
        ...Object.keys(ABILITIES).flatMap((id) => [`ability.${id}.name`, `ability.${id}.short`, `ability.${id}.text`]),
        ...Object.keys(PASSIVES).flatMap((id) => [`ability.${id}.name`, `ability.${id}.text`]),
        ...Object.keys(CHARACTERS).flatMap((id) => [`speaker.${id}`, `speaker.${id}.role`]),
        ...Object.values(SECTORS).map((sector) => sector.nameKey),
        ...STAR_SYSTEM.planets.map((planet) => `mp.planet.${planet.id}`),
        ...PLAYER_FACTIONS.map((faction) => `mp.faction.${faction}`),
        ...EQUIPMENT_ORDER.flatMap((item) => [`mp.equipment.${item}.name`, `mp.equipment.${item}.text`]),
        // The host's reasons for saying no, and for a docking ending, are shown as `...${reason}`.
        ...Object.values(JUMP_REFUSAL).map((reason) => `mp.jump.refused.${reason}`),
        ...Object.values(DOCK_REFUSAL).map((reason) => `mp.dock.refused.${reason}`),
        ...Object.values(DOCK_END).map((reason) => `mp.dock.ended.${reason}`),
        ...Object.values(RESPAWN_REFUSAL).map((reason) => `mp.respawn.refused.${reason}`),
        ...DIFFICULTY_ORDER.flatMap((level) => [`ui.difficulty.${level}`, `ui.difficultyHint.${level}`]),
        ...GRAPHICS_ORDER.flatMap((level) => [`ui.graphics.${level}`, `ui.graphicsHint.${level}`]),
    ];
    assert.deepEqual(expected.filter((key) => !(key in en)), []);
});

test('translate falls back to English and then to the key, and fills placeholders', () => {
    assert.equal(translate('zh', 'ui.back'), zh['ui.back']);
    assert.equal(translate('fr', 'ui.back'), en['ui.back'], 'an unknown locale reads English');
    assert.equal(translate('zh', 'no.such.key'), 'no.such.key', 'a missing key shows itself');
    assert.equal(translate('en', 'ui.continueFrom', { checkpoint: 'Veil' }), en['ui.continueFrom'].replace('{checkpoint}', 'Veil'));
    assert.equal(translate('en', 'ui.continueFrom', {}), en['ui.continueFrom'], 'a value not given leaves its placeholder');
    assert.equal(translate('en', 'no.such.{key}', { key: 'x' }), 'no.such.x');
});
