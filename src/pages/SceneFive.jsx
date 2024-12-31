import Galaxy from '../modelComponents/Galaxy';
import ShipOutside from '../modelComponents/ShipOutside';
import StreamMusic from '../modelComponents/StreamMusic';
import { Suspense, useState, useCallback, useEffect, useRef, useContext, useMemo } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, stageOfENV } from '../Settings';
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
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { authorizationCheckContext } from '../sharedContexts/AuthorizationCheckProvider';
import { searchForEmergencyPlansContext } from '../sharedContexts/SearchForEmergencyPlansProvider';
import { headerSubTitleContext } from '../sharedContexts/HeaderSubTitleProvider';
import Loading from '../modelComponents/Loading';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';
import { useCameraSwitcher } from '../hooks/useCameraSwitcher';
import { TaskBoardContentContext } from '../sharedContexts/TaskBoardContentProvider';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';
import { useSequenceUnloadSceneChecker } from '../hooks/useSequenceUnloadSceneChecker';


function SceneFive({ startPoint, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const musicUrl = bucketURL + 'music/bgm5.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(0);
    const [warningFrequency, setWarningFrequency] = useState(10000);
    const [outAmbientIntensity, setOutAmbientIntensity] = useState(0);
    const [ambientColor, setAmbientColor] = useState("white");
    const [backgroundColor, setBackgroundColor] = useState("black");
    const [isWarped, setIsWarped] = useState(false);
    useSequenceUnloadSceneChecker(scene5Sheet.sequence, [unloadPoint], onSequencePass);
    const { estHitTimeCountDown, setEstHitTimeCountDown, initEstHitTimeCountDown } = useContext(estHitTimeCountDownContext);
    const { hullTemperature, setHullTemperature, initHullTemperature } = useContext(hullTemperatureContext);
    const { coreEnergy, setCoreEnergy, initCoreEnergy } = useContext(coreEnergyContext);
    const { showSendDistressSignalForm, setShowSendDistressSignalForm } = useContext(sendDistressSignalContext);
    const { showAuthorizationCheckForm, setShowAuthorizationCheckForm } = useContext(authorizationCheckContext);
    const { showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer } = useContext(searchForEmergencyPlansContext);
    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);
    const { messageApi } = useContext(GlobalNotificationContext);
    const audioElement = useAudioElement(musicUrl);
    const { taskBoardContent, setTaskBoardContent } = useContext(TaskBoardContentContext);
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            insideAmbientLight: true,
            shipOutside: true,
            chamberInside: true,
            preloadEnv: true,
            spaceEnv: true,
            viewportStart: true,
            robot: true,
            infoScreenDisplayDamageReport: true,
            buttonCalculateSlingshotTrajectory: true,
            buttonSendDistressSignal: true,
            buttonInitiateTheWarpEngine: true,
            isFormToggled: false,
            hologramSlingshotTrajectory: true,
            simulationResult: true,
            controlPanel: true,
            countdown: true,
            warping: true,
            shipOutside2: false,
            buttonSearchForEmergencyPlans: true,
            decryption: true,
            timsVideo: true,
            viewportProjectDawn: false,
            controlPanel2: false,
            loadingForTheNextScene: true,
        },
        initialComponents: {
            preloadAssets: false,
            insideAmbientLight: false,
            shipOutside: true,
            chamberInside: true,
            preloadEnv: false,
            spaceEnv: true,
            viewportStart: false,
            robot: false,
            infoScreenDisplayDamageReport: false,
            buttonCalculateSlingshotTrajectory: false,
            buttonSendDistressSignal: false,
            buttonInitiateTheWarpEngine: false,
            isFormToggled: false,
            hologramSlingshotTrajectory: false,
            simulationResult: false,
            controlPanel: false,
            countdown: false,
            warping: false,
            shipOutside2: false,
            buttonSearchForEmergencyPlans: false,
            decryption: false,
            timsVideo: true,
            viewportProjectDawn: false,
            controlPanel2: false,
            loadingForTheNextScene: false,

        }
    });
    const modelNodeVisibility = useMemo(() => ({
        "Object_225": [58],
        "Object_226": [58],
    }), []);

    const damageReport = "The external temperature of the ship is rising rapidly; the hull surface has reached a red-hot state. Based on the current rate of temperature increase, it is estimated that the hull structure will begin to melt in 15 minutes, at which point life support systems will fail. I have shared a calculated countdown to structural failure on your retinal display. Currently, the main thrusters lack sufficient power to escape the star's gravity. The backup thrusters are damaged. Ten minutes ago, our power reserves were at 30%. I initiated an emergency override to redirect energy, and the current power reserve is 48%, which is insufficient to support any high-power operations. In one minute, we can attempt a warp engine jump, but it may deplete all remaining energy and has an 80% chance of failure due to insufficient power.";
    const simulationResult = "After each time traveling for hundreds of years in empty space, we finally passed by a star system. We truly need the energy from this star to increase core energy, but we didn’t anticipate the star’s gravity would be so strong. As for whether we can use the star’s gravity to perform a gravitational slingshot maneuver and break free from its pull, all calculations for possible close-approach slingshot trajectories have been completed. The results indicate that, at our current speed and energy levels, none are feasible. The good news, however, is that we now have enough energy to activate the warp engine and can attempt to warp past the star, escaping its gravitational field to leave this star system.";
    const { isFirstPersonCamera, switchCamera } = useCameraSwitcher(false);
    const [signalSent, setSignalSent] = useState(false);
    const [simulationDone, setSimulationDone] = useState(false);
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);

    const finishLoading = useCallback(() => {
        scene5Project.ready.then(() => {
            scene5Sheet.sequence.position = 0;
            playOnce({ sequence: scene5Sheet.sequence, range: [0, 20] });
        });
    }, []);

    const timeoutRef = useRef(null);

    const changeColor = useCallback(() => {
        setAmbientColor("#ff0000");
        // Clear previous timeout to ensure no leftover timeouts
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        const maxIntensity = 5;
        // Define a recursive function to smoothly update intensity
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
                        }, warningFrequency);
                    });
                });
            });
        });
    }, [warningFrequency]);

    useEffect(() => {
        changeColor(); // Initial call
        return () => {
            // Clear timeout on component unmount to prevent memory leaks
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [changeColor]);

    useEffect(() => {
        // Initialize values
        initEstHitTimeCountDown(60 * 60);
        initHullTemperature(200);
        initCoreEnergy(5);
    }, [initEstHitTimeCountDown, initHullTemperature, initCoreEnergy]);

    useFrame(() => {
        if (scene5Sheet.sequence) {
            const currentPosition = scene5Sheet.sequence.position;
            if (1 < currentPosition && currentPosition < 20) {
                setEstHitTimeCountDown((prevCountdown) => (prevCountdown >= 1200 ? prevCountdown - 2 : prevCountdown));
                setHullTemperature((prevTemperature) => (prevTemperature <= 3500 ? prevTemperature + 2 : prevTemperature));
                setCoreEnergy((prevEnergy) => (prevEnergy <= 480 ? prevEnergy + 0.5 : prevEnergy));
            } else if (currentPosition === 41) {
                if (!showComponents.isFormToggled) {
                    toggleComponentDisplay("isFormToggled")
                    setShowSendDistressSignalForm(true);
                }
            }
        }
    });

    useEffect(() => {
        // Set up countdown function, temperature, and energy changes
        const interval = setInterval(() => {
            const tempRisingRate = isWarped ? 3 : 1;
            setEstHitTimeCountDown((prevCountdown) => (prevCountdown >= 0 ? prevCountdown - 1 : prevCountdown));
            setHullTemperature((prevTemperature) => (prevTemperature < 4500 ? prevTemperature + tempRisingRate : prevTemperature));
            setCoreEnergy((prevEnergy) => (prevEnergy < 1000 ? prevEnergy + 1 : prevEnergy));
        }, 1000);

        // Clear the interval to avoid memory leaks
        return () => clearInterval(interval);
    }, [estHitTimeCountDown, setEstHitTimeCountDown, hullTemperature, setHullTemperature, coreEnergy, setCoreEnergy]);

    const [taskBoardContentMap, setTaskBoardContentMap] = useState({
        0: "The warning is constantly flashing, the ship is in extreme danger. ",
        1: "Finally, I have answered the root access question, I can now access the ship's every system. Let me ask the AI for some updates on the ship's status.",
        2: "Oh my god, I did not expect the ship to be in such a bad state. The ship's hull temperature is rising rapidly, and the hull surface has reached a red-hot state. The main thrusters lack sufficient power to escape the star's gravity. While the power is being restored, I need to find some other ways to save the ship.",
        3: "Yes! I can send a distress signal to the nearest space station, and ask for help. See if anyone can come to our rescue.",
        4: "I can also simulate a slingshot trajectory to escape the star's gravity. Let me calculate the trajectory see if that works.",
        5: "Time to start the warp engine, let's get out of here safe and sound.",
        6: "Unbelievable, such a disaster. The warp sequence was forcibly aborted, the current position deviates from the target coordinates. The core energy reaction anomaly detected, disconnecting engine to prevent overload. The warp engine malfunction, energy output interrupted, unable to sustain spatial distortion!",
        7: "I think now we have no choice but to search for emergency plans as our last-hand. Let me see if I can find any useful information.",
        8: "The emergency plan is encrypted, I need to decrypt it first. (Check the Email you just submitted for the decryption key)",
        9: "The emergency plan is decrypted, let's see what it says.",
        10: "Let's see if this emergency plan can save us or not.(Click on the Viewport to activate the emergency plan)",
    });

    useEffect(() => {
        setTaskBoardContent(new Array(taskBoardContentMap[0]));
    }, []);

    return (
        <>
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["You made it!", "You are about to enter the command chamber", "You are about to experience some of my technical skills of backend development.", "Which involve .Net, message queue(RabbitMQ), async programming...", "Anyway, you'll see."]} onFinished={() => { finishLoading(); }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                {showComponents.preloadAssets && <PreloadAssets />}
                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene5Sheet.sequence} startPoint={20.1} maxVolume={1} />}
                <Galaxy />
                <StrangerStar />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={0.1} onSequencePass={() => { toggleComponentDisplay("chamberInside"); toggleComponentDisplay("timsVideo"); }} />

                {showComponents.shipOutside && <ShipOutside sequence={scene5Sheet.sequence} unloadPoint={20} onSequencePass={() => { toggleComponentDisplay("shipOutside") }} />}
                {!isFirstPersonCamera && <e.mesh theatreKey='Outside ambient light' additionalProps={{
                    intensity: types.number(outAmbientIntensity, {
                        range: [0, 10],
                    }),
                }}
                    objRef={(theatreObject) => {
                        // Listen to opacity changes in Theatre.js
                        theatreObject.onValuesChange((newValues) => {
                            setOutAmbientIntensity(newValues.intensity);
                        });
                    }} >
                    <ambientLight color={"#ff0000"} intensity={outAmbientIntensity} visible={!isFirstPersonCamera} />

                </e.mesh>}
                {showComponents.chamberInside && <AnyModel modelURL={'captains-chamber-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"captains-chamber-inside"} position={[550, 30, 0]} rotation={[0, -1.6, 0]} scale={[1, 1, 1]} visible={isFirstPersonCamera} modelNodeVisibility={modelNodeVisibility} />}
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={isFirstPersonCamera} position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} />
                <PerspectiveCamera theatreKey="ThirdPersonCamera" makeDefault={!isFirstPersonCamera} position={[550, 50, -10]} rotation={[0, -Math.PI / 2, 0]} fov={75} near={0.01} />

                <color attach='background' args={[backgroundColor]} />
                {showComponents.spaceEnv && <Environment
                    files={bucketURL + 'pic/space.exr'}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={10} onSequencePass={() => { switchCamera(true) }} />

                {showComponents.preloadEnv && <Environment
                    files={bucketURL + 'pic/studio.hdr'}
                    resolution={4}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}
                {showComponents.chamberInside && isFirstPersonCamera && <Environment
                    files={bucketURL + 'pic/studio.hdr'}
                    resolution={4}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={13} onSequencePass={() => { switchCamera(false) }} />


                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={18} onSequencePass={() => {
                    toggleComponentDisplay("chamberInside");
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20.5} onSequencePass={() => {
                    toggleComponentDisplay("shipOutside");
                    toggleComponentDisplay("spaceEnv");
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => {
                    switchCamera(true);
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={21} onSequencePass={() => {
                    messageApi(
                        'info',
                        'Power Saving Mode deactivated!',
                        3,
                    );
                }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={25} onSequencePass={() => { toggleComponentDisplay("insideAmbientLight") }} />
                {showComponents.insideAmbientLight && <ambientLight color={ambientColor} intensity={ambientIntensity} visible={isFirstPersonCamera} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={19.25} onSequencePass={() => { toggleComponentDisplay("robot") }} />
                {showComponents.robot && <Robot title="Robot" position={[562, 32.75, 0]} rotation={[0, 1.2, 0]} sequence={scene5Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("robot") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={19.75} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />
                {showComponents.viewportStart && <ViewPort screenTitle="ViewPort" position={[562, 32.75, 0]} rotation={[1.12, 3.21, -0.06]} sequence={scene5Sheet.sequence} stopPoint={23} unloadPoint={21} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={22} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />
                {showComponents.infoScreenDisplayDamageReport && <InfoScreenDisplay title={"damage report"} content={damageReport} sequence={scene5Sheet.sequence} stopPoints={[23.5, 24, 24.5, 25, 30]} loadPoints={isPortraitPhoneScreen ? [22, 23.5, 24, 24.5, 25] : [22, 23, 23.5, 24, 24.5]} unloadPoints={[23.5, 24, 24.5, 25, 25.5]} onSequencePass={() => { toggleComponentDisplay("infoScreenDisplayDamageReport") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={29} onSequencePass={() => { toggleComponentDisplay("buttonCalculateSlingshotTrajectory"); toggleComponentDisplay("buttonSendDistressSignal"); toggleComponentDisplay("buttonInitiateTheWarpEngine"); setTaskBoardContent(prev => [...prev, taskBoardContentMap[2]]); }} />
                {showComponents.buttonCalculateSlingshotTrajectory && <Button title={"calculate slingshot trajectory"} position={[558, 33.75, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={true} jumpToPoint={55} stopPoint={67.5} unloadPoint={56} onSequencePass={() => { toggleComponentDisplay("buttonCalculateSlingshotTrajectory"); setSimulationDone(true); }} additionalOnClickCallback={() => { setTaskBoardContent(prev => [...prev, taskBoardContentMap[4]]); }} />}
                {showComponents.buttonSendDistressSignal && <Button title={"send distress signal"} position={[558, 34, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={false} jumpToPoint={30} stopPoint={41} unloadPoint={42} onSequencePass={() => { toggleComponentDisplay("buttonSendDistressSignal"); setSignalSent(true); }} additionalOnClickCallback={() => { setTaskBoardContent(prev => [...prev, taskBoardContentMap[3]]); }} />}
                {showComponents.buttonInitiateTheWarpEngine && <Button title={"initiate the warp engine"} position={[558, 34.25, 3]} buttonLength={1.5} rotation={[0.12, 0.185, -0.06]} sequence={scene5Sheet.sequence} clickablePoint={30} IsPreJump={true} jumpToPoint={75} stopPoint={144} unloadPoint={76} alertAndNoPlay={!(signalSent && simulationDone)} alertMessage={"Insufficient energy!"} onSequencePass={() => { toggleComponentDisplay("buttonInitiateTheWarpEngine") }} additionalOnClickCallback={() => { setTaskBoardContent(prev => [...prev, taskBoardContentMap[5]]); }} />}


                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={59} onSequencePass={() => { toggleComponentDisplay("hologramSlingshotTrajectory") }} />
                {showComponents.hologramSlingshotTrajectory && <AnyModel modelURL='earth_hologram-transformed.glb' sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"hologram-SlingshotTrajectory"} position={[558, 34, 0]} rotation={[0, 0, 0]} scale={[0.5, 0.5, 0.5]} animationNames={["Take 01"]} animationAutoStart={true} unloadPoint={67} onSequencePass={() => { toggleComponentDisplay("hologramSlingshotTrajectory") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={67} onSequencePass={() => { toggleComponentDisplay("simulationResult") }} />
                {showComponents.simulationResult && <InfoScreenDisplay title={"simulation"} content={simulationResult} sequence={scene5Sheet.sequence} stopPoints={[68, 68.5, 69, 75]} loadPoints={isPortraitPhoneScreen ? [67, 68, 68.5, 69] : [67, 67.5, 68, 68.5]} unloadPoints={[68, 68.5, 69, 69.5]} onSequencePass={() => { toggleComponentDisplay("simulationResult") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={75} onSequencePass={() => { playOnce({ sequence: scene5Sheet.sequence, range: [29, 30] }) }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={85} onSequencePass={() => { toggleComponentDisplay("controlPanel") }} />
                {showComponents.controlPanel && <AnyModel modelURL={"control_panel-transformed.glb"} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"control-panel"} position={[552.11, 30.55, 0.19]} rotation={[0, -3.55, 0]} scale={[0.05, 0.05, 0.05]} animationNames={["Take 001"]} animationAutoStart={true} unloadPoint={98} onSequencePass={() => { toggleComponentDisplay("controlPanel") }} />}
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={103.3} onSequencePass={() => { toggleComponentDisplay("countdown") }} />
                {showComponents.countdown && <AnyModel modelURL={'countdown-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"countdown"} position={[551, 32.75, 0.19]} rotation={[0, 1.66, 0]} scale={[0.5, 0.5, 0.5]} animationNames={["Default Take"]} animationSpeeds={rate.current === 2 ? 2 : 1} animationStartPoint={0} animationPlayTimes={1} animationOnClick={false} unloadPoint={109} onSequencePass={() => { toggleComponentDisplay("countdown") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={109} onSequencePass={() => { toggleComponentDisplay("warping") }} />
                {showComponents.warping && <AnyModel modelURL={'FTL travelling.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"FTL travelling"} position={[551, 32.75, 0.19]} rotation={[0, -1.6, 0]} scale={[10, 10, 100]} animationNames={["Animation"]} animationOnClick={false} animationPlayTimes={1} animationSpeeds={1.2} animationStartPoint={0} unloadPoint={116} onSequencePass={() => { toggleComponentDisplay("warping") }} />}


                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={10} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Hull temperature rising detected!',
                        2.5
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={20} onSequencePass={() => {
                    messageApi(
                        'success',
                        "Welcome to the captain's command chamber!",
                        3,
                    );
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[1]]);
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={85} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Control panel loaded!',
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={86} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Access granted!',
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={87} onSequencePass={() => {
                    messageApi(
                        'loading',
                        'Initiating warp engine power preheat mode...',
                        2,
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={89} onSequencePass={() => {
                    setCoreEnergy(0);
                    messageApi(
                        'success',
                        'Energy injection completed!',
                        2,
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={90} onSequencePass={() => {
                    messageApi(
                        'loading',
                        'Synchronizing star map database...',
                        2,
                    )
                        .then(() => messageApi('info', 'Determining target coordinates..', 2))
                        .then(() => messageApi('success', 'Coordinates locked！', 1)).then(() => messageApi('success', 'Warp trajectory set!', 1));
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={98} onSequencePass={() => {
                    messageApi(
                        'loading',
                        "Aligning heading to target coordinates.",
                        2,
                    )
                        .then(() => messageApi('info', 'Energy module connected to the warp core, all non-essential systems entering standby mode.', 3))
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={103} onSequencePass={() => {
                    messageApi(
                        'info',
                        "Countdown initiated.",
                        2,
                    )
                        .then(() => messageApi('info', 'Warp field generated', 3))
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={117} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Warp sequence forcibly aborted, current position deviates from target coordinates!',
                        3,
                    )
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={117} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Core energy reaction anomaly detected, disconnecting engine to prevent overload.',
                        3,
                    )
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={117} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Warp engine malfunction, energy output interrupted, unable to sustain spatial distortion!',
                        3,
                    )
                }}
                />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={118} onSequencePass={() => {
                    setEstHitTimeCountDown(600);
                    setIsWarped(true);
                    messageApi(
                        'error',
                        'Unexpected gravitational wave interference, warp sequence forced to terminate!',
                        5,
                    );
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[6]]);
                }}
                />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={132} onSequencePass={() => { switchCamera(false); toggleComponentDisplay("spaceEnv"); }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={130} onSequencePass={() => { toggleComponentDisplay("shipOutside2"); }} />
                {showComponents.shipOutside2 && <ShipOutside sequence={scene5Sheet.sequence} unloadPoint={140} onSequencePass={() => { toggleComponentDisplay("shipOutside2") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={140} onSequencePass={() => { switchCamera(true); toggleComponentDisplay("spaceEnv"); }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={143} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Impact expected in 10 minutes!',
                        5,
                    );
                    messageApi(
                        'warning',
                        'A rapid hull temperature rise has been detected!',
                        5,
                    );
                    messageApi(
                        'warning',
                        'Code Bravo! Deck E port side has been damaged! Emergency bulkhead doors have been activated!',
                        5,
                    );
                    toggleComponentDisplay("buttonSearchForEmergencyPlans");
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[7]]);
                }} />

                {showComponents.buttonSearchForEmergencyPlans && <Button title={"Search for last-hand plans"} position={[246.15, 33.25, -73.5]} buttonLength={1.5} rotation={[0, 3.67, 0]} sequence={scene5Sheet.sequence} clickablePoint={144} IsPreJump={false} jumpToPoint={144} stopPoint={153} unloadPoint={145} onSequencePass={() => { toggleComponentDisplay("buttonSearchForEmergencyPlans") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={153} onSequencePass={() => {
                    setShowAuthorizationCheckForm(true);
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[8]]);
                }
                } />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={153.25} onSequencePass={() => {
                    toggleComponentDisplay("decryption");
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[9]]);
                    messageApi('loading', 'Alpha class layer decryption is in progress!', 9).then(() => messageApi('success', 'Alpha class layer decrypted successfully!', 2));
                }} />
                {showComponents.decryption && <AnyModel modelURL={'circuits_in_motion-transformed.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"Decryption"} position={[257.75, 34, -71.6]} rotation={[0, 3, 0]} scale={[0.001, 0.001, 0.001]} animationNames={["GltfAnimation 0"]} animationOnClick={false} animationPlayTimes={1} animationSpeeds={0.5} unloadPoint={164} onSequencePass={() => { toggleComponentDisplay("decryption"); }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={164} onSequencePass={() => { setShowSearchForEmergencyPlansLayer(true); }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={165.5} onSequencePass={() => { messageApi('info', 'You received a video recording from the captain Tim!!!', 3) }} />

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={167} onSequencePass={() => { toggleComponentDisplay("timsVideo"); setShowHeaderSubTitle(true); }} />
                {showComponents.timsVideo && <AnyModel modelURL={'TimsVideo.glb'} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"Tim"} position={[257, 33.75, -75.5]} rotation={[0, -1.75, 0]} scale={[2, 2, 2]} animationNames={["2024-10-22--23-55-58"]} animationOnClick={false} animationPlayTimes={1} animationSpeeds={1} unloadPoint={183} onSequencePass={() => { toggleComponentDisplay("timsVideo"); }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={184} onSequencePass={() => { toggleComponentDisplay("viewportProjectDawn"); setTaskBoardContent(prev => [...prev, taskBoardContentMap[10]]); }} />
                {showComponents.viewportProjectDawn && <ViewPort screenTitle="viewportProjectDawn" position={[253.67, 33.1, -76.68]} rotation={[0, 1.59, 0]} sequence={scene5Sheet.sequence} stopPoint={207} unloadPoint={187} onSequencePass={() => { toggleComponentDisplay("viewportProjectDawn") }} isSetNextScene={true} nextScene={"sceneSix"} nextSceneStartPoint={0} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={193} onSequencePass={() => { toggleComponentDisplay("controlPanel2") }} />
                {showComponents.controlPanel2 && <AnyModel modelURL={"control_panel-transformed.glb"} sequence={scene5Sheet.sequence} useTheatre={true} theatreKey={"control-panel2"} position={[252, 32.5, -76]} rotation={[0, -3.55, 0]} scale={[0.05, 0.05, 0.05]} animationNames={["Take 001"]} animationAutoStart={true} unloadPoint={200} onSequencePass={() => { toggleComponentDisplay("controlPanel2") }} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={193} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Control panel loaded!',
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={194} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Access granted!',
                    )
                }} />
                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={196} onSequencePass={() => {
                    messageApi(
                        'loading',
                        'Project Dawn is being loaded...',
                        3,
                    ).then(() => messageApi('success', 'Project Dawn loaded!', 2));
                }} />

                <SingleLoadManager loadPoint={201} sequence={scene5Sheet.sequence} onSequencePass={() => { toggleComponentDisplay('loadingForTheNextScene'); toggleComponentDisplay("chamberInside"); setWarningFrequency(500); }} />
                {showComponents.loadingForTheNextScene && <Loading THkey="ForTheNextScene" title="ForTheNextScene" lines={["Connecting ", "to Tim's ", "Project Dawn "]} position={[252, 32.5, -76]} rotation={[0, -6.28, 0]} sequence={scene5Sheet.sequence} unloadPoint={208} onSequencePass={() => { toggleComponentDisplay('loadingForTheNextScene'); }} textTitleVersion={2} />}

                <SingleLoadManager sequence={scene5Sheet.sequence} loadPoint={207} onSequencePass={() => onSequencePass()} />


            </Suspense>
        </>
    )
}

export default SceneFive;
