import { useEffect } from "react";

export function useSequenceUnloadSceneChecker(sceneSequence, unloadPoints, callback) {
    useEffect(() => {
        const checkForUnload = setInterval(() => {
            if (unloadPoints.includes(sceneSequence.position)) {
                callback();
            }
        }, 2000); // Adjust the interval as needed

        return () => clearInterval(checkForUnload);
    }, [sceneSequence.position, unloadPoints, callback]);
}
