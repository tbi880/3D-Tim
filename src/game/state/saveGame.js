import { DEFAULT_DIFFICULTY, DIFFICULTY, STORAGE_KEYS } from '../config/gameConfig.js';
import { LOCALES, detectLocale } from '../i18n/index.js';
import { DEFAULT_PLAYER_SHIP, isPlayerShip } from '../config/playerShips.js';
import { DEFAULT_GRAPHICS, GRAPHICS } from '../config/graphics.js';
import { isTouchDevice } from '../input/device.js';

/**
 * Persistence for checkpoints and player settings (browser localStorage).
 * Every function is safe to call where storage is unavailable (private mode, Node tests).
 */

const SAVE_VERSION = 1;

function getStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function readJson(key) {
    try {
        const raw = getStorage()?.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    try {
        getStorage()?.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/** @returns {object | null} the last checkpoint, or null if there is none / it is from an old format */
export function loadSave() {
    const save = readJson(STORAGE_KEYS.save);
    if (!save || save.version !== SAVE_VERSION || !save.checkpointId || !save.world) return null;
    return save;
}

export function writeSave(save) {
    return writeJson(STORAGE_KEYS.save, { ...save, version: SAVE_VERSION, savedAt: Date.now() });
}

export function clearSave() {
    try {
        getStorage()?.removeItem(STORAGE_KEYS.save);
    } catch {
        // Nothing to clear.
    }
}

/** Best final score so far, per difficulty: `{ captain: { total, rank, shipId, at } }`. */
export function loadBestScores() {
    return readJson(STORAGE_KEYS.bestScore) ?? {};
}

/**
 * Records `result` if it beats the best on its difficulty.
 * @returns {{ isRecord: boolean, previous: object | null }}
 */
export function recordFinalScore(result, shipId) {
    const best = loadBestScores();
    const previous = best[result.difficultyId] ?? null;
    const isRecord = !previous || result.total > previous.total;
    if (isRecord) writeJson(STORAGE_KEYS.bestScore, { ...best, [result.difficultyId]: { total: result.total, rank: result.rank, shipId, at: Date.now() } });
    return { isRecord, previous };
}

export const CAMERA_MODES = Object.freeze(['cockpit', 'chase']);

export function defaultSettings() {
    return {
        locale: detectLocale(),
        difficulty: DEFAULT_DIFFICULTY,
        /** Ship class picked in the hangar (config/playerShips.js). */
        playerShip: DEFAULT_PLAYER_SHIP,
        muted: false,
        invertY: false,
        /** 'cockpit' (first person) or 'chase' (third person). Phones always fly in chase view. */
        cameraMode: isTouchDevice() ? 'chase' : 'cockpit',
        /** Beams fire by themselves at hostiles in the ring. On by default where there is no trigger finger to spare. */
        autoFire: isTouchDevice(),
        /** Rendering preset (config/graphics.js). */
        graphics: DEFAULT_GRAPHICS,
        /** The first-flight tutorial in the prologue: on until it has been finished or skipped (state/Tutorial.js). */
        tutorial: true,
    };
}

export function loadSettings() {
    const settings = { ...defaultSettings(), ...(readJson(STORAGE_KEYS.settings) ?? {}) };
    if (!LOCALES.includes(settings.locale)) settings.locale = 'en';
    if (!DIFFICULTY[settings.difficulty]) settings.difficulty = DEFAULT_DIFFICULTY;
    if (!isPlayerShip(settings.playerShip)) settings.playerShip = DEFAULT_PLAYER_SHIP;
    if (!CAMERA_MODES.includes(settings.cameraMode)) settings.cameraMode = 'cockpit';
    // The cockpit view is too cramped on a phone screen: touch devices are locked to chase view.
    if (isTouchDevice()) settings.cameraMode = 'chase';
    if (!GRAPHICS[settings.graphics]) settings.graphics = DEFAULT_GRAPHICS;
    settings.tutorial = Boolean(settings.tutorial);
    return settings;
}

export function saveSettings(settings) {
    return writeJson(STORAGE_KEYS.settings, settings);
}
