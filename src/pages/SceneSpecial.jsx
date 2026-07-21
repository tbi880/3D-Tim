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
import { useFrame } from '@react-three/fiber';
import Loading from '../modelComponents/Loading';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { useAudioElement } from '../hooks/useAudioElement';
import { useCameraSwitcher } from '../hooks/useCameraSwitcher';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';
import { useSequenceUnloadSceneChecker } from '../hooks/useSequenceUnloadSceneChecker';
import { Bloom, BrightnessContrast, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { useSequenceAutoSave, getResumePosition, getNextClickablePoint, getJumpPointResumePosition, clearResumePositionsIfNavigated } from '../hooks/useSequenceAutoSave';
import { createSuspenseGate, SuspenseGate } from '../utils/createSuspenseGate';
import * as THREE from 'three';

function SceneSpecial({ sceneSpecialSheet, sceneSpecialProject, startPoint, unloadPoint, onSequencePass, isPortraitPhoneScreen }) {
    const musicUrl = bucketURL + 'music/bgm5.mp3';
    const [backgroundColor, setBackgroundColor] = useState("black");
    const audioElement = useAudioElement(musicUrl);
    const [gate] = useState(() => createSuspenseGate());
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            preloadEnv: true,
            spaceEnv: true
        },
        initialComponents: {
            preloadAssets: false,
            preloadEnv: false,
            spaceEnv: true
        }
    });



    useFrame(() => {
        if (sceneSpecialSheet.sequence) {
            const currentPosition = sceneSpecialSheet.sequence.position;
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
                <Galaxy />

                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={true} position={[558, 33.7, -1.9]} rotation={[0, -4.5, 0]} fov={75} near={0.01} />

                <color attach='background' args={[backgroundColor]} />

                <Environment
                    preset="dawn"
                    background={true}
                />

                <EffectComposer enableNormalPass>
                    <>
                        <BrightnessContrast brightness={-0.05} contrast={0.05} />
                        <Bloom intensity={0.4} luminanceThreshold={0.3} />
                        <ToneMapping toneMapping={THREE.CineonToneMapping} exposure={0.8} />
                        <Vignette eskil={false} offset={0.1} darkness={0.3} />
                    </>
                </EffectComposer>

            </Suspense>
        </>
    )
}

export default SceneSpecial;
