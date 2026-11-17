import { ABILITY_DENIED_CUE, ABILITY_PHASE } from '../../config/abilities.js';
import { GAME_EVENTS } from '../EventBus.js';
import { detonateBreach } from './projectiles.js';
import { launchAbilityTorpedo } from './weapons.js';

/**
 * Active abilities (config/abilities.js): the rules behind a player ship's ability button.
 *
 * A ship's `ability` holds where its ability stands: `cooldown` seconds until it can be used
 * again, `active` seconds its effect still lasts. What an effect does while it lasts is read
 * where it matters, through `ship.effect(kind)`: the dash in systems/playerFlight.js, the lance
 * and the cloak's end in systems/weapons.js, what cannot be hurt in systems/damage.js, what
 * cannot be locked in systems/targeting.js.
 *
 * Like everything else in core/ this runs wherever the ship is simulated: on this device in
 * single player, on the host in a match (other devices are told the result: the own ship's
 * state in every snapshot, GAME_EVENTS.ABILITY as a world event).
 */

function announce(world, ship, phase) {
    world.events.emit(GAME_EVENTS.ABILITY, { ship, ability: ship.ability.def.id, phase });
}

/**
 * The pilot pressed the ability button.
 * @returns {string | null} a cue to play for that pilot, or null
 */
export function triggerAbility(world, ship) {
    const ability = ship?.ability;
    if (!ability || !ship.alive || ship.arriving) return null;
    const { def } = ability;
    // A warhead on its way: the same button sets it off where it is.
    if (ability.projectile?.alive) {
        detonateBreach(world, ability.projectile);
        ability.projectile = null;
        ability.armed = false;
        return null;
    }
    if (ability.active > 0) return null;
    if (ability.cooldown > 0) return ABILITY_DENIED_CUE;

    if (def.kind === 'torpedo') {
        ability.projectile = launchAbilityTorpedo(world, ship, def.weapon);
        ability.armed = true;
        ability.cooldown = def.cooldown;
    } else {
        ability.active = def.duration;
        if (def.kind === 'cloak') ship.cloaked = true;
    }
    announce(world, ship, ABILITY_PHASE.START);
    return null;
}

/** The effect is over: the cooldown starts, and everybody is told. */
function finish(world, ship) {
    const ability = ship.ability;
    ability.active = 0;
    ability.cooldown = ability.def.cooldown;
    ship.cloaked = false;
    announce(world, ship, ABILITY_PHASE.END);
}

/** Ends a running effect before its time (something broke it). */
export function endAbility(world, ship) {
    if (ship.ability?.active > 0) finish(world, ship);
}

/** Once per simulation step for every ship with an ability. */
export function updateAbility(world, ship, dt) {
    const ability = ship.ability;
    if (!ability) return;
    if (ability.projectile && !ability.projectile.alive) ability.projectile = null;
    ability.armed = Boolean(ability.projectile);
    if (ability.active > 0) {
        ability.active -= dt;
        if (ability.active <= 0) finish(world, ship);
    } else if (ability.cooldown > 0) {
        ability.cooldown = Math.max(0, ability.cooldown - dt);
    }
}
