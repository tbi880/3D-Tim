
import Status, { getNextScene, getNextSceneStartPoint, getNextSceneURI, getUserAntialias, getUserDpr } from './Status';
import { useNavigate } from "react-router-dom";
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
import { sendDistressSignalContext } from '../sharedContexts/SendDistressSignalProvider';
import { authorizationCheckContext } from '../sharedContexts/AuthorizationCheckProvider';
import AuthorizationCheckForm from '../Tools/AuthorizationCheckForm';
import { searchForEmergencyPlansContext } from '../sharedContexts/SearchForEmergencyPlansProvider';
import SearchForEmergencyPlans from '../Tools/SearchForEmergencyPlans';
import Header from '../Tools/Header';
import { headerSubTitleContext } from '../sharedContexts/HeaderSubTitleProvider';



function ShipTimsChamber({ vrSupported, isPortraitPhoneScreen }) {
    const navigate = useNavigate();
    const [isJumping, setIsJumping] = useState(false);
    const { showSendDistressSignalForm, setShowSendDistressSignalForm } = useContext(sendDistressSignalContext);
    const { showAuthorizationCheckForm, setShowAuthorizationCheckForm } = useContext(authorizationCheckContext);
    const { showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer } = useContext(searchForEmergencyPlansContext);
    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);



    function checkThenjumpToTheNextScene() {
        if (!isJumping) {
            setIsJumping(true);
            navigate(getNextSceneURI(getNextScene()));

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

                        <ShipStatus isPortraitPhoneScreen={isPortraitPhoneScreen} />
                        {showSendDistressSignalForm && (
                            <DistressSignalForm
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showAuthorizationCheckForm && (
                            <AuthorizationCheckForm
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showSearchForEmergencyPlansLayer && (
                            <SearchForEmergencyPlans
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showHeaderSubTitle && <Header onAnimationEnd={() => { setShowHeaderSubTitle(false) }} defaultBaseDuration={7} defaultNotice={{ noticeContent: "If you’re watching this, it’s our last moment. ‘Project Dawn’ can probably save the ship, but it will consume all remaining resources. It's a tough decision to make but I trust you. Lead them out of the darkness before dawn arrives.", noticeLink: null }} />}

                        <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>


                            <Canvas gl={{ antialias: getUserAntialias(isPortraitPhoneScreen), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }} mode="concurrent">
                                <SheetProvider sheet={scene5Sheet}>
                                    <SceneFive_mobile startPoint={getNextSceneStartPoint()} unloadPoint={64} onSequencePass={() => checkThenjumpToTheNextScene()} /></SheetProvider>

                            </Canvas>

                            {/* {vrSupported && <>
                    <VRButton />
                    <Canvas gl={{ preserveDrawingBuffer: webGLPreserveDrawingBuffer }} >
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene5Sheet}>
                                <SceneThree startPoint={getNextSceneStartPoint()} isVRSupported={vrSupported} unloadPoint={64} onSequencePass={() => checkThenjumpToTheNextScene()} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ preserveDrawingBuffer: webGLPreserveDrawingBuffer }} >
                        <SheetProvider sheet={scene5Sheet}>
                            <SceneThree_mobile startPoint={getNextSceneStartPoint()} unloadPoint={64} onSequencePass={() => checkThenjumpToTheNextScene()} /></SheetProvider>

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

