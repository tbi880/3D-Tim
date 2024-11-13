import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';


function StreamMusic({ audioElement, sequence, startPoint, lowVolumePoints, highVolumePoints, maxVolume }) {
    const audioElementRef = useRef(null); // 新增对<audio>元素的引用
    const audioContextRef = useRef(new AudioContext());
    const gainNodeRef = useRef(null);
    const sourceNodeRef = useRef(null); // 用于连接<audio>元素与AudioContext
    const isPlayingRef = useRef(false);
    // const [volumeTransition, setVolumeTransition] = useState('idle');

    useEffect(() => {
        if (!audioElement) {
            // console.log('Audio element not provided. Exiting useEffect.');
            return;
        }

        // console.log('Setting up AudioContext and GainNode with provided audioElement:', audioElement);
        const audioContext = new AudioContext();
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        const sourceNode = audioContext.createMediaElementSource(audioElement);
        sourceNode.connect(gainNode);

        audioContextRef.current = audioContext;
        gainNodeRef.current = gainNode;
        sourceNodeRef.current = sourceNode;


    }, [audioElement]);

    useEffect(() => {

        return () => {
            // 清理函数
            if (audioElement) { // 直接使用传入的audioElement
                audioElement.pause(); // 停止音频播放
                audioElement.src = ''; // 释放音频资源
            }
            // console.log('Cleanup triggered for Audio Element');
            if (audioElementRef.current) {
                audioElementRef.current.pause();
                audioElementRef.current = null;
            }
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
            }
            if (gainNodeRef.current) {
                gainNodeRef.current.disconnect();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (isPlayingRef.current) {
                isPlayingRef.current = null;
            }
        };
    }, [audioElement]);

    useFrame(() => {
        if (!audioContextRef.current || !gainNodeRef.current) {
            // console.log("Audio Context not ready, or gainNode not ready");
            return;
        }

        // const currentTime = sequence.position; // 假设sequence.position反映了当前的播放时间
        // const fadeDuration = 2; // 渐变持续时间（秒）

        if (!isPlayingRef.current && sequence.position >= startPoint) {
            if (audioContextRef.current.state !== 'running') {
                audioContextRef.current.resume().then(() => {
                    // console.log('AudioContext activated');
                    isPlayingRef.current = true;
                    setVolumeTransition('idle');
                }).catch((error) => {
                    console.error('Error activating AudioContext:', error);
                });
            }

            audioElement.play().then(() => {
                isPlayingRef.current = true;
                // console.log('Audio element play triggered successfully');
            }).catch((error) => {
                console.error('Error playing audio element:', error);
            });
        }

        // if (lowVolumePoints && highVolumePoints) {
        //     const shouldLowerVolume = lowVolumePoints.some(point => Math.abs(currentTime - point) < 0.1);
        //     const shouldRaiseVolume = highVolumePoints.some(point => Math.abs(currentTime - point) < 0.1);

        //     if (shouldLowerVolume && volumeTransition !== 'down') {
        //         gainNodeRef.current.gain.linearRampToValueAtTime(0.2, audioContextRef.current.currentTime + fadeDuration);
        //         setVolumeTransition('down');
        //     } else if (shouldRaiseVolume && volumeTransition !== 'up') {
        //         gainNodeRef.current.gain.linearRampToValueAtTime(maxVolume, audioContextRef.current.currentTime + fadeDuration);
        //         setVolumeTransition('up');
        //     }
        // }
    });

    return null;
}


export default StreamMusic;
