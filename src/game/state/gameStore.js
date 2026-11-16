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
    /** The open refit window ({ points, classId, upgrades }, GameSession.openRefit) or null. */
    refit: null,

    /** The multiplayer match on the HUD and the results screen (net/match/matchState.js), or null in single player. */
    match: null,
    /** The match's own window that is open over the flight view ('map'), or null. */
    matchPanel: null,
    /** The ending a match is playing before its result screen ({ winner, won }), or null. */
    matchOutro: null,

    // Menus
    gameOverReason: null,
    stats: null,
    /** The ending screen's score breakdown (config/scoring.js computeFinalScore + record info). */
    finalScore: null,
    hasSave: false,
    saveCheckpointId: null,
    /** How the last VR session went, or why it did not start (xr/vrPerformance.js), or null. */
    vrReport: null,
    /** The last in-headset test (xr/vrBenchmark.js): { test, results: [{ name, fps, js, eye }] }, or null. */
    vrBenchmark: null,

    // Scene bookkeeping
    /** True once the 3D assets are loaded and the loading screen has gone. */
    assetsReady: false,
    /** Ships to draw (everything alive except the player); replaced whenever ships come or go. */
    roster: [],
    /** The ship the player is flying (a new object after every new game or reload). */
    playerShip: null,
    /** The player ship model being fetched for the next flight ({ classId, file, status, attempt }, ShipModel.jsx requestShipModel). */
    shipLoad: null,
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
