import Galaxy from '../modelComponents/Galaxy';
import ShipOutside from '../modelComponents/ShipOutside';
import StreamMusic from '../modelComponents/StreamMusic';
import { Suspense, useState, useCallback, useEffect, useRef, useContext, useMemo } from 'react';
import PreloadAssets from '../modelComponents/PreloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, stageOfENV } from '../Settings';

import AnyModel from '../modelComponents/AnyModel';
import { Environment } from '@react-three/drei';
import { types } from '@theatre/core';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import { useFrame, useThree } from '@react-three/fiber';
import Loading from '../modelComponents/Loading';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';
import { useCameraSwitcher } from '../hooks/useCameraSwitcher';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';
import { useSequenceUnloadSceneChecker } from '../hooks/useSequenceUnloadSceneChecker';
import { useSequenceAutoSave, getResumePosition, getNextClickablePoint, getJumpPointResumePosition, clearResumePositionsIfNavigated } from '../hooks/useSequenceAutoSave';
import { createSuspenseGate, SuspenseGate } from '../utils/createSuspenseGate';
import * as THREE from 'three';
import TextTitle_v2 from '../modelComponents/TextTitle_v2';

function SceneSpecial({ sceneSpecialSheet, sceneSpecialProject, startPoint, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const musicUrl = bucketURL + 'music/bgm5.mp3';
    const [backgroundColor, setBackgroundColor] = useState("black");
    const audioElement = useAudioElement(musicUrl);
    const [gate] = useState(() => createSuspenseGate());
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            preloadEnv: true,
            envShangHai: true,
            environmentVenice: true,
            vrWelcomeText1: true,
            vrScene1Text1: true,
            vrScene1Text2: true
        },
        initialComponents: {
            preloadAssets: false,
            preloadEnv: false,
            envShangHai: true,
            environmentVenice: false,
            vrWelcomeText1: true,
            vrScene1Text1: false,
            vrScene1Text2: false
        }
    });

    const { gl } = useThree();


    useFrame(() => {
        if (sceneSpecialSheet.sequence) {
            const currentPosition = sceneSpecialSheet.sequence.position;
            if (currentPosition > 0) {
                // alert(gl.constructor.name);
            }
        }
    });

    const finishLoading = useCallback(() => {
        sceneSpecialProject.ready.then(() => {
            sceneSpecialSheet.sequence.position = 0;
        });
    }, []);

    return (
        <>
            <Suspense fallback={<Loader onFadeComplete={() => gate.resolve()} isIntroNeeded={false} extraContent={["Warning: Secret page!!!"]} onFinished={() => { finishLoading(); }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                {showComponents.preloadAssets && <PreloadAssets />}
                <SuspenseGate gate={gate} />

                {audioElement && <StreamMusic audioElement={audioElement} sequence={sceneSpecialSheet.sequence} startPoint={20.1} maxVolume={1} />}

                {/* <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={true} position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} /> */}

                {showComponents.preloadEnv && (
                    <Environment
                        files={bucketURL + 'pic/venice_sunrise_4k.exr'}
                        background={false}
                        backgroundIntensity={0.005}
                    />
                )}

                {showComponents.envShangHai && (
                    <Environment
                        files={bucketURL + 'pic/shanghai_bund_4k.exr'}
                        background={true}
                        backgroundIntensity={0.2}
                    />
                )}

                {showComponents.vrWelcomeText1 && <TextTitle_v2 theatreKey={"VR_WELCOME_1"} fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} text="Look back!" color="#FFFFFF" size={1} sequence={sceneSpecialSheet.sequence} position={[0, 0, 0]} rotation={[0, 0, 0]} />}

                <SingleLoadManager loadPoint={3} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text1", true); toggleComponentDisplay("vrWelcomeText1", false); }} />
                {showComponents.vrScene1Text1 && <TextTitle_v2 theatreKey={"vrScene1Text1"} text="咔咔说的对" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}

                <SingleLoadManager loadPoint={7} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text2", true); toggleComponentDisplay("vrScene1Text1", false); }} />
                {showComponents.vrScene1Text2 && <TextTitle_v2 theatreKey={"vrScene1Text2"} text="的确需要好好感谢一下ct这位老铁" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}

                <SingleLoadManager loadPoint={11} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text3", true); toggleComponentDisplay("vrScene1Text2", false); }} />
                {showComponents.vrScene1Text3 && <TextTitle_v2 theatreKey={"vrScene1Text3"} text="否则鹅大王和咔咔再怎么合拍，再怎么合彼此心意，也遇不上" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}

                <SingleLoadManager loadPoint={15} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text4", true); toggleComponentDisplay("vrScene1Text3", false); }} />
                {showComponents.vrScene1Text4 && <TextTitle_v2 theatreKey={"vrScene1Text4"} text="在此，我先代表一下我的咔咔小弟在这里感谢你一下啦！！！" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}

                <SingleLoadManager loadPoint={19} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text5", true); toggleComponentDisplay("vrScene1Text4", false); }} />
                {showComponents.vrScene1Text5 && <TextTitle_v2 theatreKey={"vrScene1Text5"} text="也祝你早日得到自己的幸福（PS：如果已经幸福上了那就最好！！！写这个的时候还不知道你有没有复合哈哈哈" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}

                <SingleLoadManager loadPoint={23} sequence={sceneSpecialSheet.sequence} onSequencePass={() => { toggleComponentDisplay("vrScene1Text6", true); toggleComponentDisplay("vrScene1Text5", false); }} />
                {showComponents.vrScene1Text6 && <TextTitle_v2 theatreKey={"vrScene1Text6"} text="接下来请摘下头显，交给咔咔戴上，让她期待一下哈哈哈" color="#FFFFFF" fontURL={"fonts/ZCOOL KuaiLe_Regular.json"} size={1} sequence={sceneSpecialSheet.sequence} position={[30, 17, 25]} rotation={[0, -2.5, 0]} />}


            </Suspense>
        </>
    )
}

export default SceneSpecial;
