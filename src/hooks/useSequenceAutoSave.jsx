import { useEffect } from "react";

const SAVE_INTERVAL_MS = 2000;
const STORAGE_KEY_PREFIX = "sceneResumePosition_";

export function getResumePosition(sceneKey) {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY_PREFIX + sceneKey);
        return saved !== null ? parseFloat(saved) : null;
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
