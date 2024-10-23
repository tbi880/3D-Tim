import WaitingForMoreModels from './WaitingForMoreModels';
import Galaxy from '../modelComponents/Galaxy';
import StreamMusic from '../modelComponents/StreamMusic';
import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL } from '../Settings';
import { scene5Project, scene5Sheet } from './SceneManager';
import StrangerStar from '../modelComponents/StrangerStar';
import AnyModel from '../modelComponents/AnyModel';

import { Environment } from '@react-three/drei';


function SceneFive_mobile({ startPoint, unloadPoint, onSequencePass }) {
    const musicUrl = bucketURL + 'music/bgm3.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(0);
    const [ambientColor, setAmbientColor] = useState("white");
    const [backgroundColor, setBackgroundColor] = useState("black");

    const timeoutRef = useRef(null);

    const changeColor = useCallback(() => {
        setAmbientColor("#ff0000");
        // 先清理之前的timeout，确保不会有未清理的timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        const maxIntensity = 5;
        // 定义一个递归函数来平滑更新亮度
        const updateIntensity = (start, end, duration, callback) => {
            const startTime = performance.now();
            const step = () => {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const newValue = start + (end - start) * progress;
                setAmbientIntensity(newValue);

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else if (callback) {
                    callback();
                }
            };
            requestAnimationFrame(step);
        };




        updateIntensity(0, maxIntensity, 1000, () => {

            updateIntensity(maxIntensity, 0, 1000, () => {

                updateIntensity(0, maxIntensity, 1000, () => {

                    updateIntensity(maxIntensity, 0, 1000, () => {
                        setAmbientColor("white");

                        timeoutRef.current = setTimeout(() => {
                            changeColor();
                            console.log('changeColor');
                        }, 10000);
                    });
                });
            });
        });
    }, []);

    useEffect(() => {
        changeColor(); // 初始调用
        return () => {
            // 组件卸载时清除timeout，避免内存泄漏
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [changeColor]);




    const initialShowComponents = {
        lightings: true,
    }
    // 使用一个对象来管理多个组件的初始显示状态,加载的时候先全部挂载，然后替换成上面的真实加载情况
    const [showComponents, setShowComponents] = useState({
        lightings: true,

    });

    useEffect(() => {
        setShowComponents(initialShowComponents);
    }, []);

    useEffect(() => {
        scene5Project.ready.then(() => {
            scene5Sheet.sequence.position = 0;
        });
    }, []);

    // 创建一个通用的切换函数
    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],

        }));

    }, []);

    const [audioElement, setAudioElement] = useState(null); // 用于存储<audio>元素的状态

    useEffect(() => {
        // console.log('Parent useEffect - Creating <audio> element');
        const audio = new Audio(musicUrl);
        audio.crossOrigin = "anonymous";
        setAudioElement(audio); // 设置状态以存储<audio>元素
    }, [musicUrl]);

    useEffect(() => {
        return () => {
            if (audioElement) {
                setAudioElement(null);
            }
        }
    }, [audioElement]);


    return (
        <>
            <PreloadAssets />
            <Suspense fallback={<WaitingForMoreModels />}>

                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene5Sheet.sequence} startPoint={0.02} maxVolume={1} />}
                <Galaxy />
                <StrangerStar />
                <AnyModel modelURL={'captains-chamber-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"captains-chamber-inside"} position={[550, 30, 0]} rotation={[0, -1.6, 0]} scale={[1, 1, 1]} />
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} />
                <color attach='background' args={[backgroundColor]} />
                <Environment
                    preset="studio"
                    resolution={2}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />
                <ambientLight color={ambientColor} intensity={ambientIntensity} />

            </Suspense>
        </>
    )
}

export default SceneFive_mobile;