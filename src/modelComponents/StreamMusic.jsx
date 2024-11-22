import { useEffect, useRef } from 'react';

function StreamMusic({ audioElement, sequence, startPoint, }) {
    const audioContextRef = useRef(null);
    const gainNodeRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const isPlayingRef = useRef(false);

    useEffect(() => {
        if (!audioElement || startPoint < sequence.position) {
            return;
        }
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        if (audioContextRef.current.state === 'running') {
            return;
        }

        const gainNode = audioContextRef.current.createGain();
        gainNode.connect(audioContextRef.current.destination);
        const sourceNode = audioContextRef.current.createMediaElementSource(audioElement);
        sourceNode.connect(gainNode);

        gainNodeRef.current = gainNode;
        sourceNodeRef.current = sourceNode;

        return () => {
            // Cleanup connections and nodes on unmount
            sourceNode.disconnect();
            gainNode.disconnect();
        };
    }, [audioElement]);

    useEffect(() => {
        return () => {
            audioElement?.pause();
            audioElement.src = ''; // Release audio resources
            audioContextRef.current?.close();
            audioContextRef.current = null;
            gainNodeRef.current = null;
            sourceNodeRef.current = null;
            isPlayingRef.current = false;
        };
    }, [audioElement]);

    useEffect(() => {
        if (sequence.position < startPoint || isPlayingRef.current) {
            return;
        }

        audioContextRef.current.resume().then(() => {
            audioElement.play();
            isPlayingRef.current = true;
        }).catch(console.error);

        return () => {
            isPlayingRef.current = false;
        };
    }, [sequence.position, startPoint, audioElement]);

    return null;
}

export default StreamMusic;
