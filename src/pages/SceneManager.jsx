import scene1State from '../scene1.json';
import scene2State from '../scene2.json'
import { getProject } from '@theatre/core';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import SceneOne from './SceneOne';
import SceneTwo from './SceneTwo';
import { useCallback, useState, useEffect } from 'react';

export const scene1Sheet = getProject('Scene1 Sheet', { state: scene1State }).sheet('Scene1 Sheet')
export const scene2Sheet = getProject('Scene2 Sheet', { state: scene2State }).sheet('Scene2 Sheet')


function SceneManager() {
    const [showScenes, setShowScenes] = useState({
        sceneOne: true,
        sceneTwo: false,
    });

    // const [scenesSheetStopPoints, setScenesSheetStopPoints] = useState({
    //     sceneOne: 39,

    // });

    const [scenesSheets, setScenesSheets] = useState({
        sceneOne: scene1Sheet,
        screenTwo: scene2Sheet,
    });

    // 创建一个通用的切换函数
    const toggleSceneDisplay = useCallback((componentKey) => {
        const keys = Object.keys(showScenes);
        const currentIndex = keys.indexOf(componentKey);
        const nextIndex = (currentIndex + 1) % keys.length;
        const nextKey = keys[nextIndex];



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
                    <SceneOne unloadPoint={39} onSequencePass={() => toggleSceneDisplay("sceneOne")} />

                </SheetProvider>}

                {showScenes.sceneTwo && <SheetProvider sheet={scene2Sheet}>
                    <SceneTwo /></SheetProvider>}
            </Canvas>
        </>
    )
}

export default SceneManager;