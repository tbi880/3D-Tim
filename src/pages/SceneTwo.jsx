import { getEngineeringHasBeenAccessed, getRootAccess, getShipHangerHasBeenAccessed } from './Status';
import StrangerStar from '../modelComponents/StrangerStar';
import ShipInside from '../modelComponents/ShipInside';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import Button from '../modelComponents/button';
import ViewPort from '../modelComponents/ViewPort';
import StreamMusic from '../modelComponents/StreamMusic';
import Robots from '../modelComponents/Robot';
import { Suspense, useState, useCallback, useEffect, useContext } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { scene2Sheet, scene2Project } from "./SceneManager";
import { bucketURL, stageOfENV } from '../Settings';
import Loading from '../modelComponents/Loading';
import { Environment, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import Loader from './Loader';
import { canvasContext } from '../sharedContexts/CanvasProvider';
import { XrToolsContext } from '../sharedContexts/XrToolsProvider';
import { XrSqueezeEventListener } from '../Tools/XrSqueezeEventListener';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';
import { useSequenceUnloadSceneChecker } from '../hooks/useSequenceUnloadSceneChecker';
import { TaskBoardContentContext } from '../sharedContexts/TaskBoardContentProvider';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';


function SceneTwo({ startPoint, unloadPoints, onSequencePass, isPortraitPhoneScreen }) {
    const screenIntro = "You finally awaken, chief designer! Our ship is about to enter the strange red giant ahead of us. The ship is damaged quite severe due to the strong gravitational force. As AI, we cannot change the course of the ship because the first captain, Tim Bi, set it up millennia ago. Additionally, we have been blocked from answering the questions to unlock the captain's chamber. We need your help to find the answers to the root access questions so we can alter the ship's course or initiate an emergency stop. Please follow me to the bridge. Let's start by checking the structure of the ship first. This will probably help you to rewind your memory about the ship.";
    const musicUrl = bucketURL + 'music/bgm2.mp3';
    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);
    const [player, setPlayer] = useState(null);
    const [isPresenting, setIsPresenting] = useState(false);
    const { xrPlayer, xrIsPresenting } = isVRSupported && useContext(XrToolsContext) ? useContext(XrToolsContext) : {};
    const audioElement = useAudioElement(musicUrl);
    useSequenceUnloadSceneChecker(scene2Sheet.sequence, unloadPoints, onSequencePass);
    const { taskBoardContent, setTaskBoardContent } = useContext(TaskBoardContentContext);
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);


    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            shipInside: true,
            robotIntro: true,
            viewPortIntro: true,
            screenIntro: true,
            buttonForGOTOShipHangar: false,
            buttonForGOTOEngineering: false,
            buttonForGOTOCaptainsChamber: false,
            textTitleGetROOTACCESS: false,
            viewPortShipHanger: false,
            loadingForShipHanger: false,
            viewPortEngineering: false,
            loadingForEngineering: false,
            viewPortTimsChamber: false,
            loadingForTimsChamber: false
        }, initialComponents: {
            preloadAssets: false,
            shipInside: true,
            robotIntro: true,
            viewPortIntro: true,
            screenIntro: true,
            buttonForGOTOShipHangar: false,
            buttonForGOTOEngineering: false,
            buttonForGOTOCaptainsChamber: false,
            textTitleGetROOTACCESS: false,
            viewPortShipHanger: false,
            loadingForShipHanger: false,
            viewPortEngineering: false,
            loadingForEngineering: false,
            viewPortTimsChamber: false,
            loadingForTimsChamber: false
        }
    });

    useEffect(() => {
        setPlayer(xrPlayer);
        setIsPresenting(xrIsPresenting);
    }, [xrPlayer, xrIsPresenting]);


    const [VRCordinate, setVRCordinate] = useState({
        0: [499, -24, -60],
        1: [630, -18, -106],
        2: [565, -18, -106],
        3: [668, -21.3, 0.3],
        4: [562, -19, 65],
        5: [505, -27, 22.5],
        6: [552, 7, 16],
        7: [526, -16, -20],
    });
    const [currentVRCordinate, setCurrentVRCordinate] = useState(0);

    useEffect(() => {
        if (player) {
            player.position.set(499, -24, -60);
        }
    }, [player]);

    useEffect(() => {
        useGLTF.preload(bucketURL + 'loading.glb');

        scene2Project.ready.then(() => {
            if (startPoint && startPoint != 0) {
                playOnce({ sequence: scene2Sheet.sequence, range: [startPoint, startPoint + 0.5] });
            }
        });
    }, []);



    useFrame(() => {
        if (isVRSupported) {
            if (isPresenting) {
                if (player) {
                    player.position.set(VRCordinate[currentVRCordinate][0], VRCordinate[currentVRCordinate][1], VRCordinate[currentVRCordinate][2]);
                }
            } else {
                if (player) {
                    player.position.set(0, 0, 0);
                }
            }
        }
    });

    const handleLeftSqueeze = () => {
        setCurrentVRCordinate((prev) => {
            return prev === 0 ? Object.keys(VRCordinate).length - 1 : prev - 1;
        });
    };

    const handleRightSqueeze = () => {
        setCurrentVRCordinate((prev) => {
            return prev < Object.keys(VRCordinate).length - 1 ? prev + 1 : 0;
        });
    };


    const [taskBoardContentMap, setTaskBoardContentMap] = useState({
        0: "I am now awaken in the ship. What happened to the ship? Let me find out by asking the AI. ( Click on the AI to start the conversation )",
        1: "Okay, so the ship is in danger... I need to get the command chamber as quickly as possible to save the ship. In order to do so, I need to find the root access first, since I am the only one on ship know the early life of the mighty captain Tim, that's why i am here. Let me go to the bridge to check the structure of the ship first, then decide where to go next.",
        2: "Seems the ship is in a bad shape, can't handle too long, maybe just a few hours left. Let me decide where should i go next. ( Click on one of the buttons to decide where to go next )",
        3: "Let me go to the ship hanger , maybe I can find some information relate to Tim's early experience there.",
        4: "Let me go to the engineering department, maybe I can find some information relate to Tim's early projects there.",
        5: "Let me go to Tim's chamber finally, to save the ship. ( strongly recommend to use the PC to view this part, some of the models are too heavy to load on the phone )",
    });

    useEffect(() => {
        setTaskBoardContent(new Array(taskBoardContentMap[0]));
    }, []);

    return (
        <>
            {/* <Canvas gl={{ preserveDrawingBuffer: true }} >
                <SheetProvider sheet={scene1Sheet}> */}
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["You will see some options", "Where you want to go depends on what you want to know about me", "My journey in tech or my previous work experience.", "or you want to meet me in person in my command chamber"]} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}

                {showComponents.preloadAssets && <PreloadAssets />}

                {isVRSupported && <XrSqueezeEventListener onLeftSqueeze={handleLeftSqueeze} onRightSqueeze={handleRightSqueeze} />}
                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene2Sheet.sequence} startPoint={0.5} />}
                {/* <AsyncMusic audioBuffer={audioBuffer} sequence={scene2Sheet.sequence} startPoint={0.5} lowVolumePoints={[1]} highVolumePoints={[3]} maxVolume={0.75} /> */}
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[498, -19, -61]} rotation={[0, 1.55, 0]} fov={75} near={0.01} />

                <color attach='background' args={['black']} />

                {/* <ambientLight intensity={3} /> */}

                <Galaxy />
                <StrangerStar />

                <Environment
                    files={bucketURL + 'pic/warehouse.hdr'}
                    resolution={1}
                    intensity={2}
                    backgroundIntensity={0}
                    environmentIntensity={0}
                />
                <ShipInside sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('shipInside')} />
                {showComponents.viewPortIntro && <ViewPort screenTitle="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} stopPoint={1} unloadPoint={1} onSequencePass={() => toggleComponentDisplay('viewPortIntro')} />}
                {showComponents.robotIntro && <Robots title="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('robotIntro')} />}
                {showComponents.screenIntro && <InfoScreenDisplay title="Conversation" content={screenIntro} sequence={scene2Sheet.sequence} stopPoints={[1.5, 2, 2.5, 22.5]} loadPoints={isPortraitPhoneScreen ? [0, 1.5, 2, 2.5] : [0, 1, 1.5, 2]} unloadPoints={[2, 2.5, 3, 3.5]} onSequencePass={() => toggleComponentDisplay("screenIntro")} />}

                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('textTitleGetROOTACCESS')} />
                {showComponents.textTitleGetROOTACCESS && <TextTitle text="Where to get the ROOT ACCESS?" color="#99CCFF" size={1} sequence={scene2Sheet.sequence} unloadPoint={24} onSequencePass={() => toggleComponentDisplay('textTitleGetROOTACCESS')} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOShipHangar')} />
                {showComponents.buttonForGOTOShipHangar && !(getShipHangerHasBeenAccessed()) && <Button title={"To the ship hanger"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} jumpToPoint={22.5} stopPoint={33} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOShipHangar')} additionalOnClickCallback={() => {
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[3]]);
                }} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOEngineering')} />
                {showComponents.buttonForGOTOEngineering && !(getEngineeringHasBeenAccessed()) && <Button title={"To the engineering"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} IsPreJump={true} jumpToPoint={39} stopPoint={68} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOEngineering')} additionalOnClickCallback={() => {
                    setTaskBoardContent(prev => [...prev, taskBoardContentMap[4]]);
                }} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOCaptainsChamber')} />
                {showComponents.buttonForGOTOCaptainsChamber && <Button title={"To Tim's chamber"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} IsPreJump={true} jumpToPoint={73.5} stopPoint={86} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOCaptainsChamber')} alertAndNoPlay={!getRootAccess()} alertMessage={"Please come back later when you have the access. You are not authorized to go there yet! "} />}


                {/*
 这里开始是去ship hanger的部分
 */}
                <SingleLoadManager loadPoint={33} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('viewPortShipHanger')} />
                {showComponents.viewPortShipHanger && <ViewPort screenTitle="Ship Hanger" position={[470, -21, -5.5]} rotation={[0, -1.57, 0]} sequence={scene2Sheet.sequence} stopPoint={38} unloadPoint={35} onSequencePass={() => toggleComponentDisplay('viewPortShipHanger')} isSetNextScene={true} nextScene={"sceneThree"} nextSceneStartPoint={0} />}
                <SingleLoadManager loadPoint={35} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('loadingForShipHanger')} />
                {showComponents.loadingForShipHanger && <Loading title="ship hanger" lines={["Connecting", "to Tim's", "namespace"]} position={[470, -21, -5.5]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} unloadPoint={38.5} onSequencePass={() => toggleComponentDisplay('loadingForShipHanger')} />}


                {/*
 这里开始是去Engineering的部分
 */}
                <SingleLoadManager loadPoint={63} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('viewPortEngineering')} />
                {showComponents.viewPortEngineering && <ViewPort screenTitle="EngineeringDept" position={[609, -20.8, -15.75]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} stopPoint={72} unloadPoint={69} onSequencePass={() => toggleComponentDisplay('viewPortEngineering')} isSetNextScene={true} nextScene={"sceneFour"} nextSceneStartPoint={0} />}
                <SingleLoadManager loadPoint={70} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('loadingForEngineering')} />
                {showComponents.loadingForEngineering && <Loading THkey="Engineering" title="Engineering" lines={["Connecting ", "to Tim's ", "namespace "]} position={[609, -20.8, -15.75]} rotation={[0, 4.68, 0]} sequence={scene2Sheet.sequence} unloadPoint={73} onSequencePass={() => toggleComponentDisplay('loadingForEngineering')} textTitleVersion={2} />}


                {/*
 这里开始是去Tim's chamber的部分
 */}
                <SingleLoadManager loadPoint={83} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('viewPortTimsChamber')} />
                {showComponents.viewPortTimsChamber && <ViewPort screenTitle="TimsChamber" position={[548, -17.85, -26.15]} rotation={[0, 11, 0]} sequence={scene2Sheet.sequence} stopPoint={96} unloadPoint={90} onSequencePass={() => toggleComponentDisplay('viewPortTimsChamber')} isSetNextScene={true} nextScene={"sceneFive"} nextSceneStartPoint={0} />}
                <SingleLoadManager loadPoint={93} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('loadingForTimsChamber')} />
                {showComponents.loadingForTimsChamber && <Loading THkey="TimsChamber" title="TimsChamber" lines={["Authenticating ", "access to ", "Tim's chamber "]} position={[560.75, 5.25, -22.5]} rotation={[0, 9.45, 0]} sequence={scene2Sheet.sequence} unloadPoint={96.5} onSequencePass={() => toggleComponentDisplay('loadingForTimsChamber')} textTitleVersion={2} />}


                <SingleLoadManager
                    loadPoint={4}
                    sequence={scene2Sheet.sequence}
                    onSequencePass={() => {
                        setTaskBoardContent(prev => [...prev, taskBoardContentMap[1]]);
                    }}
                />

                <SingleLoadManager
                    loadPoint={22.5}
                    sequence={scene2Sheet.sequence}
                    onSequencePass={() => {
                        setTaskBoardContent(prev => [...prev, taskBoardContentMap[2]]);
                    }}
                />
                <SingleLoadManager
                    loadPoint={75}
                    sequence={scene2Sheet.sequence}
                    onSequencePass={() => {
                        setTaskBoardContent(prev => [...prev, taskBoardContentMap[5]]);
                    }}
                />

            </Suspense>

        </>
    )
}

export default SceneTwo;