import Galaxy from '../modelComponents/Galaxy';
import ShipOutside from '../modelComponents/ShipOutside';
import { Suspense, useState, useCallback, useEffect, useRef, useContext, useMemo } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, stageOfENV } from '../Settings';
import { scene6Project, scene6Sheet } from './SceneManager';
import AnyModel from '../modelComponents/AnyModel';
import { Environment } from '@react-three/drei';
import { types } from '@theatre/core';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import ViewPort from '../modelComponents/ViewPort';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useCameraSwitcher } from '../hooks/useCameraSwitcher';
import { TaskBoardContentContext } from '../sharedContexts/TaskBoardContentProvider';

function SceneSix({ startPoint, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const musicUrl = bucketURL + 'music/bgm6.mp3';
    const [outAmbientIntensity, setOutAmbientIntensity] = useState(1);
    const [backgroundColor, setBackgroundColor] = useState("black");

    const { messageApi } = useContext(GlobalNotificationContext);
    const { taskBoardContent, setTaskBoardContent } = useContext(TaskBoardContentContext);
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadEnv: true,
            internalEnv: true,
            spaceEnv: true,
            starOne: true,
            starRing: true,
            viewportStart: true,
            shipOutside: true,
            redLight: true,
            portside: true,
            chamberInside: true,
            shield: true,
            shipUpgrade: true,

        },
        initialComponents: {
            preloadEnv: false,
            internalEnv: true,
            spaceEnv: true,
            starOne: true,
            starRing: true,
            viewportStart: true,
            shipOutside: true,
            redLight: true,
            portside: false,
            chamberInside: true,
            shield: false,
            shipUpgrade: false,
        }
    });

    const { isFirstPersonCamera, switchCamera } = useCameraSwitcher({ isFirstPersonCameraForStart: true });

    const finishLoading = useCallback(() => {
        scene6Project.ready.then(() => {
            scene6Sheet.sequence.position = 0;
        });
    }, []);

    const [taskBoardContentMap, setTaskBoardContentMap] = useState({
        0: "Now click on the viewport to start the final plan.",
    });

    useEffect(() => {
        setTaskBoardContent(new Array(taskBoardContentMap[0]));
    }, []);

    useEffect(() => {
        scene6Sheet.sequence.attachAudio({ source: musicUrl });
    }, []);

    return (
        <>
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Now, the final moment!", "You are about to witness the transform of the ship", "With a short 3D movie but fully coded", "Which involve .Net, message queue(RabbitMQ), async programming...", "Anyway, you'll see."]} onFinished={() => { finishLoading(); }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={0} onSequencePass={() => { toggleComponentDisplay("chamberInside"); toggleComponentDisplay("starRing"); }} />

                <Galaxy />
                {showComponents.starOne && <AnyModel modelURL={"blackhole-transformed.glb"} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"starOne"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[100, 100, 100]} animationNames={["Take 001"]} animationAutoStart={true} unloadPoint={78} animationSpeeds={0.3} onSequencePass={() => { toggleComponentDisplay("starOne") }} />}
                {/* <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={0.1} onSequencePass={() => { toggleComponentDisplay("chamberInside"); toggleComponentDisplay("timsVideo"); }} />  */}

                {showComponents.shipOutside && <ShipOutside sequence={scene6Sheet.sequence} unloadPoint={87} onSequencePass={() => { toggleComponentDisplay("shipOutside") }} />}
                <e.mesh theatreKey='Outside ambient light' additionalProps={{
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
                    <ambientLight color={"#ffffff"} intensity={outAmbientIntensity} />
                    {showComponents.redLight && <ambientLight color={"#ff0000"} intensity={50} />}


                </e.mesh>
                {showComponents.preloadEnv && <>
                    <Environment
                        files={bucketURL + 'pic/space.exr'}
                        background={false}
                        intensity={3.5}
                        environmentIntensity={1}
                    /><Environment
                        files={bucketURL + 'pic/studio.hdr'}
                        resolution={4}
                        background={false}
                        intensity={3.5}
                        environmentIntensity={1}
                    /></>}
                {showComponents.internalEnv && <Environment
                    files={bucketURL + 'pic/studio.hdr'}
                    resolution={4}
                    background={false}
                    intensity={3.5}
                    environmentIntensity={1}
                />}
                {showComponents.spaceEnv && <>
                    <Environment
                        files={bucketURL + 'pic/space.exr'}
                        background={false}
                        intensity={3.5}
                        environmentIntensity={1}
                    /></>}

                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={isFirstPersonCamera} position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} />
                <PerspectiveCamera theatreKey="ThirdPersonCamera" makeDefault={!isFirstPersonCamera} position={[550, 50, -10]} rotation={[0, -Math.PI / 2, 0]} fov={75} near={0.01} />

                <color attach='background' args={[backgroundColor]} />




                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={1} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Hull temperature reach critical level!',
                        2,
                    );
                }} />
                {showComponents.viewportStart && <ViewPort screenTitle="ViewPort" position={[800, 133.75, -50]} rotation={[0, 1.6, 0]} sequence={scene6Sheet.sequence} stopPoint={84.3} unloadPoint={1} onSequencePass={() => { toggleComponentDisplay("viewportStart") }} />}

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={6.835} onSequencePass={() => { switchCamera(false) }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={26.3} onSequencePass={() => { switchCamera(true) }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={30} onSequencePass={() => {
                    messageApi(
                        'info',
                        'Project Dawn activated!',
                        2,
                    );
                }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={33.13} onSequencePass={() => { switchCamera(false) }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={36.37} onSequencePass={() => { switchCamera(true) }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={39.7} onSequencePass={() => { switchCamera(false); toggleComponentDisplay("shipOutside"); toggleComponentDisplay("redLight"); toggleComponentDisplay("portside"); toggleComponentDisplay("spaceEnv"); }} />

                {showComponents.portside && <AnyModel modelURL={"Corridor-transformed.glb"} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"portside"} position={[200, 35, -90]} rotation={[0, 0, 0]} scale={[10, 10, 10]} unloadPoint={78} onSequencePass={() => { toggleComponentDisplay("portside") }} />}

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={46.3} onSequencePass={() => { switchCamera(true); toggleComponentDisplay("chamberInside"); toggleComponentDisplay("portside"); }} />

                {showComponents.chamberInside && <AnyModel modelURL={'captains-chamber-transformed.glb'} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"captains-chamber-inside"} position={[150, 30, -60]} rotation={[0, -1.6, 0]} scale={[1, 1, 1]} />}
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={50} onSequencePass={() => {
                    messageApi(
                        'warning',
                        'Brace for impact!',
                        3,
                    );
                }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={56.1} onSequencePass={() => { switchCamera(false); toggleComponentDisplay("chamberInside"); toggleComponentDisplay("starOne"); toggleComponentDisplay("shipOutside"); toggleComponentDisplay("spaceEnv"); toggleComponentDisplay("redLight"); toggleComponentDisplay("starRing"); toggleComponentDisplay("shield") }} />
                {showComponents.starRing && <AnyModel modelURL={"strangest_star-transformed.glb"} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"starRing"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[30, 30, 30]} animationNames={["Animation"]} animationAutoStart={true} unloadPoint={78} animationSpeeds={0.3} onSequencePass={() => { toggleComponentDisplay("starRing") }} />}
                {showComponents.shield && <AnyModel modelURL={"shield-transformed.glb"} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"shield"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[2, 2, 2]} animationNames={["Take 01"]} animationAutoStart={true} unloadPoint={78} animationSpeeds={0.5} onSequencePass={() => { toggleComponentDisplay("shield") }} />}

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={59.4} onSequencePass={() => { switchCamera(true); }} />
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={60} onSequencePass={() => {
                    messageApi(
                        'info',
                        'The hull structure is undergoing reconfiguration and upgrade...',
                        5,
                    );
                }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={62.5} onSequencePass={() => { switchCamera(false); }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={64.1} onSequencePass={() => { toggleComponentDisplay("shipUpgrade"); }} />


                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={65.67} onSequencePass={() => { switchCamera(true); }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={69} onSequencePass={() => { switchCamera(false); toggleComponentDisplay("spaceEnv"); }} />

                {showComponents.shipUpgrade && <AnyModel modelURL={"ship-upgrade-transformed.glb"} sequence={scene6Sheet.sequence} useTheatre={true} theatreKey={"shipUpgrade"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[12, 12, 12]} unloadPoint={78} onSequencePass={() => { toggleComponentDisplay("shipUpgrade") }} />}
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={70} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Upgrade complete!',
                        3,
                    );
                }} />
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={72} onSequencePass={() => { switchCamera(true); toggleComponentDisplay("shipOutside"); }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={72} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Warp core activated!',
                        3,
                    );
                }} />

                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={75.3} onSequencePass={() => { switchCamera(false); toggleComponentDisplay("shield"); toggleComponentDisplay("starOne"); }} />
                <SingleLoadManager sequence={scene6Sheet.sequence} loadPoint={84.3} onSequencePass={() => {
                    messageApi(
                        'success',
                        'Thanks for watching! That\'s the end of the story! If you like it, please share it with your friends!',
                        10,
                    );
                }} />

            </Suspense>
        </>
    )
}

export default SceneSix;
