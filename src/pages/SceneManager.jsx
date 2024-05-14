import scene1State from '../scene1.json';
import scene2State from '../scene2.json';
import scene3State from '../scene3.json';
import sceneJessieState from '../sceneJessie.json';
import { getProject } from '@theatre/core';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import SceneOne from './SceneOne';
import SceneTwo from './SceneTwo';
import SceneThree from './SceneThree';
import { useCallback, useEffect, useState } from 'react';
import { getNextScene, getNextSceneStartPoint } from './Status';
import { stageOfENV } from '../Settings';
import { Controllers, Hands, XR, VRButton } from '@react-three/xr';
import '@react-three/fiber'


export const scene1Project = getProject('Scene1 Sheet', { state: scene1State });
export const scene1Sheet = scene1Project.sheet('Scene1 Sheet');
export const scene2Project = getProject('Scene2 Sheet', { state: scene2State });
export const scene2Sheet = scene2Project.sheet('Scene2 Sheet');
export const scene3Project = getProject('Scene3 Sheet', { state: scene3State });
export const scene3Sheet = scene3Project.sheet('Scene3 Sheet');
export const sceneJessieProject = getProject('SceneJessie', { state: sceneJessieState });
export const sceneJessieSheet = sceneJessieProject.sheet('SceneJessie');


function SceneManager() {

    const [showScenes, setShowScenes] = useState({
        sceneOne: true,
        sceneTwo: false,
        sceneThree: false,
        // sceneJessie: true,
    });

    useEffect(() => {
        if (stageOfENV != "building") {
            const nextScene = getNextScene();
            const newShowScenes = Object.keys(showScenes).reduce((acc, scene) => {
                acc[scene] = false;
                return acc;
            }, {});


            newShowScenes[nextScene] = true;

            setShowScenes(newShowScenes);

        }
    }, []);

    // const [scenesSheetStopPoints, setScenesSheetStopPoints] = useState({
    //     sceneOne: 39,

    // });

    const [scenesSheets, setScenesSheets] = useState({
        sceneOne: scene1Sheet,
        sceneTwo: scene2Sheet,
        sceneThree: scene3Sheet,
        // sceneJessie: sceneJessieSheet,
    });

    // 创建一个通用的切换函数
    const toggleSceneDisplay = useCallback((componentKey) => {
        const nextKey = getNextScene();
        console.log(nextKey);
        setShowScenes((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
            ...(nextKey && { [nextKey]: !prev[nextKey] }), // 切换下一个组件状态
        }));
        // 检测屏幕是否为手机竖屏模式，即高度大于宽度
        const isPortraitPhoneScreen = window.innerHeight > window.innerWidth;

        // 如果是手机竖屏模式，执行逻辑
        if (isPortraitPhoneScreen) {
            window.location.reload();
        }


    }, []);

    function findCurrentScene() {
        const currentScene = Object.keys(showScenes).find((scene) => showScenes[scene]);
        // console.log('Current Scene:', currentScene);
        return currentScene;

    }

    function findCurrentSceneSheet() {
        const sheet = scenesSheets[findCurrentScene()];
        // console.log('Current Scene Sheet:', sheet);
        if (!sheet) {
            throw new Error('Sheet is undefined. This will cause an error in SheetProvider.');
        }
        return sheet;
    }


    return (
        <>
            <VRButton />
            <Canvas gl={{ preserveDrawingBuffer: true }} >
                <XR>
                    <Controllers rayMaterial={{ color: '#99FFFF' }} />
                    <Hands />
                    {showScenes.sceneOne && <SheetProvider sheet={scene1Sheet}>
                        <SceneOne unloadPoint={39} onSequencePass={() => toggleSceneDisplay("sceneOne")} /></SheetProvider>}

                    {showScenes.sceneTwo && <SheetProvider sheet={scene2Sheet}>
                        <SceneTwo startPoint={getNextSceneStartPoint()} unloadPoints={[38]} onSequencePass={() => toggleSceneDisplay("sceneTwo")} /></SheetProvider>}

                    {showScenes.sceneThree && <SheetProvider sheet={scene3Sheet}>
                        <SceneThree startPoint={getNextSceneStartPoint()} onSequencePass={() => toggleSceneDisplay("sceneThree")} unloadPoint={64} /></SheetProvider>}


                    {/* {showScenes.sceneJessie &&
                <SceneJessie startPoint={0} />} */}
                </XR>



            </Canvas>

        </>
    )
}

export default SceneManager;