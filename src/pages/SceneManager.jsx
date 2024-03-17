import scene1State from '../scene1.json';
import scene2State from '../scene2.json';
import scene3State from '../scene3.json';
import { getProject } from '@theatre/core';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import SceneOne from './SceneOne';
import SceneTwo from './SceneTwo';
import SceneThree from './SceneThree';
import { useCallback, useState } from 'react';
import { getNextScene, getNextSceneStartPoint } from './Status';


export const scene1Sheet = getProject('Scene1 Sheet', { state: scene1State }).sheet('Scene1 Sheet')
export const scene2Sheet = getProject('Scene2 Sheet', { state: scene2State }).sheet('Scene2 Sheet')
export const scene3Project = getProject('Scene3 Sheet', { state: scene3State })
export const scene3Sheet = scene3Project.sheet('Scene3 Sheet')

function SceneManager() {

    const [showScenes, setShowScenes] = useState({
        sceneOne: true,
        sceneTwo: false,
        screenThree: false,
    });

    // const [scenesSheetStopPoints, setScenesSheetStopPoints] = useState({
    //     sceneOne: 39,

    // });

    const [scenesSheets, setScenesSheets] = useState({
        sceneOne: scene1Sheet,
        screenTwo: scene2Sheet,
        screenThree: scene3Sheet,
    });

    // 创建一个通用的切换函数
    const toggleSceneDisplay = useCallback((componentKey) => {
        const nextKey = getNextScene();



        setShowScenes((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
            ...(nextKey && { [nextKey]: !prev[nextKey] }), // 切换下一个组件状态
        }));


    }, []);

    function findCurrentScene() {
        const currentScene = Object.keys(showScenes).find((scene) => showScenes[scene]);
        console.log('Current Scene:', currentScene);
        return currentScene;

    }

    function findCurrentSceneSheet() {
        const sheet = scenesSheets[findCurrentScene()];
        console.log('Current Scene Sheet:', sheet);
        if (!sheet) {
            throw new Error('Sheet is undefined. This will cause an error in SheetProvider.');
        }
        return sheet;
    }


    return (
        <>
            <Canvas gl={{ preserveDrawingBuffer: true }} >
                {showScenes.sceneOne && <SheetProvider sheet={scene1Sheet}>
                    <SceneOne unloadPoint={39} onSequencePass={() => toggleSceneDisplay("sceneOne")} /></SheetProvider>}

                {showScenes.sceneTwo && <SheetProvider sheet={scene2Sheet}>
                    <SceneTwo startPoint={getNextSceneStartPoint()} unloadPoints={[38]} onSequencePass={() => toggleSceneDisplay("sceneTwo")} /></SheetProvider>}

                {showScenes.screenThree && <SheetProvider sheet={scene3Sheet}>
                    <SceneThree startPoint={getNextSceneStartPoint()} onSequencePass={() => toggleSceneDisplay("screenThree")} unloadPoint={64} /></SheetProvider>}
            </Canvas>
        </>
    )
}

export default SceneManager;