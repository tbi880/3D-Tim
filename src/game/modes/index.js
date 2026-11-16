import { BattleRoyaleMode } from './battleRoyale/BattleRoyaleMode.js';
import { BattleRoyalePresenter } from './battleRoyale/BattleRoyalePresenter.js';

/**
 * Game modes: what a multiplayer match is about. The match machinery (net/) moves ships
 * and packets and knows nothing of sides, objectives or winners; a mode supplies those, in
 * two halves.
 *
 * The RULES run inside the MatchServer, on the host's device only:
 *
 *   setup(server)                       build the zones, place everyone (server.addZone, server.spawnPilotShip)
 *   update(dt)                          the rules' own clock, once per server frame
 *   onShipDestroyed(zone, ship, killer) any ship, a player's or not
 *   onDamage?(zone, target, source, amount)   every bit of damage a ship deals
 *   onRequest(pilot, name, data)        a player asks for something only this mode offers; `data`
 *                                       comes straight from their device: check every field
 *   onPlayerLeft?(pilot)
 *   describeState(pilot)                the match state for that player (net/match/matchState.js);
 *                                       it may differ per player - only put in it what they may know
 *   dispose?()
 *
 * The PRESENTER runs on every device, beside its ClientMatch, and turns what the rules send
 * into what the player sees and hears:
 *
 *   sanitizeState(raw)                  check a match state from the host; return a clean copy or null
 *   begin(client, session)
 *   onEvent(name, data)                 a WORLD_EVENT.MODE entry from the rules
 *   onZoneEntered?(zoneId)              the player has arrived somewhere (a whole new picture)
 *   onMatchOver?(state, showResults)    the match is decided: return true to play an ending first
 *                                       and call `showResults` when it is done
 *   handleAction?(action, params)       a key or button of the mode's own; return true if it was
 *   holdsAttention?()                   true while a window of the mode's has the pilot's eyes off the helm
 *   applyRefit?(added)                  the refit window was confirmed
 *   missionHud?()                       the objective line (see GameSession.missionHud)
 *   update(dt)
 *   dispose()
 *
 * `createPresenter(loadout)` is given what the player chose in the lobby before the match
 * (LanMultiplayer's `loadout`): a mode takes from it what it knows.
 *
 * To add a mode: write the two classes, add an entry here, and offer it in the lobby.
 */
export const GAME_MODES = Object.freeze({
    battleRoyale: {
        id: 'battleRoyale',
        createRules: (info) => new BattleRoyaleMode(info),
        createPresenter: (loadout) => new BattleRoyalePresenter({ startingEquipment: loadout?.equipment ?? null }),
    },
});

export const DEFAULT_GAME_MODE = 'battleRoyale';

/** The mode a match is played in; an id this build does not know falls back to the default. */
export function gameModeOf(info) {
    return GAME_MODES[info.mode] ?? GAME_MODES[DEFAULT_GAME_MODE];
}
