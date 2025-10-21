import { Suspense, useCallback, useEffect, useRef, useContext } from 'react';
import PreloadAssets from '../modelComponents/PreloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, stageOfENV } from '../Settings';
import AnyModel from '../modelComponents/AnyModel';
import { Environment } from '@react-three/drei';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { headerSubTitleContext } from '../sharedContexts/HeaderSubTitleProvider';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { Bloom, BrightnessContrast, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { casinoFormContext } from '../sharedContexts/CasinoFormProvider';
import SingleLoadManager from '../modelComponents/SingleLoadManager';


function Casino({ casinoSheet, casinoProject, isPortraitPhoneScreen }) {

    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);
    const { messageApi } = useContext(GlobalNotificationContext);
    const { showCasinoForm, setShowCasinoForm } = useContext(casinoFormContext);

    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            preloadEnv: true,

        },
        initialComponents: {
            preloadAssets: false,
            preloadEnv: false,

        }
    });

    const finishLoading = useCallback(() => {
        casinoProject.ready.then(() => {
            casinoSheet.sequence.position = 0;
            casinoSheet.sequence.play({ range: [0, 6] });
        });
    }, []);


    return (
        <>
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Here is a good place to have fun", "Don't lose them all", "If you lose them all you have wait for the second day to get your salary as your daily reward."]} onFinished={() => { finishLoading() }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                {showComponents.preloadAssets && <PreloadAssets />}


                <ambientLight color={"#FFFFFF"} intensity={1} />

                <AnyModel modelURL={'casino/baccaratTable.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"baccaratTable"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />

                <AnyModel modelURL={'casino/hall.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hall"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={true} position={[0, 2, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />

                <color attach='background' args={['black']} />

                <SingleLoadManager sequence={casinoSheet.sequence} loadPoint={6} onSequencePass={() => {
                    setShowCasinoForm(true);
                }} />


                <Environment
                    files={bucketURL + 'pic/warehouse.hdr'}
                    resolution={4}
                    background={false}
                    intensity={0}
                    environmentIntensity={0}
                    backgroundIntensity={0}
                />

                <EffectComposer enableNormalPass>
                    <>
                        <BrightnessContrast brightness={0} contrast={0.05} />
                        <Bloom intensity={0.4} luminanceThreshold={0.3} />
                        <ToneMapping adaptive={true} />
                        <Vignette eskil={false} offset={0.1} darkness={0.3} />
                    </>
                </EffectComposer>

            </Suspense>
        </>
    )
}

export default Casino;
