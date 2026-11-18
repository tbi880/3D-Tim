/**
 * Whether the VR menu panel is shown (xr/VRCameraRig.jsx). Every menu hangs in front of the
 * pilot, except a match's ending: the show at the stargate and the system's fall play
 * straight ahead, and nothing is put over them. Its menu stays open all the same (the
 * controllers work the menu, not the ship, until the result is up), with nothing to show;
 * the result comes up in front once the show is over.
 */

export const MENU_PLACE = Object.freeze({ FRONT: 'front', NONE: 'none' });

/** The menu's picture, and its size and place in front of the pilot (the seat's frame: eye at the origin, -z ahead, metres). */
export const MENU_TEXTURE = Object.freeze([1024, 768]);
export const MENU_METERS = Object.freeze([1.48, 1.11]);
export const MENU_POSITION = Object.freeze([0, 0.02, -1.5]);

/**
 * Where a match's own menu goes: nowhere while its ending plays, in front otherwise - the
 * result after the ending, and a result that had none (the link to the host was lost).
 * @param {{ match?: object | null, matchOutro?: object | null }} state the game store
 * @param {boolean} over the result is up (the session is in its MATCH_OVER phase)
 */
export function matchMenuPlace(state, over) {
    if (!state.match || over) return MENU_PLACE.FRONT;
    return state.matchOutro ? MENU_PLACE.NONE : MENU_PLACE.FRONT;
}

/** True when a menu that is open has its panel on show. */
export const isMenuShown = (place) => place !== MENU_PLACE.NONE;
