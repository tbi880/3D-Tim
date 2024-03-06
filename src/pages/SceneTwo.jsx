import { Canvas } from '@react-three/fiber';
import WaitingForMoreModels from './WaitingForMoreModels';
import StrangerStar from '../modelComponents/StrangerStar';
import ShipInside from '../modelComponents/ShipInside';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import InfoScreenDisplayStarShipInfoLoadManager from '../modelComponents/infoScreenDisplayStarShipInfoLoadManager';
import ViewPort from '../modelComponents/ViewPort';
import AsyncMusic, { createAudioLoader } from '../modelComponents/AsyncMusic';
import Robots from '../modelComponents/Robot';
import { Suspense, useState, useCallback } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera, SheetProvider } from '@theatre/r3f'
import { scene2Sheet } from "./SceneManager";
import { bucketURL } from '../Settings';


const audioResourceForScene2 = createAudioLoader(bucketURL + 'music/bgm2.mp3');


function SceneTwo() {
    const screenIntro = "You finally awaken, chief designer! Our ship is about to enter the strange red giant ahead of us. The ship is damaged quite severe due to the strong gravitational force. As AI, we cannot change the course of the ship because the first captain, Tim Bi, set it up millennia ago. Additionally, we have been blocked from answering the questions to unlock the captain's chamber. We need your help to find the answers to the root access questions so we can alter the ship's course or initiate an emergency stop. Please follow me to the bridge. Let's start by checking the structure of the ship first. This will probably help you to rewind your memory about the ship.";

    // const screenStarShipInfo = "This starship, laden with humanity's hopes, pioneers space exploration with true self-learning, multi-purpose AI robots. Each AI holds a unique role: service AIs cater to the needs of all on board, maintenance AIs ensure the ship's upkeep, and research AIs delve into cutting-edge theories, transforming them into technologies that not only prevent the ship from deteriorating over its millennia-long journey but also significantly enhance its capabilities through expansions and upgrades. This visionary approach originated from the ship's first captain,whose name is Tim Bi(2001-21??), a renowned computer scientist on Earth whose early life remains largely unknown. His obscure past forms the basis of the root access questions for the ship's control system, without which altering the ship's course or initiating emergency stops is impossible. As the ship's chief engineer, it falls to you to unearth these ancient records to avert a catastrophic fate from powerful gravitational forces."
    // 使用一个对象来管理多个组件的初始显示状态
    const [showComponents, setShowComponents] = useState({
        shipInside: true,
        textTitle20minsAgo: true,
        robotIntro: true,
        viewPortIntro: true,
        screenIntro: true,

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
                <AsyncMusic audioResource={audioResourceForScene2} sequence={scene2Sheet.sequence} startPoint={0} lowVolumePoints={[1]} highVolumePoints={[3]} maxVolume={0.75} />
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[498, -19, -61]} rotation={[0, 1.55, 0]} fov={75} near={0.01} />
                <ambientLight />
                <ambientLight />
                <color attach='background' args={['black']} />

                <ambientLight />

                <Galaxy />
                <StrangerStar />

                <ShipInside sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('shipInside')} />
                {showComponents.textTitle20minsAgo && <TextTitle text="20 mins ago, inside the ship" color="#FFFFFF" size={1} sequence={scene2Sheet.sequence} unloadPoint={1} onSequencePass={() => toggleComponentDisplay('textTitle20minsAgo')} />}
                {showComponents.viewPortIntro && <ViewPort screenTitle="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} stopPoint={1} unloadPoint={1} onSequencePass={() => toggleComponentDisplay('viewPortIntro')} />}
                {showComponents.robotIntro && <Robots title="Intro" position={[613, -15.5, -106]} rotation={[0, 0, 0]} sequence={scene2Sheet.sequence} onSequencePass={() => toggleComponentDisplay('robotIntro')} />}
                {showComponents.screenIntro && <InfoScreenDisplay title="Conversation" content={screenIntro} sequence={scene2Sheet.sequence} stopPoints={[1.5, 2, 2.5, 22.5]} loadPoints={[0, 1, 1.5, 2]} unloadPoints={[2, 2.5, 3, 3.5]} onSequencePass={() => toggleComponentDisplay("screenIntro")} />}

                {/* <ShipOutside sequence={scene1Sheet.sequence} onSequencePass={() => toggleComponentDisplay('shipOutside')} />
                {showComponents.infoScreenWelcome && (<InfoScreenDisplay title="Welcome" content={screenWelcomeContent} sequence={scene1Sheet.sequence} stopPoints={[0.034, 27.5]} loadPoints={[0, 0.033]} unloadPoints={[0.034, 2.5]} onSequencePass={() => toggleComponentDisplay('infoScreenWelcome')} />)}


                {showComponents.textTitleAD32101 && (<TextTitle text="AD 32101" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={5} onSequencePass={() => toggleComponentDisplay('textTitleAD32101')} />)}
                {showComponents.textTitleOuterArm && (<TextTitle text="Outer arm of the galaxy" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={9} onSequencePass={() => toggleComponentDisplay('textTitleOuterArm')} />)}
                {showComponents.textTitleApproximately && (<TextTitle text="Approximately 18,000 light years from Earth" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={15} onSequencePass={() => toggleComponentDisplay('textTitleApproximately')} />)}

                {showComponents.viewPortStarShipInfo && (<ViewPort screenTitle={"StarShip Info"} position={[745, -16, 38]} rotation={[-1.13, -0.654, 5.2]} sequence={scene1Sheet.sequence} stopPoint={30} unloadPoint={37} onSequencePass={() => toggleComponentDisplay('viewPortStarShipInfo')} />)}
                <InfoScreenDisplayStarShipInfoLoadManager sequence={scene1Sheet.sequence} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />
                {showComponents.infoScreenDisplayStarShipInfo && (<InfoScreenDisplay title={"Starship Info"} content={screenStarShipInfo} sequence={scene1Sheet.sequence} stopPoints={[30.5, 31, 31.5, 32, 32.5, 39]} loadPoints={[29.5, 30.5, 31, 31.5, 32, 32.5]} unloadPoints={[30.5, 31, 31.5, 32, 32.5, 37]} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />)} */}
            </Suspense>

            {/* 
                </SheetProvider>



            </Canvas > */}
        </>
    )
}

export default SceneTwo;