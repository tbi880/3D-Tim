import { useEffect, useRef } from "react";

export function useSequenceUnloadSceneChecker(sequence, unloadPoints, callback) {
    const ptsRef = useRef(new Set(unloadPoints));
    const cbRef = useRef(callback);

    useEffect(() => { ptsRef.current = new Set(unloadPoints); }, [unloadPoints]);
    useEffect(() => { cbRef.current = callback; }, [callback]);

    useEffect(() => {
        const id = setInterval(() => {
            const pos = sequence.position;
            if ([...ptsRef.current].some(p => Math.abs(p - pos) < 1e-3)) {
                cbRef.current();
            }
        }, 2000);
        return () => clearInterval(id);
    }, []);
}