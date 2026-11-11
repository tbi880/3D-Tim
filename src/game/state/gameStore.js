import { useMemo } from 'react';
import { create } from 'zustand';
import { translate } from '../i18n/index.js';
import { loadSettings } from './saveGame.js';

/**
 * UI-facing state of the game. The simulation never reads this store: GameSession pushes
 * throttled snapshots into it (`ui.set`) and React components subscribe to the slices they
 * render. See GameSession.publishHud for the shape of `hud`, `target`, `escort` and `boss`.
 */
export const useGameStore = create(() => ({
    phase: 'title',
    settings: loadSettings(),

    // In-flight HUD
    hud: null,
    target: null,
    escort: null,
    boss: null,
    progress: null,
    objective: null,
    hint: null,
    comms: null,
    titleCard: null,
    toast: null,

    // Menus
    gameOverReason: null,
    stats: null,
    hasSave: false,
    saveCheckpointId: null,

    // Scene bookkeeping
    /** True once the 3D assets are loaded and the loading screen has gone. */
    assetsReady: false,
    /** Ships to draw (everything alive except the player); replaced whenever ships come or go. */
    roster: [],
    sectorId: null,
}));

/** The `ui` sink handed to GameSession. */
export const gameStoreSink = { set: (partial) => useGameStore.setState(partial) };

/**
 * Translation hook. The returned function changes identity when the language changes, so
 * components (and the React compiler's memoisation) re-render with the new text.
 */
export function useT() {
    const locale = useGameStore((state) => state.settings.locale);
    return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}
