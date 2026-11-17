import { BATTLE, FACTION } from '../../config/gameConfig.js';
import { background, say, waitUntil } from '../beats.js';

/**
 * Shared by the chapters of the campaign (story/campaign.js puts them in order): the tags of
 * the ships the story follows, small questions about them, and the background beats more than
 * one chapter declares.
 */

export const TAG = Object.freeze({
    BUOY: 'buoy',
    INTERDICTOR: 'interdictor',
    BEACON_A: 'beaconA',
    BEACON_B: 'beaconB',
    HARRIER: 'harrier',
    OSPREY: 'osprey',
    FORGE: 'forge',
    DAWNBREAKER: 'dawnbreaker',
    ECLIPSE: 'eclipse',
    FLEET: 'fleet',
    LANTERN: 'lantern',
    PENUMBRA: 'penumbra',
});

export const shipByTag = (ctx, tag) => ctx.world.findByTag(tag);
export const distanceToTag = (ctx, tag) => {
    const ship = shipByTag(ctx, tag);
    return ship && ctx.world.player ? ship.distanceToPoint(ctx.world.player.position) : Infinity;
};
/** `base` metres scaled down for player ships slower than the Kestrel, never under 900 m. */
export const responseRadius = (ctx, base) => Math.max(900, base * Math.min(1, (ctx.world.player?.cls.maxSpeed ?? 150) / 150));
export const hullOf = (ctx, tag) => shipByTag(ctx, tag)?.hullFraction ?? 1;
export const groupCleared = (group) => (ctx) => ctx.world.countGroup(group) === 0;
export const remainingIn = (group) => (ctx) => ({ remaining: ctx.world.countGroup(group) });
export const hostilesRemaining = (ctx) => ({ remaining: ctx.world.countFaction(FACTION.UMBRA) });
export const smallHostiles = (ctx) => ctx.world.ships.filter((ship) => ship.alive && ship.faction === FACTION.UMBRA && ship.cls.kind === 'fighter').length;
/**
 * True while `extra` more ships fit in the sector without crossing the battle limits
 * (BATTLE in config/gameConfig.js). Every reinforcement wave in the big battles waits on this.
 */
export const underBattleBudget = (ctx, extra = 0) => {
    let ships = 0;
    for (const ship of ctx.world.ships) if (ship.alive) ships++;
    return ships + extra <= BATTLE.maxShips && smallHostiles(ctx) + extra <= BATTLE.maxHostileFighters;
};

/** Around a tagged ship, `distance` metres from its centre, facing the player. */
export const around = (tag, distance) => ({ anchor: tag, bearing: 'around', distance });

/** A named ally calls for help as its hull drops. Declared again after each checkpoint. */
export const hullWarnings = (tag, speakerId, halfKey, criticalKey) => background(`hullWarnings:${tag}`, [
    waitUntil((ctx) => hullOf(ctx, tag) < 0.5),
    say(speakerId, halfKey, { wait: false }),
    waitUntil((ctx) => hullOf(ctx, tag) < 0.25),
    say(speakerId, criticalKey, { wait: false }),
]);
export const dawnbreakerWarnings = () => hullWarnings(TAG.DAWNBREAKER, 'tim', 'fleet.tim.hullHalf', 'fleet.tim.hullCritical');

/** Remaining attackers break off: they turn away and jump out a few seconds later. */
export function umbraRetreats(ctx) {
    for (const ship of ctx.world.ships) {
        if (!ship.alive || ship.faction !== FACTION.UMBRA) continue;
        ship.ai.mode = 'flee';
        ship.despawnTimer = 3 + ctx.world.rng() * 3;
    }
}
