import { shipHangerAccess } from './Status';
import Technology from '../modelComponents/technology';
import Tunnel from '../modelComponents/Tunnel';
import Iphone14pro from '../modelComponents/Iphone14pro';
import ProgrammingOffice from '../modelComponents/ProgrammingOffice';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import ProgrammingHome from '../modelComponents/ProgrammingHome';
import ViewPort from '../modelComponents/ViewPort';
import ProgrammingFuture from '../modelComponents/ProgrammingFuture';
import StreamMusic from '../modelComponents/StreamMusic';
import Auckland from '../modelComponents/Auckland';
import { Suspense, useState, useCallback, useEffect, useContext, useRef } from 'react';
import PreloadAssets from '../modelComponents/preloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { scene3Sheet } from "./SceneManager";
import { bucketURL, stageOfENV } from '../Settings';
import Loading from '../modelComponents/Loading';
import { types } from '@theatre/core';
import { scene3Project } from './SceneManager';
import { useFrame } from '@react-three/fiber';
import Loader from './Loader';
import { canvasContext } from '../sharedContexts/CanvasProvider';
import { XrToolsContext } from '../sharedContexts/XrToolsProvider';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';


function SceneThree({ startPoint, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);
    const [player, setPlayer] = useState(null);
    const [isPresenting, setIsPresenting] = useState(false);
    const { xrPlayer, xrIsPresenting } = isVRSupported && useContext(XrToolsContext) ? useContext(XrToolsContext) : {};
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            lightings: true,
            pointlight: true,
            viewPort_start: true,
            programmingHome: true,
            textTitle_12yearsOldTim: true,
            textTitle_mumsAsleep: true,
            textTitle_15yearsOldTim: true,
            programmingOffice: true,
            textTitle_18yearsOldTim: true,
            viewport_iphone: true,
            auckland: true,
            year2022: true,
            year2023: true,
            year2024: true,
            tunnel: true,
            galaxy: true,
            programmingFuture: true,
            techs: true,
            year2099: true,
            resumeScreen: true,
            loading: true,
        },
        initialComponents: {
            preloadAssets: false,
            lightings: true,
            pointlight: false,
            viewPort_start: true,
            programmingHome: true,
            textTitle_12yearsOldTim: true,
            textTitle_mumsAsleep: true,
            textTitle_15yearsOldTim: false,
            programmingOffice: true,
            textTitle_18yearsOldTim: false,
            viewport_iphone: false,
            auckland: true,
            year2022: false,
            year2023: false,
            year2024: false,
            tunnel: false,
            galaxy: false,
            programmingFuture: false,
            techs: false,
            year2099: false,
            resumeScreen: false,
            loading: false,
        }
    });

    useEffect(() => {
        setPlayer(xrPlayer);
        setIsPresenting(xrIsPresenting);
    }, [xrPlayer, xrIsPresenting]);
    const [VRCordinate, setVRCordinate] = useState({ // mapped by sequence position to coordinates
        0: [0, 0, 0],
        20: [0.1, -0.4, -4.25],
        32: [105, 75, -1100],
        42: [0.18, -1.25, -0.2]
    });
    const VRCordinateKeysArray = Object.keys(VRCordinate);
    const [currentVRCordinate, setCurrentVRCordinate] = useState(0);
    const musicUrl = bucketURL + 'music/bgm3.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(5);
    // const [pointIntensity, setPointIntensity] = useState(5);
    const [spotIntensity, setSpotIntensity] = useState(5);
    const [rectAreaIntensity, setRectAreaIntensity] = useState(5);
    const [backgroundColor, setBackgroundColor] = useState("black"); // 状态管理背景颜色
    const resumeString = "I embarked on my tech journey at the age of 15, contributing to four commercial projects since then. During my previous work, I encompassed practical skills from developing applications and websites to manage my own server. In addition, my experience as a stage performing keyboardist has sharpened my teamwork skills and stress handling. I am a diligent professional with extensive experience in the field of software engineering, who likes details and always looks for runtime optimizations. I am currently seeking a junior / intermediate level opportunity to further develop my skills.";
    const audioElement = useAudioElement(musicUrl);


    useEffect(() => {
        // 设置定时器，每秒执行一次
        const checkForUnload = setInterval(() => {
            if (scene3Sheet.sequence && scene3Sheet.sequence.position === unloadPoint) {
                onSequencePass();
            }
        }, 2000); // 1000毫秒 = 1秒

        // 清理函数：组件卸载时执行，用于清理定时器
        return () => clearInterval(checkForUnload);
    }, [unloadPoint]); // 依赖项数组，当这些依赖变化时重新设置定时器



    useEffect(() => {
        scene3Project.ready.then(() => {
            scene3Sheet.sequence.position = 0;
        });
    }, []);

    useEffect(() => {
        if (player) {
            player.position.set(0, 0, 0);
        }
    }, []);



    useFrame(() => {
        if (isVRSupported) {
            if (isPresenting) {
                const nextSwitchPointIndex = ((VRCordinateKeysArray.indexOf(String(currentVRCordinate))) < (VRCordinateKeysArray.length - 1)) ? VRCordinateKeysArray.indexOf(String(currentVRCordinate)) + 1 : VRCordinateKeysArray.indexOf(String(currentVRCordinate));
                const nextSwitchPoint = Number(VRCordinateKeysArray[nextSwitchPointIndex]);
                if (scene3Sheet.sequence.position >= nextSwitchPoint) {
                    setCurrentVRCordinate(nextSwitchPoint);
                }
                if (player) {
                    player.position.set(VRCordinate[currentVRCordinate][0], VRCordinate[currentVRCordinate][1], VRCordinate[currentVRCordinate][2]);
                }
            } else {
                if (player) {
                    player.position.set(0, 0, 0);
                }
            }
        }
    }
    );

    return (
        <>
            {/* <Canvas gl={{ preserveDrawingBuffer: true }} >
                <SheetProvider sheet={scene1Sheet}> */}
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Now you'll see some of my stories during my tech journey", "You can click on the viewport after the loading is finished", "You will be ported back to the previous page to see the other options after viewing this", "or you can download my resume as PDF"]} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}

                {showComponents.preloadAssets && <PreloadAssets />}

                {audioElement && <StreamMusic audioElement={audioElement} sequence={scene3Sheet.sequence} startPoint={1} maxVolume={1} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={0.1} onSequencePass={() => { toggleComponentDisplay("auckland"); toggleComponentDisplay("programmingOffice"); }} />
                {/* <AsyncMusic audioBuffer={audioBuffer} sequence={scene3Sheet.sequence} startPoint={0.02} lowVolumePoints={[31, 50]} highVolumePoints={[32, 52]} maxVolume={0.75} /> */}
                {showComponents.viewPort_start && <ViewPort screenTitle={"start"} position={[-3.3, 1.82, -4.88]} rotation={[0, 0, 0]} stopPoint={30} sequence={scene3Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("viewPort_start") }} unloadPoint={1} isSetNextScene={false} />}
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[0, 0, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />
                <color attach='background' args={[backgroundColor]} />
                {showComponents.programmingHome && <ProgrammingHome position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={21} onSequencePass={() => { toggleComponentDisplay("programmingHome") }} />}

                <e.mesh theatreKey='ambient light' additionalProps={{
                    intensity: types.number(ambientIntensity, {
                        range: [0, 10],
                    }),
                }}
                    objRef={(theatreObject) => {
                        // 监听Theatre.js中透明度的变化
                        theatreObject.onValuesChange((newValues) => {
                            setAmbientIntensity(newValues.intensity);
                        });
                    }} >
                    <ambientLight color="white" intensity={ambientIntensity} />
                </e.mesh>
                {/* <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={11} onSequencePass={() => { toggleComponentDisplay("pointlight") }} />
                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={21} onSequencePass={() => { toggleComponentDisplay("pointlight") }} />
                {showComponents.pointlight && <>
                    <e.mesh theatreKey='point light' additionalProps={{
                        intensity: types.number(pointIntensity, {
                            range: [0, 100],
                        }),
                    }}
                        objRef={(theatreObject) => {
                            // 监听Theatre.js中透明度的变化
                            theatreObject.onValuesChange((newValues) => {
                                setPointIntensity(newValues.intensity);
                            });
                        }}>
                        <pointLight color="white" intensity={pointIntensity} />
                    </e.mesh> </>} */}
                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={15} onSequencePass={() => { toggleComponentDisplay("lightings") }} />
                {showComponents.lightings && <>
                    <e.mesh theatreKey='spot light' additionalProps={{
                        intensity: types.number(spotIntensity, {
                            range: [0, 10],
                        }),
                    }}
                        objRef={(theatreObject) => {
                            // 监听Theatre.js中透明度的变化
                            theatreObject.onValuesChange((newValues) => {
                                setSpotIntensity(newValues.intensity);
                            });
                        }}>
                        <spotLight position={[0, 0, 0]} intensity={spotIntensity} />
                    </e.mesh>
                    <e.mesh theatreKey='rectArea light' additionalProps={{
                        intensity: types.number(rectAreaIntensity, {
                            range: [0, 10],
                        }),
                    }}
                        objRef={(theatreObject) => {

                            theatreObject.onValuesChange((newValues) => {
                                setRectAreaIntensity(newValues.intensity);
                            });
                        }}>
                        <rectAreaLight width={5} height={0.5} intensity={rectAreaIntensity} />
                    </e.mesh>
                </>}
                {showComponents.textTitle_mumsAsleep && <TextTitle text="Mum's finally asleep. It's time for some PVZ, LOL and EVE online." color="#000000" size={0.15} position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={12} onSequencePass={() => { toggleComponentDisplay("textTitle_mumsAsleep"); setBackgroundColor("white"); }} />}
                {showComponents.textTitle_12yearsOldTim && <TextTitle text="12 years old Tim:" color="#000000" size={0.15} position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={5.5} onSequencePass={() => { toggleComponentDisplay("textTitle_12yearsOldTim") }} />}
                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={12} onSequencePass={() => { toggleComponentDisplay("textTitle_15yearsOldTim") }} />
                {showComponents.textTitle_15yearsOldTim && <TextTitle text="15 years old tim: gonna make some cool things in visual basic." color="#000000" size={0.15} position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={20} onSequencePass={() => { toggleComponentDisplay("textTitle_15yearsOldTim") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={18} onSequencePass={() => { toggleComponentDisplay("programmingOffice") }} />
                {showComponents.programmingOffice && <><ProgrammingOffice position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={31.75} onSequencePass={() => { toggleComponentDisplay("programmingOffice") }} /></>}
                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={20} onSequencePass={() => { toggleComponentDisplay("textTitle_18yearsOldTim") }} />
                {showComponents.textTitle_18yearsOldTim && <TextTitle text="18 years old tim during covid19: I am so happy to join this company as a paid intern after 3 rounds of competing with graduates." color="#000000" size={0.15} position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={30} onSequencePass={() => { toggleComponentDisplay("textTitle_18yearsOldTim") }} />}

                {showComponents.programmingOffice && <Iphone14pro title={"email"} clickablePoint={31} sequence={scene3Sheet.sequence} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={29} onSequencePass={() => { toggleComponentDisplay("viewport_iphone") }} />
                {showComponents.viewport_iphone && <ViewPort screenTitle={"iphone"} position={[0.11, 0.8, -4.88]} rotation={[0, 0, 0]} stopPoint={31} sequence={scene3Sheet.sequence} unloadPoint={30.75} onSequencePass={() => { toggleComponentDisplay("viewport_iphone") }} isSetNextScene={true} nextScene={"sceneTwo"} nextSceneStartPoint={22} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={31.5} onSequencePass={() => { toggleComponentDisplay("auckland") }} />
                {showComponents.auckland && <Auckland sequence={scene3Sheet.sequence} unloadPoint={39.75} onSequencePass={() => { toggleComponentDisplay("auckland") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={32} onSequencePass={() => { toggleComponentDisplay("year2022") }} />
                {showComponents.year2022 && <TextTitle text="2022" color="#000000" size={1} position={[0, 0, 0]} rotation={[0, 0.32, 0]} sequence={scene3Sheet.sequence} unloadPoint={34} onSequencePass={() => { toggleComponentDisplay("year2022") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={34} onSequencePass={() => { toggleComponentDisplay("year2023") }} />
                {showComponents.year2023 && <TextTitle text="2023" color="#000000" size={1} position={[750, 200, -1300]} rotation={[0, 1.57, 0]} sequence={scene3Sheet.sequence} unloadPoint={36} onSequencePass={() => { toggleComponentDisplay("year2023") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={36} onSequencePass={() => { toggleComponentDisplay("year2024") }} />
                {showComponents.year2024 && <TextTitle text="2024" color="#000000" size={1} position={[-150, 167, -2000]} rotation={[0, 3.14, 0]} sequence={scene3Sheet.sequence} unloadPoint={39} onSequencePass={() => { toggleComponentDisplay("year2024") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={38} onSequencePass={() => { toggleComponentDisplay("tunnel") }} />
                {showComponents.tunnel && <Tunnel unloadPoint={42.75} sequence={scene3Sheet.sequence} onSequencePass={() => { toggleComponentDisplay("tunnel") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={41} onSequencePass={() => { toggleComponentDisplay("galaxy"); setBackgroundColor("black"); shipHangerAccess(); }} />
                {showComponents.galaxy && <Galaxy />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={43} onSequencePass={() => { toggleComponentDisplay("programmingFuture") }} />
                {showComponents.programmingFuture && <ProgrammingFuture />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={45} onSequencePass={() => { toggleComponentDisplay("year2099") }} />
                {showComponents.year2099 && <TextTitle text="2099" color="#FFFFFF" size={0.1} position={[0, 0, 0]} rotation={[0, 3.14, 0]} sequence={scene3Sheet.sequence} unloadPoint={47} onSequencePass={() => { toggleComponentDisplay("year2099") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={48.5} onSequencePass={() => { toggleComponentDisplay("resumeScreen") }} />
                {showComponents.resumeScreen && <InfoScreenDisplay title={"Resume2024"} content={resumeString} sequence={scene3Sheet.sequence} loadPoints={isPortraitPhoneScreen ? [49.5, 50.5, 51, 51.5] : [49.5, 50, 50.5, 51]} stopPoints={[50.5, 51, 51.5, 64]} unloadPoints={[50.5, 51, 51.5, 52]} onSequencePass={() => { toggleComponentDisplay("resumeScreen") }} />}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={52} onSequencePass={() => { toggleComponentDisplay("techs") }} />
                {showComponents.techs && <>
                    <Technology title={"react"} imagePath={bucketURL + "tech/reactjs.png"} />
                    <Technology title={"nodejs"} imagePath={bucketURL + "tech/nodejs.png"} />
                    <Technology title={"docker"} imagePath={bucketURL + "tech/docker.png"} />
                    <Technology title={"python"} imagePath={bucketURL + "tech/python.png"} />
                    <Technology title={"dotnet"} imagePath={bucketURL + "tech/NET core.png"} />
                    <Technology title={"sqlserver"} imagePath={bucketURL + "tech/sqlserver.png"} /> </>}

                <SingleLoadManager sequence={scene3Sheet.sequence} loadPoint={62} onSequencePass={() => { toggleComponentDisplay("loading") }} />
                {showComponents.loading && <Loading title="loading" lines={["Disconnected", "from Tim's", "namespace"]} position={[0, 0, 0]} rotation={[0, 0, 0]} sequence={scene3Sheet.sequence} unloadPoint={66} onSequencePass={() => { toggleComponentDisplay("loading") }} />}

            </Suspense>
        </>
    )
}

export default SceneThree;