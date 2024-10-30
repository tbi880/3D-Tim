import WaitingForMoreModels from './WaitingForMoreModels';
import Galaxy from '../modelComponents/Galaxy';
import ShipOutside from '../modelComponents/ShipOutside';
import StreamMusic from '../modelComponents/StreamMusic';
import { Suspense, useState, useCallback, useEffect, useRef, useContext, useMemo } from 'react';
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
import { estHitTimeCountDownContext } from '../sharedContexts/EstHitTimeCountDownProvider';
import { hullTemperatureContext } from '../sharedContexts/HullTemperatureProvider';
import { coreEnergyContext } from '../sharedContexts/CoreEnergyProvider';
import { useFrame } from '@react-three/fiber';
import Button from '../modelComponents/button';
import { sendDistressSignalContext } from '../sharedContexts/SendDistressSignalProvider';


function SceneFive_mobile({ startPoint, unloadPoint, onSequencePass }) {
    const musicUrl = bucketURL + 'music/bgm5.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(0);
    const [outAmbientIntensity, setOutAmbientIntensity] = useState(0);
    const [ambientColor, setAmbientColor] = useState("white");
    const [backgroundColor, setBackgroundColor] = useState("black");
    const { estHitTimeCountDown, setEstHitTimeCountDown, initEstHitTimeCountDown } = useContext(estHitTimeCountDownContext);
    const { hullTemperature, setHullTemperature, initHullTemperature } = useContext(hullTemperatureContext);
    const { coreEnergy, setCoreEnergy, initCoreEnergy } = useContext(coreEnergyContext);
    const { showForm, setShowForm } = useContext(sendDistressSignalContext);
    const modelNodeVisibility = useMemo(() => ({
        "Object_225": [58],
        "Object_226": [58],
    }), []);

    const damageReport = "The external temperature of the ship is rising rapidly; the hull surface has reached a red-hot state. Based on the current rate of temperature increase, it is estimated that the hull structure will begin to melt in 15 minutes, at which point life support systems will fail. I have shared a calculated countdown to structural failure on your retinal display. Currently, the main thrusters lack sufficient power to escape the star's gravity. The backup thrusters are damaged. Ten minutes ago, our power reserves were at 30%. I initiated an emergency override to redirect energy, and the current power reserve is 48%, which is insufficient to support any high-power operations. In one minute, we can attempt a warp engine jump, but it may deplete all remaining energy and has an 80% chance of failure due to insufficient power."
    const simulationResult = "After each time traveling for hundreds of years in empty space, we finally passed by a star system. We truly need the energy from this star to increase core energy, but we didn’t anticipate the star’s gravity would be so strong. As for whether we can use the star’s gravity to perform a gravitational slingshot maneuver and break free from its pull, all calculations for possible close-approach slingshot trajectories have been completed. The results indicate that, at our current speed and energy levels, none are feasible. The good news, however, is that we now have enough energy to activate the warp engine and can attempt to warp past the star, escaping its gravitational field to leave this star system."
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

    useEffect(() => {
        // 初始化值
        initEstHitTimeCountDown(60 * 60);
        initHullTemperature(200);
        initCoreEnergy(5);
    }, [initEstHitTimeCountDown, initHullTemperature, initCoreEnergy]);

    useFrame(() => {
        if (scene5Sheet.sequence) {
            const currentPosition = scene5Sheet.sequence.position;
            if (1 < currentPosition && currentPosition < 20) {
                setEstHitTimeCountDown((prevCountdown) => (prevCountdown >= 900 ? prevCountdown - 3 : prevCountdown));
                setHullTemperature((prevTemperature) => (prevTemperature <= 3500 ? prevTemperature + 3 : prevTemperature));
                setCoreEnergy((prevEnergy) => (prevEnergy <= 480 ? prevEnergy + 0.5 : prevEnergy));
            } else if (currentPosition === 41) {
                if (!showComponents.isFormToggled) {
                    toggleComponentDisplay("isFormToggled")
                    setShowForm(true);
                }
            }
        }
    });

    useEffect(() => {
        // 设置倒计时函数,温度和能量的变化
        const interval = setInterval(() => {
            setEstHitTimeCountDown((prevCountdown) => (prevCountdown >= 0 ? prevCountdown - 1 : prevCountdown));
            setHullTemperature((prevTemperature) => (prevTemperature < 4500 ? prevTemperature + 1 : prevTemperature));
            setCoreEnergy((prevEnergy) => (prevEnergy < 1000 ? prevEnergy + 1 : prevEnergy));
        }, 1000);

        // 清除计时器，避免内存泄漏
        return () => clearInterval(interval);
    }, [estHitTimeCountDown, setEstHitTimeCountDown, hullTemperature, setHullTemperature, coreEnergy, setCoreEnergy]);


    const initialShowComponents = {
        insideAmbientLight: false,
        shipOutside: true,
        chamberInside: false,
        preloadEnv: false,
        viewportStart: false,
        robot: false,
        infoScreenDisplayDamageReport: false,
        buttonCalculateSlingshotTrajectory: false,
        buttonSendDistressSignal: false,
        buttonInitiateTheWarpEngine: false,
        isFormToggled: false,
        hologramSlingshotTrajectory: false,
        simulationResult: false,
    }
    // 使用一个对象来管理多个组件的初始显示状态,加载的时候先全部挂载，然后替换成上面的真实加载情况
    const [showComponents, setShowComponents] = useState({
        insideAmbientLight: true,
        shipOutside: true,
        chamberInside: true,
        preloadEnv: true,
        viewportStart: true,
        robot: true,
        infoScreenDisplayDamageReport: true,
        buttonCalculateSlingshotTrajectory: true,
        buttonSendDistressSignal: true,
        buttonInitiateTheWarpEngine: true,
        isFormToggled: false,
        hologramSlingshotTrajectory: true,
        simulationResult: true,

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
                {showComponents.shipOutside && <ShipOutside sequence={scene5Sheet.sequence} unloadPoint={20} onSequencePass={() => { toggleComponentDisplay("shipOutside") }} />}
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
                {showComponents.chamberInside && <AnyModel modelURL={'captains-chamber-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"captains-chamber-inside"} position={[550, 30, 0]} rotation={[0, -1.6, 0]} scale={[1, 1, 1]} visible={currentCamera === "FirstPersonCamera"} modelNodeVisibility={modelNodeVisibility} />}
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
                    toggleComponentDisplay("chamberInside");
                    toggleComponentDisplay("shipOutside");
                    switchCamera("FirstPersonCamera");
                }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={25} onSequencePass={() => { toggleComponentDisplay("insideAmbientLight") }} />
                {showComponents.insideAmbientLight && <ambientLight color={ambientColor} intensity={ambientIntensity} visible={currentCamera === "FirstPersonCamera"} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => { toggleComponentDisplay("robot") }} />
                {showComponents.robot && <Robot title="Robot" position={[562, 32.75, 0]} rotation={[0, 1.2, 0]} sequence={scene5Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("robot") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />
                {showComponents.viewportStart && <ViewPort screenTitle="ViewPort" position={[562, 32.75, 0]} rotation={[1.12, 3.21, -0.06]} sequence={scene5Sheet.sequence} stopPoint={23} unloadPoint={21} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={22} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />
                {showComponents.infoScreenDisplayDamageReport && <InfoScreenDisplay title={"damage report"} content={damageReport} sequence={scene5Sheet.sequence} stopPoints={[23.5, 24, 24.5, 25, 30]} loadPoints={[22, 23, 23.5, 24, 24.5]} unloadPoints={[23.5, 24, 24.5, 25, 25.5]} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={29} onSequencePass={() => { toggleComponentDisplay("buttonCalculateSlingshotTrajectory"); toggleComponentDisplay("buttonSendDistressSignal"); toggleComponentDisplay("buttonInitiateTheWarpEngine"); }} />
                {showComponents.buttonCalculateSlingshotTrajectory && <Button title={"calculate slingshot trajectory"} position={[558, 33.75, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={true} jumpToPoint={55} stopPoint={67.5} unloadPoint={56} onSequencePass={() => { toggleComponentDisplay("buttonCalculateSlingshotTrajectory") }} />}
                {showComponents.buttonSendDistressSignal && <Button title={"send distress signal"} position={[558, 34, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={false} jumpToPoint={30} stopPoint={41} unloadPoint={42} onSequencePass={() => { toggleComponentDisplay("buttonSendDistressSignal") }} />}
                {showComponents.buttonInitiateTheWarpEngine && <Button title={"initiate the warp engine"} position={[558, 34.25, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={true} jumpToPoint={25} stopPoint={30} onSequencePass={() => { }} />}


                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={59} onSequencePass={() => { toggleComponentDisplay("hologramSlingshotTrajectory") }} />
                {showComponents.hologramSlingshotTrajectory && <AnyModel modelURL='earth_hologram-transformed.glb' sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"hologram-SlingshotTrajectory"} position={[558, 34, 0]} rotation={[0, 0, 0]} scale={[0.5, 0.5, 0.5]} animationNames={["Take 01"]} animationAutoStart={true} unloadPoint={67} onSequencePass={() => { toggleComponentDisplay("hologramSlingshotTrajectory") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={67} onSequencePass={() => { toggleComponentDisplay("simulationResult") }} />
                {showComponents.simulationResult && <InfoScreenDisplay title={"simulation"} content={simulationResult} sequence={scene5Sheet.sequence} stopPoints={[68, 68.5, 69, 75]} loadPoints={[67, 67.5, 68, 68.5]} unloadPoints={[68, 68.5, 69, 69.5]} onSequencePass={() => { toggleComponentDisplay("simulationResult") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={75} onSequencePass={() => { scene5Sheet.sequence.play({ range: [29, 30] }) }} />
                {/* <AnyModel modelURL={'FTL travelling.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"FTL travelling"} position={[750, 0, 0]} rotation={[0, -1.6, 0]} scale={[10, 10, 10]} visible={currentCamera === "ThirdPersonCamera"} animationNames={["Animation"]} animationAutoStart={true} animationStartPoint={0} /> */}


            </Suspense>
        </>
    )
}

export default SceneFive_mobile;