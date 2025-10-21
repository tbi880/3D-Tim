import Galaxy from '../modelComponents/Galaxy';
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


function Quarter({ quarterSheet, quarterProject, onSequencePass, isPortraitPhoneScreen }) {
    const planetNumberRef = useRef(6);

    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);
    const { messageApi } = useContext(GlobalNotificationContext);
    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            preloadEnv: true,
            planet1: false,
            planet2: false,
            planet3: false,
            planet4: false,
            planet5: false,
            planet6: false,
        },
        initialComponents: {
            preloadAssets: false,
            preloadEnv: false,
            planet1: false,
            planet2: false,
            planet3: false,
            planet4: false,
            planet5: false,
            planet6: false,
        }
    });

    useEffect(() => {
        const randomPlanetIndex = Math.floor(Math.random() * planetNumberRef.current) + 1;
        const planetKey = `planet${randomPlanetIndex}`;
        toggleComponentDisplay(planetKey, true);
    }, []);

    const finishLoading = useCallback(() => {
        quarterProject.ready.then(() => {
            quarterSheet.sequence.position = 0;
            quarterSheet.sequence.play({ iterationCount: Infinity });
        });
    }, []);


    return (
        <>
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Alarm rings~", "Time to wake up", "You are about to back in your quarter"]} onFinished={() => { finishLoading() }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                {showComponents.preloadAssets && <PreloadAssets />}
                <Galaxy />

                <ambientLight color={"#FFFFFF"} intensity={1} />
                {showComponents.planet1 && <AnyModel modelURL={'planets/superNova.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"superNova"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["Object_0"]} animationSpeeds={0.2} />}
                {showComponents.planet2 && <AnyModel modelURL={'planets/jupiter.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"jupiter"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["ArmatureAction"]} animationSpeeds={1} />}
                {showComponents.planet3 && <AnyModel modelURL={'planets/lavaPlanet.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"lavaPlanet"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["clouds|cloudsAction.001"]} animationSpeeds={0.025} />}
                {showComponents.planet4 && <AnyModel modelURL={'planets/mars.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"mars"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["Rotation"]} animationSpeeds={0.05} />}
                {showComponents.planet5 && <AnyModel modelURL={'planets/purplePlanet.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"purplePlanet"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["Take 01"]} animationSpeeds={0.05} />}
                {showComponents.planet6 && <AnyModel modelURL={'planets/earth.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"earth"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} animationAutoStart animationNames={["Take 001"]} animationSpeeds={0.05} />}

                <AnyModel modelURL={'login/ShipQuarter.glb'} sequence={quarterSheet.sequence} useTheatre={true} theatreKey={"quarter"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />
                <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={true} position={[0, 2, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />

                <color attach='background' args={['black']} />


                {showComponents.planet1 && <Environment
                    files={bucketURL + 'pic/warehouse.hdr'}
                    resolution={4}
                    background={false}
                    intensity={0}
                    environmentIntensity={0}
                    backgroundIntensity={0}
                />}

                {!showComponents.planet1 && <Environment
                    files={bucketURL + 'pic/night.hdr'}
                    resolution={4}
                    background={false}
                    intensity={0}
                    environmentIntensity={0}
                    backgroundIntensity={0}
                />}

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

export default Quarter;
