
import Status, { getNextScene, getNextSceneStartPoint, getUserAntialias, getUserDpr, jumpToTheNextScene } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
// import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import { scene5Sheet } from './SceneManager';
import { useContext, useState } from 'react';
import { webGLPreserveDrawingBuffer } from '../Settings';
import SceneFive_mobile from './SceneFive_mobile';
import ShipStatus from '../Tools/ShipStatus';
import { EstHitTimeCountDownProvider } from '../sharedContexts/EstHitTimeCountDownProvider';
import { CoreEnergyProvider } from '../sharedContexts/CoreEnergyProvider';
import { HullTemperatureProvider } from '../sharedContexts/HullTemperatureProvider';
import DistressSignalForm from '../Tools/DistressSignalForm';
import { message } from 'antd';
import { sendDistressSignalContext, SendDistressSignalProvider } from '../sharedContexts/SendDistressSignalProvider';



function ShipTimsChamber({ vrSupported, isPortraitPhoneScreen }) {

    const [isJumping, setIsJumping] = useState(false);
    const [messageApi, contextHolder] = message.useMessage();
    const { showForm, setShowForm } = useContext(sendDistressSignalContext);


    function checkThenJumpToTheNextScene() {
        if (!isJumping) {
            setIsJumping(true);
            jumpToTheNextScene(getNextScene());
        }
    }

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene5: Welcome to Tim's chamber & the command bridge.</title>
                <meta name="description" content="Finally, you are authorized to go to the top level -- the command room. Here you are going to make some decisions in order to save the ship." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene5: Welcome to Tim's chamber & the command bridge." />
                <meta property="og:description" content="Finally, you are authorized to go to the top level -- the command room. Here you are going to make some decisions in order to save the ship." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_captains_chamber" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi's World" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_captains_chamber" />
                <meta name="author" content="Tim Bi" />

            </Helmet>
            <EstHitTimeCountDownProvider>
                <HullTemperatureProvider>
                    <CoreEnergyProvider>
                        {contextHolder}


                        <ShipStatus isPortraitPhoneScreen={isPortraitPhoneScreen} />
                        {showForm && (
                            <DistressSignalForm
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                                messageApi={messageApi}
                            />
                        )}
                        <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>


                            <Canvas gl={{ antialias: getUserAntialias(), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }}>
                                <SheetProvider sheet={scene5Sheet}>
                                    <SceneFive_mobile startPoint={getNextSceneStartPoint()} unloadPoint={64} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                            </Canvas>

                            {/* {vrSupported && <>
                    <VRButton />
                    <Canvas gl={{ preserveDrawingBuffer: webGLPreserveDrawingBuffer }} >
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene5Sheet}>
                                <SceneThree startPoint={getNextSceneStartPoint()} isVRSupported={vrSupported} unloadPoint={64} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ preserveDrawingBuffer: webGLPreserveDrawingBuffer }} >
                        <SheetProvider sheet={scene5Sheet}>
                            <SceneThree_mobile startPoint={getNextSceneStartPoint()} unloadPoint={64} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                    </Canvas>} */}


                        </div>
                    </CoreEnergyProvider>
                </HullTemperatureProvider>
            </EstHitTimeCountDownProvider>
            <Status />
        </>
    )

}

export default ShipTimsChamber;

