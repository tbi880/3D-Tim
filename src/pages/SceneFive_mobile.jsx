import WaitingForMoreModels from './WaitingForMoreModels';
import Galaxy from '../modelComponents/Galaxy';
import ShipOutside from '../modelComponents/ShipOutside';
import StreamMusic from '../modelComponents/StreamMusic';
import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL } from '../Settings';
import { scene5Project, scene5Sheet } from './SceneManager';
import StrangerStar from '../modelComponents/StrangerStar';
import AnyModel from '../modelComponents/AnyModel';

import { Environment } from '@react-three/drei';
import { types } from '@theatre/core';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import ViewPort from '../modelComponents/ViewPort';
import Robot from '../modelComponents/Robot';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';


function SceneFive_mobile({ startPoint, unloadPoint, onSequencePass }) {
    const musicUrl = bucketURL + 'music/bgm5.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(0);
    const [outAmbientIntensity, setOutAmbientIntensity] = useState(0);
    const [ambientColor, setAmbientColor] = useState("white");
    const [backgroundColor, setBackgroundColor] = useState("black");

    const damageReport = "The external temperature of the ship is rising rapidly; the hull surface has reached a red-hot state. Based on the current rate of temperature increase, it is estimated that the hull structure will begin to melt in 15 minutes, at which point life support systems will fail. I have shared a calculated countdown to structural failure on your retinal display. Currently, the main thrusters lack sufficient power to escape the star's gravity. The backup thrusters are damaged. Ten minutes ago, our power reserves were at 3%. I initiated an emergency override to redirect energy, and the current power reserve is 4.5%, which is insufficient to support any high-power operations. In one minute, we can attempt a warp engine jump, but it may deplete all remaining energy and has an 80% chance of failure due to insufficient power."

    const [currentCamera, setCurrentCamera] = useState("ThirdPersonCamera");

    const switchCamera = useCallback((cameraKey) => {
        setCurrentCamera(cameraKey);
    }, []);


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
        insideAmbientLight: false,
        chamberInside: false,
        preloadEnv: false,
        viewportStart: false,
        robot: false,
        infoScreenDisplayDamageReport: false,
    }
    // 使用一个对象来管理多个组件的初始显示状态,加载的时候先全部挂载，然后替换成上面的真实加载情况
    const [showComponents, setShowComponents] = useState({
        insideAmbientLight: true,
        chamberInside: true,
        preloadEnv: true,
        viewportStart: true,
        robot: true,
        infoScreenDisplayDamageReport: true,
    });

    useEffect(() => {
        setShowComponents(initialShowComponents);
    }, []);

    useEffect(() => {
        scene5Project.ready.then(() => {
            scene5Sheet.sequence.position = 0;
            scene5Sheet.sequence.play({ range: [0, 20] });
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
                <ShipOutside />
                <e.mesh theatreKey='Outside ambient light' additionalProps={{
                    intensity: types.number(outAmbientIntensity, {
                        range: [0, 10],
                    }),
                }}
                    objRef={(theatreObject) => {
                        // 监听Theatre.js中透明度的变化
                        theatreObject.onValuesChange((newValues) => {
                            setOutAmbientIntensity(newValues.intensity);
                        });
                    }} >
                    <ambientLight color={"#ff0000"} intensity={outAmbientIntensity} visible={currentCamera === "ThirdPersonCamera"} />

                </e.mesh>
                {showComponents.chamberInside && <AnyModel modelURL={'captains-chamber-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"captains-chamber-inside"} position={[550, 30, 0]} rotation={[0, -1.6, 0]} scale={[1, 1, 1]} visible={currentCamera === "FirstPersonCamera"} />}
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={currentCamera === "FirstPersonCamera"} position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} />
                <PerspectiveCamera theatreKey="ThirdPersonCamera" makeDefault={currentCamera === "ThirdPersonCamera"} position={[550, 50, -10]} rotation={[0, -Math.PI / 2, 0]} fov={75} near={0.01} />

                <color attach='background' args={[backgroundColor]} />
                <Environment
                    files={bucketURL + 'pic/space.exr'}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={10} onSequencePass={() => { switchCamera("FirstPersonCamera") }} />

                {showComponents.preloadEnv && <Environment
                    preset='studio'
                    resolution={4}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}
                {showComponents.chamberInside && currentCamera === "FirstPersonCamera" && <Environment
                    preset='studio'
                    resolution={4}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={13} onSequencePass={() => { switchCamera("ThirdPersonCamera") }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => {
                    toggleComponentDisplay("insideAmbientLight");
                    toggleComponentDisplay("chamberInside");
                    switchCamera("FirstPersonCamera");
                }} />
                {showComponents.insideAmbientLight && <ambientLight color={ambientColor} intensity={ambientIntensity} visible={currentCamera === "FirstPersonCamera"} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => { toggleComponentDisplay("robot") }} />
                {showComponents.robot && <Robot title="Robot" position={[562, 32.75, 0]} rotation={[0, 1.2, 0]} sequence={scene5Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("robot") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />
                {showComponents.viewportStart && <ViewPort screenTitle="ViewPort" position={[562, 32.75, 0]} rotation={[1.12, 3.21, -0.06]} sequence={scene5Sheet.sequence} stopPoint={23} unloadPoint={21} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={22} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />
                {showComponents.infoScreenDisplayDamageReport && <InfoScreenDisplay title={"damage report"} content={damageReport} sequence={scene5Sheet.sequence} stopPoints={[23.5, 24, 24.5, 25, 30]} loadPoints={[22, 23, 23.5, 24, 24.5]} unloadPoints={[24, 24.5, 25, 25.5, 26]} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />}


                {/* <AnyModel modelURL={'FTL travelling.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"FTL travelling"} position={[750, 0, 0]} rotation={[0, -1.6, 0]} scale={[10, 10, 10]} visible={currentCamera === "ThirdPersonCamera"} animationNames={["Animation"]} animationAutoStart={true} animationStartPoint={0} /> */}


            </Suspense>
        </>
    )
}

export default SceneFive_mobile;