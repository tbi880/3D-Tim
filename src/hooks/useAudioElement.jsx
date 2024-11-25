import { useEffect, useState } from "react";

export function useAudioElement(url) {
    const [audioElement, setAudioElement] = useState(null);

    useEffect(() => {
        const audio = new Audio(url);
        audio.crossOrigin = "anonymous";
        setAudioElement(audio);

        return () => {
            audio.pause();
            setAudioElement(null);
        };
    }, [url]);

    return audioElement;
}
