import { PLAYER_SHIPS } from '../config/playerShips.js';
import { bucketURL } from '../../Settings';

/**
 * Hangar pictures: every player ship from three views, rendered from the game's models by
 * tools/game-models/player-ships/render_previews.mjs and hosted in the asset bucket.
 */
export const HANGAR_VIEWS = Object.freeze(['front', 'side', 'rear']);
export const hangarImage = (classId, view) => `${bucketURL}game/player/${classId}-${view}.webp`;

/** Starts fetching every hangar picture, so switching ships shows the next one at once. */
export function preloadHangarImages() {
    for (const ship of PLAYER_SHIPS) {
        for (const view of HANGAR_VIEWS) {
            const image = new Image();
            image.src = hangarImage(ship.classId, view);
        }
    }
}
