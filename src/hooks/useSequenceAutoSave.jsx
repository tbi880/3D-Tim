import { useEffect } from "react";

const SAVE_INTERVAL_MS = 2000;
const STORAGE_KEY_PREFIX = "sceneResumePosition_";
const SCENE_STATE_PREFIX = "sceneState_";
const CLICKABLE_POINT_TOLERANCE = 0.1;
const LAST_SCENE_URI_KEY = "lastSceneURI";

export function getResumePosition(sceneKey) {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY_PREFIX + sceneKey);
        if (saved === null) return null;
        const position = parseFloat(saved);
        return Math.floor(position);
    } catch {
        return null;
    }
}

export function clearResumePosition(sceneKey) {
    try {
        sessionStorage.removeItem(STORAGE_KEY_PREFIX + sceneKey);
    } catch {
        // ignore
    }
}

export function clearAllResumePositions() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && (key.startsWith(STORAGE_KEY_PREFIX) || key.startsWith(SCENE_STATE_PREFIX))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
        sessionStorage.removeItem(LAST_SCENE_URI_KEY);
    } catch {
        // ignore
    }
}

/**
 * Compares the stored last scene URI with the current URI.
 * If they differ (user navigated to a different page), clears all resume positions.
 * If they match (accidental refresh), resume positions are preserved.
 */
export function clearResumePositionsIfNavigated() {
    try {
        const lastURI = sessionStorage.getItem(LAST_SCENE_URI_KEY);
        if (lastURI !== null && lastURI !== window.location.pathname) {
            clearAllResumePositions();
        }
    } catch {
        // ignore
    }
}

/**
 * Given the current saved position and an array of clickable/interaction points for a scene,
 * determines the next point to auto-play to.
 * Returns null if the position is already at a clickable point (no auto-play needed),
 * or the next clickable point to play to if the position is between clickable points.
 */
export function getNextClickablePoint(position, clickablePoints) {
    const sorted = [...clickablePoints].sort((a, b) => a - b);
    const isAtClickablePoint = sorted.some(p => Math.abs(p - position) < CLICKABLE_POINT_TOLERANCE);
    if (isAtClickablePoint) {
        return null;
    }
    const nextPoint = sorted.find(p => p > position);
    return nextPoint !== undefined ? nextPoint : null;
}

/**
 * Given a position and a jump points map (array of [start, end] ranges),
 * returns the start of the matching range if the position falls within any range,
 * or null if no range matches. This rule takes priority over getNextClickablePoint.
 * When matched, the user should stay at the returned position without auto-playing.
 */
export function getJumpPointResumePosition(position, jumpPointsMap) {
    if (!jumpPointsMap) return null;
    for (const [start, end] of jumpPointsMap) {
        if (position >= start && position <= end) {
            return start;
        }
    }
    return null;
}

export function useSequenceAutoSave(sceneKey, sequence) {
    useEffect(() => {
        if (!sequence) return;

        const id = setInterval(() => {
            const pos = sequence.position;
            if (pos > 0) {
                try {
                    sessionStorage.setItem(STORAGE_KEY_PREFIX + sceneKey, String(pos));
                    sessionStorage.setItem(LAST_SCENE_URI_KEY, window.location.pathname);
                } catch {
                    // ignore
                }
            }
        }, SAVE_INTERVAL_MS);

        return () => clearInterval(id);
    }, [sceneKey, sequence]);
}
