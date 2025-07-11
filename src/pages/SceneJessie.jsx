import AnyModel from '../modelComponents/AnyModel';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import { Suspense, useState, useCallback, useEffect, useContext } from 'react';
import TextTitle from '../modelComponents/TextTitle';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, webGLPreserveDrawingBuffer } from '../Settings';
import { SheetProvider } from '@theatre/r3f';
import { Canvas } from '@react-three/fiber';
import { getProject, types } from '@theatre/core';
import sceneJessieState from '../SceneJessie.json';
import StreamMusic from '../modelComponents/StreamMusic';
import ViewPort from '../modelComponents/ViewPort';
import Fireworks from '../modelComponents/Fireworks';
import TextTitle_v2 from '../modelComponents/TextTitle_v2';
import WaitingJessie from './WaitingJessie';
import PreloadAssets from '../modelComponents/PreloadAssets';
import { useGLTF } from '@react-three/drei';
import { Helmet } from 'react-helmet';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';


function SceneJessie({ startPoint }) {
    const sceneJessieProject = getProject('SceneJessie', { state: sceneJessieState });
    const sceneJessieSheet = sceneJessieProject.sheet('SceneJessie');
    const musicUrl = bucketURL + 'music/bgm_jessie.mp3';
    const [ambientIntensity, setAmbientIntensity] = useState(5);
    const [spotIntensity, setSpotIntensity] = useState(5);
    const [backgroundColor, setBackgroundColor] = useState("black");
    const age = (new Date().getFullYear().valueOf()) - 2001;
    const endingString1 = age + "岁生日快乐呀！";
    const endingString2 = "希望你每天都充满幸福快乐！";


    useEffect(() => {
        useGLTF.preload(bucketURL + "toJessie/Scene-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/paimon_idle_animation-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/treasure_chest-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/medieval_wooden_chest-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/cup-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/the_steampunk-transformed.glb");
        useGLTF.preload(bucketURL + "toJessie/Fanart Ayaka.glb");
        useGLTF.preload(bucketURL + "toJessie/firework_sky.glb");
        useGLTF.preload(bucketURL + "toJessie/fireworks-transformed.glb");

    }, []);


    const initialShowComponents = {
        scene: true,
        lightings: true,
        viewPort_start: true,
        treasure_one: true,
        paimon: false,
        textTitle_one: false,
        cup: false,
        treasure_two: false,
        treasure_three: false,
        sllh: false,
        firework_bg: false,
        fireworks: false,
        textTitle_birthdayWithValue: false,
    }
    // 使用一个对象来管理多个组件的初始显示状态,加载的时候先全部挂载，然后替换成上面的真实加载情况
    const [showComponents, setShowComponents] = useState({
        scene: true,
        lightings: true,
        pointlight: true,
        viewPort_start: true,
        treasure_one: true,
        paimon: true,
        textTitle_one: true,
        cup: true,
        treasure_two: true,
        treasure_three: true,
        sllh: true,
        firework_bg: true,
        fireworks: true,
        textTitle_birthdayWithValue: true,
    });

    useEffect(() => {
        setShowComponents(initialShowComponents);
    }, []);


    useEffect(() => {
        sceneJessieProject.ready.then(() => {
            sceneJessieSheet.sequence.position = startPoint;
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
            <Helmet>
                <title>Jessie Li Happy Birthday!!! - Welcome to Tim Bi's world</title>
                <meta name="description" content="Tim Bi's friend Jessie is having her 23th birthday! Let's wish her a happy birthday and have a look of what Tim prepared for her as her birthday gift!" />
                <meta name="keywords" content="Tim Bi, Jessie" />
                <meta property="og:title" content="Jessie Li Happy Birthday!!! - Welcome to Tim Bi's world" />
                <meta property="og:description" content="Tim's friend Jessie is having her 23th birthday! Let's wish her a happy birthday and have a look of what Tim prepared for her as her birthday gift!" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/jessie" />
                <link rel="canonical" href="https://www.bty.co.nz/jessie" />
                <meta name="author" content="Tim Bi" />
            </Helmet>
            <CanvasProvider>

                {/* <Canvas gl={{ antialias: antialias, preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={dpr} performance={{ min: 0.5 }} mode="concurrent" fallback={<div>Sorry no WebGL supported!</div>}> */}
                <SheetProvider sheet={sceneJessieSheet}>
                    <PreloadAssets />
                    <Suspense fallback={<WaitingJessie />}>

                        {showComponents.viewPort_start && <ViewPort theatreKey="start" screenTitle={"start"} position={[0, 0, 0]} rotation={[0, 0, 0]} stopPoint={5.5} sequence={sceneJessieSheet.sequence} onSequencePass={() => { toggleComponentDisplay("viewPort_start") }} unloadPoint={5.5} isSetNextScene={false} />}
                        {audioElement && <StreamMusic audioElement={audioElement} sequence={sceneJessieSheet.sequence} startPoint={0.02} maxVolume={1} />}

                        {showComponents.scene && <AnyModel useTheatre={true} theatreKey="scene" modelURL="toJessie/Scene-transformed.glb" sequence={sceneJessieSheet.sequence} onSequencePass={() => toggleComponentDisplay("scene")} unloadPoint={49} position={[0, 0, 0]} rotation={[0, 0, 0]} />}
                        <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[0, 0, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />
                        <color attach='background' args={[backgroundColor]} />

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
                        {showComponents.lightings && <>
                            <e.mesh theatreKey='spot light' additionalProps={{
                                intensity: types.number(spotIntensity, {
                                    range: [0, 100],
                                }),
                            }}
                                objRef={(theatreObject) => {
                                    // 监听Theatre.js中透明度的变化
                                    theatreObject.onValuesChange((newValues) => {
                                        setSpotIntensity(newValues.intensity);
                                    });
                                }}>
                                <spotLight position={[0, 0, 0]} intensity={spotIntensity} angle={0.3} penumbra={0} castShadow />
                            </e.mesh>
                        </>}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={50.5} onSequencePass={() => { toggleComponentDisplay("lightings") }} />
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={5.5} onSequencePass={() => { toggleComponentDisplay("paimon") }} />
                        {showComponents.paimon && <AnyModel useTheatre={true} theatreKey="paimon" modelURL="toJessie/paimon_idle_animation-transformed.glb" sequence={sceneJessieSheet.sequence} unloadPoint={15} onSequencePass={() => { toggleComponentDisplay("paimon") }} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[0.003, 0.003, 0.003]} />}
                        {showComponents.treasure_one && <AnyModel useTheatre={true} theatreKey="treasure1" modelURL="toJessie/treasure_chest-transformed.glb" sequence={sceneJessieSheet.sequence} unloadPoint={8.5} onSequencePass={() => { toggleComponentDisplay("treasure_one") }} stopPoints={[15]} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[0.5, 0.5, 0.5]} clickablePoint={5.5} animationNames={['Armature|A_Open']} animationOnClick={true} animationPlayTimes={1} animationSpeeds={1} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={7} onSequencePass={() => { toggleComponentDisplay("textTitle_one") }} />
                        {showComponents.textTitle_one && <TextTitle text={"get lost"} fontURL={"fonts/Orbitron_Bold.json"} size={1} sequence={sceneJessieSheet.sequence} onSequencePass={() => { toggleComponentDisplay("textTitle_one") }} unloadPoint={15} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={5.5} onSequencePass={() => { toggleComponentDisplay("treasure_two") }} />
                        {showComponents.treasure_two && <AnyModel useTheatre={true} theatreKey="treasure2" modelURL="toJessie/medieval_wooden_chest-transformed.glb" sequence={sceneJessieSheet.sequence} unloadPoint={18} onSequencePass={() => { toggleComponentDisplay("treasure_two") }} stopPoints={[19.5]} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[0.5, 0.5, 0.5]} clickablePoint={15} animationNames={["Opening"]} animationOnClick={true} animationPlayTimes={1} animationSpeeds={1} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={15} onSequencePass={() => { toggleComponentDisplay("cup") }} />
                        {showComponents.cup && <AnyModel useTheatre={true} theatreKey="cup" modelURL="toJessie/cup-transformed.glb" sequence={sceneJessieSheet.sequence} onSequencePass={() => { toggleComponentDisplay("cup") }} unloadPoint={20} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[0.1, 0.1, 0.1]} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={18} onSequencePass={() => { toggleComponentDisplay("treasure_three") }} />
                        {showComponents.treasure_three && <AnyModel useTheatre={true} theatreKey="treasure3" modelURL="toJessie/the_steampunk-transformed.glb" sequence={sceneJessieSheet.sequence} unloadPoint={47} onSequencePass={() => { toggleComponentDisplay("treasure_three") }} stopPoints={[54]} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[10, 10, 10]} clickablePoint={19.5} animationNames={["Take 001"]} animationOnClick={true} animationPlayTimes={1} animationSpeeds={1} animationStartPoint={5} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={45} onSequencePass={() => { toggleComponentDisplay("sllh") }} />
                        {showComponents.sllh && <AnyModel useTheatre={true} theatreKey="sllh" modelURL="toJessie/Fanart Ayaka.glb" sequence={sceneJessieSheet.sequence} unloadPoint={50} onSequencePass={() => { toggleComponentDisplay("sllh") }} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[0.001, 0.001, 0.001]} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={49} onSequencePass={() => { toggleComponentDisplay("firework_bg") }} />
                        {showComponents.firework_bg && <AnyModel useTheatre={true} theatreKey="firework_bg" modelURL="toJessie/firework_sky.glb" position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={50} onSequencePass={() => toggleComponentDisplay("fireworks")} />
                        {showComponents.fireworks && <Fireworks />}
                        <SingleLoadManager sequence={sceneJessieSheet.sequence} loadPoint={51} onSequencePass={() => { toggleComponentDisplay("textTitle_birthdayWithValue") }} />
                        {showComponents.textTitle_birthdayWithValue && <><TextTitle_v2 theatreKey={"birthdayWithValue"} text={endingString1} color={"#FF99FF"} fontURL={"fonts/Orbitron_Bold.json"} size={1} />
                            <TextTitle_v2 theatreKey={"birthdayWithValue2"} text={endingString2} color={"#FF99FF"} fontURL={"fonts/Orbitron_Bold.json"} size={0.8} /></>}

                    </Suspense>
                </SheetProvider>
            </CanvasProvider>
        </>
    )
}

export default SceneJessie;