import { getEngineeringHasBeenAccessed, getRootAccess, getShipHangerHasBeenAccessed } from './Status';
import WaitingForMoreModels from './WaitingForMoreModels';
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
import { Suspense, useState, useCallback, useEffect } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { scene2Sheet, scene2Project } from "./SceneManager";
import { bucketURL } from '../Settings';
import Loading from '../modelComponents/Loading';
import { Environment, useGLTF } from '@react-three/drei';


// const audioResourceForScene2 = createAudioLoader(bucketURL + 'music/bgm2.mp3');


function SceneTwo_mobile({ startPoint, unloadPoints, onSequencePass }) {
    const screenIntro = "You finally awaken, chief designer! Our ship is about to enter the strange red giant ahead of us. The ship is damaged quite severe due to the strong gravitational force. As AI, we cannot change the course of the ship because the first captain, Tim Bi, set it up millennia ago. Additionally, we have been blocked from answering the questions to unlock the captain's chamber. We need your help to find the answers to the root access questions so we can alter the ship's course or initiate an emergency stop. Please follow me to the bridge. Let's start by checking the structure of the ship first. This will probably help you to rewind your memory about the ship.";
    const musicUrl = bucketURL + 'music/bgm2.mp3';

    useEffect(() => {
        useGLTF.preload(bucketURL + 'loading.glb');

        scene2Project.ready.then(() => {
            if (startPoint && startPoint != 0) {
                scene2Sheet.sequence.play({ range: [startPoint, startPoint + 0.5] });
            }
        });
    }, []);

    useEffect(() => {
        // 设置定时器，每秒执行一次
        const checkForUnload = setInterval(() => {
            if (unloadPoints) {
                for (let i = 0; i < unloadPoints.length; i++) {
                    if (scene2Sheet.sequence && scene2Sheet.sequence.position === unloadPoints[i]) {
                        onSequencePass();
                    }
                }
            }
        }, 2000); // 1000毫秒 = 1秒

        // 清理函数：组件卸载时执行，用于清理定时器
        return () => clearInterval(checkForUnload);
    }, [unloadPoints]); // 依赖项数组，当这些依赖变化时重新设置定时器

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

    // const screenStarShipInfo = "This starship, laden with humanity's hopes, pioneers space exploration with true self-learning, multi-purpose AI robots. Each AI holds a unique role: service AIs cater to the needs of all on board, maintenance AIs ensure the ship's upkeep, and research AIs delve into cutting-edge theories, transforming them into technologies that not only prevent the ship from deteriorating over its millennia-long journey but also significantly enhance its capabilities through expansions and upgrades. This visionary approach originated from the ship's first captain,whose name is Tim Bi(2001-21??), a renowned computer scientist on Earth whose early life remains largely unknown. His obscure past forms the basis of the root access questions for the ship's control system, without which altering the ship's course or initiating emergency stops is impossible. As the ship's chief engineer, it falls to you to unearth these ancient records to avert a catastrophic fate from powerful gravitational forces."
    // 使用一个对象来管理多个组件的初始显示状态
    const [showComponents, setShowComponents] = useState({
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
    });

    // 创建一个通用的切换函数
    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));

    }, []);




    return (
        <>
            {/* <Canvas gl={{ preserveDrawingBuffer: true }} >
                <SheetProvider sheet={scene1Sheet}> */}


            <PreloadAssets />
            <Suspense fallback={<WaitingForMoreModels />}>

                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene2Sheet.sequence} startPoint={0.5} lowVolumePoints={[1]} highVolumePoints={[3]} maxVolume={0.75} />}
                {/* <AsyncMusic audioBuffer={audioBuffer} sequence={scene2Sheet.sequence} startPoint={0.5} lowVolumePoints={[1]} highVolumePoints={[3]} maxVolume={0.75} /> */}
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[498, -19, -61]} rotation={[0, 1.55, 0]} fov={75} near={0.01} />

                <color attach='background' args={['black']} />

                {/* <ambientLight intensity={3} /> */}

                <Galaxy />
                <StrangerStar />

                <Environment
                    preset="warehouse"
                    resolution={1}
                    intensity={2}
                    backgroundIntensity={0}
                    environmentIntensity={0}
                />
                <ShipInside sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('shipInside')} />
                {showComponents.viewPortIntro && <ViewPort screenTitle="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} stopPoint={1} unloadPoint={1} onSequencePass={() => toggleComponentDisplay('viewPortIntro')} />}
                {showComponents.robotIntro && <Robots title="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('robotIntro')} />}
                {showComponents.screenIntro && <InfoScreenDisplay title="Conversation" content={screenIntro} sequence={scene2Sheet.sequence} stopPoints={[1.5, 2, 2.5, 22.5]} loadPoints={[0, 1, 1.5, 2]} unloadPoints={[2, 2.5, 3, 3.5]} onSequencePass={() => toggleComponentDisplay("screenIntro")} />}

                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('textTitleGetROOTACCESS')} />
                {showComponents.textTitleGetROOTACCESS && <TextTitle text="Where to get the ROOT ACCESS?" color="#99CCFF" size={1} sequence={scene2Sheet.sequence} unloadPoint={24} onSequencePass={() => toggleComponentDisplay('textTitleGetROOTACCESS')} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOShipHangar')} />
                {showComponents.buttonForGOTOShipHangar && !(getShipHangerHasBeenAccessed()) && <Button title={"To the ship hanger"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} jumpToPoint={22.5} stopPoint={33} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOShipHangar')} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOEngineering')} />
                {showComponents.buttonForGOTOEngineering && !(getEngineeringHasBeenAccessed()) && <Button title={"To the engineering"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} IsPreJump={true} jumpToPoint={39} stopPoint={68} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOEngineering')} />}
                <SingleLoadManager loadPoint={22} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOCaptainsChamber')} />
                {showComponents.buttonForGOTOCaptainsChamber && <Button title={"To Tim's chamber"} position={[490, -23.5, -60]} rotation={[0, 0, 0]} clickablePoint={22.5} IsPreJump={true} jumpToPoint={73.5} stopPoint={86} unloadPoint={24} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('buttonForGOTOCaptainsChamber')} alertAndNoPlay={!getRootAccess()} alertMessage={"You are not authorized to go there! Please check the access level or answer the ROOT ACCESS questions."} />}


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

            </Suspense>

        </>
    )
}

export default SceneTwo_mobile;