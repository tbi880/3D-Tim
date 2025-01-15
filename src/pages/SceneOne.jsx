import { useFrame } from '@react-three/fiber';
import Loader from './Loader';
import StrangerStar from '../modelComponents/StrangerStar';
import ShipOutside from '../modelComponents/ShipOutside';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import TextTitle_v2 from '../modelComponents/TextTitle_v2';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import ViewPort from '../modelComponents/ViewPort';
// import AsyncMusic, { createAudioLoader } from '../modelComponents/AsyncMusic';
import { Suspense, useState, useEffect, useContext } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL } from '../Settings';
import StreamMusic from '../modelComponents/StreamMusic';
import { Environment, useGLTF } from '@react-three/drei';
import { canvasContext } from '../sharedContexts/CanvasProvider';
import { XrToolsContext } from '../sharedContexts/XrToolsProvider';
import XrSqueezeEventListener from '../Tools/XrSqueezeEventListener';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';
import { useCameraSwitcher } from '../hooks/useCameraSwitcher';
import AnyModel from '../modelComponents/AnyModel';


function SceneOne({ scene1Sheet, scene1Project, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);
    const [player, setPlayer] = useState(null);
    const [isPresenting, setIsPresenting] = useState(false);
    const { xrPlayer, xrIsPresenting } = isVRSupported && useContext(XrToolsContext) ? useContext(XrToolsContext) : {};
    useEffect(() => {
        setPlayer(xrPlayer);
        setIsPresenting(xrIsPresenting);
    }, [xrPlayer, xrIsPresenting]);

    const [VRCordinate, setVRCordinate] = useState({
        0: [600, 19, -61],
        1: [0, 20, -61],
        2: [750, -19, -45],
        3: [750, -19, -40],
        4: [750, -19, -35],
    });
    const [currentVRCordinate, setCurrentVRCordinate] = useState(0);
    const musicUrl = bucketURL + 'music/bgm1.mp3';
    const [year, setYear] = useState(new Date().getFullYear());
    const [month, setMonth] = useState(new Date().getMonth());
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    const monthName = monthNames[month];
    const audioElement = useAudioElement(musicUrl);

    const screenWelcomeContent = "You are about to awaken on a starship that has been voyaging for centuries. The course has been mysteriously affected by an external force. Please click on the 'Next' button down below(>>>).        Good! Now you have a basic idea of how to use this 3D website. Please enjoy the trip. Hopefully, we can see each other face to face in AD " + year + " " + monthName + " in NZ on earth!";

    const screenStarShipInfo = "This starship, laden with humanity's hopes, pioneers space exploration with true self-learning, multi-purpose AI robots. Each AI holds a unique role: service AIs cater to the needs of all on board, maintenance AIs ensure the ship's upkeep, and research AIs delve into cutting-edge theories, transforming them into technologies that not only prevent the ship from deteriorating over its millennia-long journey but also significantly enhance its capabilities through expansions and upgrades. This visionary approach originated from the ship's first captain,whose name is Tim Bi(2001-21??), a renowned computer scientist on Earth whose early life remains largely unknown. His obscure past forms the basis of the root access questions for the ship's control system, without which altering the ship's course or initiating emergency stops is impossible. As the ship's chief engineer, it falls to you to unearth these ancient records to avert a catastrophic fate from powerful gravitational forces."
    // 使用一个对象来管理多个组件的初始显示状态

    const { isFirstPersonCamera, switchCamera } = useCameraSwitcher({ isFirstPersonCameraForStart: true });

    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            textTitleAD32101: true,
            textTitleOuterArm: true,
            textTitleApproximately: true,
            infoScreenWelcome: true,
            shipOutside: true,
            viewPortStarShipInfo: true,
            infoScreenDisplayStarShipInfo: false,
            textTitleVRVIEWPORT: true,
            warping: true,

        }, initialComponents: {
            preloadAssets: false,
            textTitleAD32101: true,
            textTitleOuterArm: true,
            textTitleApproximately: true,
            infoScreenWelcome: true,
            shipOutside: true,
            viewPortStarShipInfo: true,
            infoScreenDisplayStarShipInfo: false,
            textTitleVRVIEWPORT: true,
            warping: false,
        }
    });


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



    useEffect(() => {
        useGLTF.preload(bucketURL + "arrow-transformed.glb");
        useGLTF.preload(bucketURL + "galaxy.glb");
        useGLTF.preload(bucketURL + "sci-fi-screen-transformed.glb");
    }, []);


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


    return (
        <>

            <Suspense fallback={<Loader />}>
                {showComponents.preloadAssets && <PreloadAssets />}

                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene1Sheet.sequence} startPoint={1} />}
                {isVRSupported && <XrSqueezeEventListener onLeftSqueeze={handleLeftSqueeze} onRightSqueeze={handleRightSqueeze} />}

                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={isFirstPersonCamera} position={[600, 20, -61]} rotation={[0, 0.33, 0]} fov={75} near={0.01} />
                <SingleLoadManager loadPoint={23} sequence={scene1Sheet.sequence} onSequencePass={() => { switchCamera(false); }} />
                <PerspectiveCamera theatreKey="ThirdPersonCamera" makeDefault={!isFirstPersonCamera} position={[908, -18, -40]} rotation={[0, -Math.PI / 2, 0]} fov={75} near={0.01} />
                <SingleLoadManager loadPoint={22.2} sequence={scene1Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("warping"); }} />

                {showComponents.warping && <AnyModel modelURL={'FTL travelling.glb'} sequence={scene1Sheet.sequence} useTheatre={true} theatreKey={"FTL travelling"} position={[900, -19, -40]} rotation={[0, -1.6, 0]} scale={[10, 10, 100]} animationNames={["Animation"]} animationOnClick={false} animationPlayTimes={1} animationSpeeds={2} animationStartPoint={0} unloadPoint={116} onSequencePass={() => { toggleComponentDisplay("warping") }} visible={!isFirstPersonCamera} />}
                <SingleLoadManager loadPoint={26} sequence={scene1Sheet.sequence} onSequencePass={() => { switchCamera(true); toggleComponentDisplay("warping"); }} />

                <ambientLight intensity={5} />

                <color attach='background' args={['black']} />

                <Galaxy />
                <StrangerStar />
                <Environment
                    files={bucketURL + 'pic/space.exr'}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />
                <ShipOutside sequence={scene1Sheet.sequence} onSequencePass={() => toggleComponentDisplay('shipOutside')} />

                {isVRSupported && isPresenting && <TextTitle_v2 theatreKey={"_VR_WELCOME"} text="Try to squeeze one of your controller" color="#FFFFFF" size={1} sequence={scene1Sheet.sequence} position={[580, 25, -75]} rotation={[0, 0.33, 0]} />}


                {showComponents.infoScreenWelcome && (<InfoScreenDisplay title="Welcome" content={screenWelcomeContent} sequence={scene1Sheet.sequence} stopPoints={[0.034, 27.5]} loadPoints={[0, 0.033]} unloadPoints={[0.034, 2.5]} onSequencePass={() => toggleComponentDisplay('infoScreenWelcome')} />)}

                {showComponents.textTitleAD32101 && (<TextTitle text="AD 32101" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={5} onSequencePass={() => toggleComponentDisplay('textTitleAD32101')} />)}
                {showComponents.textTitleOuterArm && (<TextTitle text="Outer arm of the galaxy" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={9} onSequencePass={() => toggleComponentDisplay('textTitleOuterArm')} />)}
                {showComponents.textTitleApproximately && (<TextTitle text="Approximately 18,000 light years from Earth" color="#FFD700" size={1} sequence={scene1Sheet.sequence} unloadPoint={15} onSequencePass={() => toggleComponentDisplay('textTitleApproximately')} />)}

                {isVRSupported && isPresenting && showComponents.textTitleVRVIEWPORT && <TextTitle_v2 theatreKey={"_VR_VIEWPORT"} text="Come back here again when you see the VIEWPORT" color="#FFFFFF" size={1} sequence={scene1Sheet.sequence} unloadPoint={25} position={[725, -19, -60]} onSequencePass={() => toggleComponentDisplay('textTitleVRVIEWPORT')} />}

                {showComponents.viewPortStarShipInfo && (<ViewPort screenTitle={"StarShip Info"} position={[745, -16, 38]} rotation={[-1.13, -0.654, 5.2]} sequence={scene1Sheet.sequence} stopPoint={30} unloadPoint={37} onSequencePass={() => toggleComponentDisplay('viewPortStarShipInfo')} isSetNextScene={true} nextScene={"sceneTwo"} />)}
                <SingleLoadManager loadPoint={29.5} sequence={scene1Sheet.sequence} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />
                {showComponents.infoScreenDisplayStarShipInfo && (<InfoScreenDisplay title={"Starship Info"} content={screenStarShipInfo} sequence={scene1Sheet.sequence} stopPoints={[30.5, 31, 31.5, 32, 32.5, 39]} loadPoints={[29.5, 30.5, 31, 31.5, 32, 32.5]} unloadPoints={[30.5, 31, 31.5, 32, 32.5, 37]} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />)}
                <SingleLoadManager loadPoint={unloadPoint} sequence={scene1Sheet.sequence} onSequencePass={onSequencePass} />
            </Suspense>

        </>
    )
}

export default SceneOne;