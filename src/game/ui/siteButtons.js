import { useEffect } from 'react';
import { PHASE } from '../state/GameSession.js';
import { useGameStore } from '../state/gameStore.js';

/** The class on <html> that hides the site's own buttons while a game is under way (hud.css). */
export const IN_GAME_CLASS = 'eod-in-game';

/**
 * The site puts two buttons over every page: its menu on the left edge (Tools/Menu.jsx) and the
 * graphics settings on the right (Tools/GraphicSetting.jsx). In the game they covered the HUD and
 * caught stray taps, so they are hidden from the moment a mission or a match starts until the
 * title screen is back - through the pause menu, game over, the ending and a match's results.
 * On the title screen, in the hangar and in the lobby they are there as on any other page.
 */
export function useSiteButtonsHiddenInGame() {
    const inGame = useGameStore((state) => state.phase !== PHASE.TITLE);
    useEffect(() => {
        if (!inGame) return undefined;
        document.documentElement.classList.add(IN_GAME_CLASS);
        return () => document.documentElement.classList.remove(IN_GAME_CLASS);
    }, [inGame]);
}
