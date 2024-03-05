import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';

export function createAudioLoader(url) {
    let status = 'pending';
    let result;
    let suspender = fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => new AudioContext().decodeAudioData(arrayBuffer))
        .then(audioBuffer => {
            status = 'success';
            result = audioBuffer;
        }, err => {
            status = 'error';
            result = err;
        });

    return {
        read() {
            if (status === 'pending') {
                throw suspender;
            } else if (status === 'error') {
                throw result;
            }
            return result;
        }
    };
}




function AsyncMusic({ audioResource, sequence, lowVolumePoints, highVolumePoints }) {
    const audioBuffer = audioResource.read(); // 从资源读取音频缓冲区
    const audioContextRef = useRef(null);
    const gainNodeRef = useRef(null);
    const audioBufferSourceNodeRef = useRef(null);
    const isPlayingRef = useRef(false);
    const [volumeTransition, setVolumeTransition] = useState('idle');


    useEffect(() => {
        const audioContext = new AudioContext();
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        const audioBufferSourceNode = audioContext.createBufferSource();
        audioBufferSourceNode.buffer = audioBuffer;
        audioBufferSourceNode.connect(gainNode);

        audioContextRef.current = audioContext;
        gainNodeRef.current = gainNode;
        audioBufferSourceNodeRef.current = audioBufferSourceNode;

        // 组件卸载时的清理工作
        return () => {
            audioBufferSourceNode.stop();
            audioContext.close();
        };
    }, [audioBuffer]);

    useFrame(() => {
        if (!audioContextRef.current || !gainNodeRef.current || !audioBufferSourceNodeRef.current) return;

        const currentTime = sequence.position; // 假设sequence.position反映了当前的播放时间
        const fadeDuration = 2; // 渐变持续时间（秒）

        if (sequence.position >= 0.07 && !isPlayingRef.current) {
            audioBufferSourceNodeRef.current.start(0);
            isPlayingRef.current = true;
            setVolumeTransition('idle');
        }

        // 检查是否需要调整音量
        const shouldLowerVolume = lowVolumePoints.some(point => Math.abs(currentTime - point) < 0.1);
        const shouldRaiseVolume = highVolumePoints.some(point => Math.abs(currentTime - point) < 0.1);

        if (shouldLowerVolume && volumeTransition !== 'down') {
            gainNodeRef.current.gain.linearRampToValueAtTime(0.2, audioContextRef.current.currentTime + fadeDuration);
            setVolumeTransition('down');
        } else if (shouldRaiseVolume && volumeTransition !== 'up') {
            gainNodeRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + fadeDuration);
            setVolumeTransition('up');
        }
    });


    return null;

}

export default AsyncMusic;
