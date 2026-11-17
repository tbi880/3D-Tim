import { abilityOf, passiveOf } from '../config/abilities.js';
import { shipSpecs } from '../config/playerShips.js';
import { SHIP_CLASSES } from '../config/shipClasses.js';

/**
 * What a ship page says about a player ship beyond its name and rating bars, as text for
 * wherever the page is drawn: the hangar on the flat page (ui/Hangar.jsx) and the ship sheet
 * in the headset (xr/VRShipSheet.js).
 */

const kilometres = (metres) => (metres / 1000).toFixed(1);

/**
 * The ship's ability: `heading` ("Ability · Overdrive · 12 s cooldown", or "Passive · ...")
 * and `text`, what it does (null for a ship that has neither).
 */
export function shipAbilityText(t, classId) {
    const cls = SHIP_CLASSES[classId];
    const active = abilityOf(cls);
    const ability = active ?? passiveOf(cls);
    if (!ability) return { heading: `${t('ui.ability')} · ${t('ui.ability.none')}`, text: null };
    const parts = [t(active ? 'ui.ability' : 'ui.passive'), t(`ability.${ability.id}.name`)];
    if (active) parts.push(t('ui.ability.cooldown', { seconds: active.cooldown }));
    return { heading: parts.join(' · '), text: t(`ability.${ability.id}.text`) };
}

/**
 * The ship in numbers (config/playerShips.js `shipSpecs`), one row for each: `{ id, label, value }`.
 * Shields, hull and speed carry the names of their rating bars.
 */
export function shipSpecRows(t, classId) {
    const specs = shipSpecs(classId);
    if (!specs) return [];
    return [
        { id: 'shields', label: t('ui.rating.shields'), value: t('ui.spec.shields', { shield: specs.shield, regen: specs.shieldRegen }) },
        { id: 'hull', label: t('ui.rating.hull'), value: String(specs.hull) },
        { id: 'speed', label: t('ui.rating.speed'), value: t('ui.spec.speed', { speed: Math.round(specs.speed), boost: Math.round(specs.boostSpeed) }) },
        { id: 'beam', label: t('ui.spec.beam.label'), value: t('ui.spec.beam', { range: kilometres(specs.beamRange), dps: Math.round(specs.beamDps) }) },
        {
            id: 'torpedo',
            label: t('ui.spec.torpedo.label'),
            value: t('ui.spec.torpedo', { range: kilometres(specs.torpedoRange), damage: Math.round(specs.torpedoDamage), count: specs.torpedoCount }),
        },
    ];
}
