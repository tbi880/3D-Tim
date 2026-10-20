
import Status, { getNextSceneStartPoint } from '../pages/Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import scene5State from '../scene5.json';
import { useContext, useRef, useState } from 'react';
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
import SceneFive from '../pages/SceneFive';
import { useLocation } from 'wouter';
import DoublePlayTimeSpeedButton from '../Tools/DoublePlayTimeSpeedButton';
import { getProject } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import { useJumpToNextScene } from '../hooks/useJumpToNextScene';



function ShipTimsChamber({ isPortraitPhoneScreen }) {
    const scene5Project = getProject('Scene5', { state: scene5State });
    const scene5Sheet = scene5Project.sheet('Scene5');
    const [location, setLocation] = useLocation();
    const tourStartSceneURI = "/ship_captains_chamber";
    const refShipStatus = useRef(null);
    const [open, setOpen] = useState(false);
    const [isHide, setIsHide] = useState(false);
    const { showSendDistressSignalForm, setShowSendDistressSignalForm } = useContext(sendDistressSignalContext);
    const { showAuthorizationCheckForm, setShowAuthorizationCheckForm } = useContext(authorizationCheckContext);
    const { showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer } = useContext(searchForEmergencyPlansContext);
    const { showHeaderSubTitle, setShowHeaderSubTitle } = useContext(headerSubTitleContext);

    const { checkThenJumpToTheNextScene } = useJumpToNextScene();

    // The distress-signal, authorization and emergency-plan forms cover the 3D view while the
    // timeline is stopped. Pause rendering meanwhile, so the phone isn't rendering the 2M-vertex
    // chamber behind a form while also running the CAPTCHA and the on-screen keyboard.
    const isOverlayOpen = showSendDistressSignalForm || showAuthorizationCheckForm || showSearchForEmergencyPlansLayer;

    function onClickCallback() {
        setIsHide(!isHide);
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
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_captains_chamber" />
                <meta name="author" content="Tim Bi" />

            </Helmet>
            <EstHitTimeCountDownProvider>
                <HullTemperatureProvider>
                    <CoreEnergyProvider>
                        <ShipStatus isPortraitPhoneScreen={isPortraitPhoneScreen} ref={refShipStatus} isHide={isHide} onClick={onClickCallback} />
                        {showSendDistressSignalForm && (
                            <DistressSignalForm scene5Sheet={scene5Sheet}
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showAuthorizationCheckForm && (
                            <AuthorizationCheckForm scene5Sheet={scene5Sheet}
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showSearchForEmergencyPlansLayer && (
                            <SearchForEmergencyPlans scene5Sheet={scene5Sheet}
                                isPortraitPhoneScreen={isPortraitPhoneScreen}
                            />
                        )}

                        {showHeaderSubTitle && <Header onAnimationEnd={() => { setShowHeaderSubTitle(false) }} defaultBaseDuration={7} defaultNotice={{ noticeContent: "If you’re watching this, it’s our last moment. ‘Project Dawn’ can probably save the ship, but it will consume all remaining resources. It's a tough decision to make but I trust you. Lead them out of the darkness before dawn arrives.", noticeLink: null }} />}

                        <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                            {/* iosMaxTextureSize 1024: Scene 5 is the heaviest scene; keep iPads at the iPhone texture cap here too. */}
                            <CanvasProvider postprocessing iosMaxTextureSize={1024} frameLoopSetting={isOverlayOpen ? "never" : "always"}>
                                {/* <Canvas gl={{ antialias: antialias, preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={dpr} performance={{ min: 0.5 }} mode="concurrent" fallback={<div>Sorry no WebGL supported!</div>}> */}
                                <SheetProvider sheet={scene5Sheet}>
                                    <SceneFive scene5Sheet={scene5Sheet} scene5Project={scene5Project} startPoint={getNextSceneStartPoint()} unloadPoint={207} onSequencePass={() => checkThenJumpToTheNextScene()} isPortraitPhoneScreen={isPortraitPhoneScreen} /></SheetProvider>

                                {/* </Canvas> */}
                            </CanvasProvider>
                        </div>
                    </CoreEnergyProvider>
                </HullTemperatureProvider>
            </EstHitTimeCountDownProvider >
            <DoublePlayTimeSpeedButton sheetSequence={scene5Sheet.sequence} />

            <Status />
        </>
    )

}

export default ShipTimsChamber;
