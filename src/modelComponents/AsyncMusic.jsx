import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';


export function createAudioLoader(url) {
    return fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => {
            const audioContext = new AudioContext();
            return audioContext.decodeAudioData(arrayBuffer);
        });
}
// export function createAudioLoader(url) {
//     let status = 'pending';
//     let result;
//     let suspender = fetch(url)
//         .then(response => response.arrayBuffer())
//         .then(arrayBuffer => new AudioContext().decodeAudioData(arrayBuffer))
//         .then(audioBuffer => {
//             status = 'success';
//             result = audioBuffer;
//         }, err => {
//             status = 'error';
//             result = err;
//         });

//     return {
//         read() {
//             if (status === 'pending') {
//                 throw suspender;
//             } else if (status === 'error') {
//                 throw result;
//             }
//             return result;
//         }
//     };
// }




function AsyncMusic({ audioBuffer, sequence, startPoint, lowVolumePoints, highVolumePoints, maxVolume, isLoaded }) {
    // const [audioBuffer, setAudioBuffer] = useState(null);
    const audioContextRef = useRef(new AudioContext());
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
        gainNodeRef.current.gain.value = maxVolume;
        audioBufferSourceNodeRef.current = audioBufferSourceNode;

        // 组件卸载时的清理工作
        return () => {
            if (audioBufferSourceNodeRef.current) {
                if (isPlayingRef.current) {
                    // 如果音频正在播放，则停止播放
                    audioBufferSourceNodeRef.current.stop();
                }
                // 释放audioBufferSourceNode引用
                audioBufferSourceNodeRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close(); // 关闭AudioContext
                audioContextRef.current = null;  // 释放AudioContext引用
            }
            // 释放GainNode引用
            gainNodeRef.current = null;

        };
    }, [audioBuffer]);

    useFrame(() => {
        if (!audioContextRef.current || !gainNodeRef.current || !audioBufferSourceNodeRef.current) return;

        const currentTime = sequence.position; // 假设sequence.position反映了当前的播放时间
        const fadeDuration = 2; // 渐变持续时间（秒）

        if (sequence.position >= startPoint && !isPlayingRef.current) {
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
            gainNodeRef.current.gain.linearRampToValueAtTime(maxVolume, audioContextRef.current.currentTime + fadeDuration);
            setVolumeTransition('up');
        }
    });


    return null;

}

export default AsyncMusic;
