import { useEffect } from "react";

const SAVE_INTERVAL_MS = 2000;
const STORAGE_KEY_PREFIX = "sceneResumePosition_";
const CLICKABLE_POINT_TOLERANCE = 0.1;

export function getResumePosition(sceneKey) {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY_PREFIX + sceneKey);
        if (saved === null) return null;
        const position = parseFloat(saved);
        return position % 1 !== 0 ? Math.floor(position) : position;
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

export function useSequenceAutoSave(sceneKey, sequence) {
    useEffect(() => {
        if (!sequence) return;

        const id = setInterval(() => {
            const pos = sequence.position;
            if (pos > 0) {
                try {
                    sessionStorage.setItem(STORAGE_KEY_PREFIX + sceneKey, String(pos));
                } catch {
                    // ignore
                }
            }
        }, SAVE_INTERVAL_MS);

        return () => clearInterval(id);
    }, [sceneKey, sequence]);
}
