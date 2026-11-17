/**
 * What an ability is doing, in a word or a number, for wherever it is shown (the flat HUD, the
 * touch button, the VR panel). `ability` is `abilityStatus(ship)` (state/GameSession.js).
 */
export function abilityStateText(t, ability) {
    switch (ability.state) {
        case 'ready': return t('hud.ability.ready');
        case 'armed': return t('hud.ability.armed');
        case 'active': return t('hud.ability.active', { seconds: ability.seconds });
        default: return t('hud.ability.cooldown', { seconds: ability.seconds });
    }
}
