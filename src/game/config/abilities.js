/**
 * Active abilities: the one special thing a player ship can do, on a button of its own
 * (Q on a keyboard, SKILL on a touch screen, Y on a VR controller). A ship class names its
 * ability with `ability: '<id>'` (config/shipClasses.js); a class without one (the Bulwark)
 * simply has no such button. The rules are in core/systems/abilities.js.
 *
 * The Bulwark has a passive one instead (PASSIVES, below): no button, it happens by itself.
 *
 * Every number a designer may want to change is here.
 *
 * Fields shared by all of them:
 *   kind      what it does (see below)
 *   cooldown  seconds before it can be used again, counted from the moment its effect ends
 *             (for the torpedo: from the launch)
 *   duration  seconds the effect lasts (the torpedo has none: it is a shot)
 *   immunity  what cannot hurt the ship while the effect lasts: 'weapons' (anything a ship
 *             fires; rocks and hulls still do) or 'all' (rammed rocks and hulls as well).
 *             A black hole's pull is never kept out.
 *
 * kind:
 *   'torpedo'   - launches `weapon` (config/weapons.js), a homing warhead; pressed again while it
 *                 flies, it goes off where it is. Its blast is the weapon's `breach`.
 *   'cloak'     - the ship cannot be locked or fired on. `brokenByFiring`: its own guns end it.
 *   'overdrive' - a dash: the engines go to `speedMult` times the afterburner's top speed,
 *                 reached `accelerationMult` times faster than usual.
 *   'lance'     - for `duration` seconds the beam trigger fires `weapon` instead of the beams:
 *                 true damage, whatever the target's shields, the difficulty or a power mode say.
 *                 Small craft (fighters, players' ships) lose their whole shield in
 *                 `shieldedKillSeconds - bareKillSeconds` and their whole hull in `bareKillSeconds`;
 *                 anything bigger (ships of the line, their modules) loses a flat `capitalDps`.
 */

/** The three lengths of cooldown, in seconds. */
export const ABILITY_COOLDOWN = Object.freeze({ short: 12, medium: 30, long: 50 });

export const ABILITIES = Object.freeze({
    /** Kestrel: an armour-breaching torpedo whose blast takes down every shield around it. */
    breachTorpedo: {
        id: 'breachTorpedo', kind: 'torpedo', cooldown: ABILITY_COOLDOWN.medium,
        weapon: 'breachTorpedo',
    },
    /** Peregrine: an electronic coating - for a few seconds nothing can lock it or fire on it. */
    cloak: {
        id: 'cloak', kind: 'cloak', cooldown: ABILITY_COOLDOWN.long,
        duration: 5, immunity: 'weapons', brokenByFiring: true,
    },
    /** Swift: engines past their limit - a dodge that nothing can hit. */
    overdrive: {
        id: 'overdrive', kind: 'overdrive', cooldown: ABILITY_COOLDOWN.short,
        duration: 2, immunity: 'all', speedMult: 1.6, accelerationMult: 8,
    },
    /** Shrike: every emitter through one lens - a 20 km beam that burns straight through shields. */
    focusLance: {
        id: 'focusLance', kind: 'lance', cooldown: ABILITY_COOLDOWN.medium,
        duration: 15, weapon: 'focusLance',
        shieldedKillSeconds: 5, bareKillSeconds: 3, capitalDps: 120,
    },
});

/**
 * Passive abilities: what a ship does by itself, with no button and no cooldown. A class names
 * its own with `passive: '<id>'`.
 *
 * kind:
 *   'deathBlast' - when the ship is destroyed, every ship within `radius` metres is caught in
 *                  the blast. It is true damage (no shield or hull multiplier, no difficulty,
 *                  no power mode), shield first and then hull, and how much depends on what
 *                  is hit: `damage` is the share of all it is (its full shield plus its full
 *                  hull) that it loses.
 *                    fighter - computer-flown small craft: 1 destroys them whatever state they are in
 *                    player  - a pilot's ship: 0.7 leaves a fresh one alive on under a third,
 *                              and kills one that was already hurt
 *                    capital - ships of the line, stations' and ships' turrets and modules
 *                  `hitsAllies`: its own side is caught too (false: only what is hostile to it).
 *                  What cannot be hurt still is not: invulnerable hulls, a hull's floor, a ship
 *                  in its overdrive dash.
 */
export const PASSIVES = Object.freeze({
    /** Bulwark: its reactor goes with it - nothing within a kilometre comes away whole. */
    reactorBlast: {
        id: 'reactorBlast', kind: 'deathBlast',
        radius: 1000, damage: Object.freeze({ fighter: 1, player: 0.7, capital: 0.5 }), hitsAllies: true,
    },
});

/** What an ability reports as it happens (GAME_EVENTS.ABILITY `phase`). */
export const ABILITY_PHASE = Object.freeze({
    /** The effect began (the torpedo left its tube). */
    START: 'start',
    /** The effect ran out, or was ended early. */
    END: 'end',
    /** A blast: the torpedo's warhead went off, or a ship with a 'deathBlast' passive died. The event carries `position` and `radius`. */
    BLAST: 'blast',
});

export const ABILITY_PHASES = Object.freeze(Object.values(ABILITY_PHASE));

/** Cue for the pilot who pressed the button while the ability was still recharging (the session's `playCue`). */
export const ABILITY_DENIED_CUE = 'abilityDenied';

/** The passive ability of a ship class, or null. */
export function passiveOf(cls) {
    return PASSIVES[cls?.passive] ?? null;
}

/** The ability of a ship class, or null. */
export function abilityOf(cls) {
    return ABILITIES[cls?.ability] ?? null;
}
