
import Status, { getNextSceneStartPoint, getTourMapFromLocalStorage, hasTourGuided } from '../pages/Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider, RafDriverProvider } from '@theatre/r3f';
import scene5State from '../scene5.json';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import TourGuide from '../Tools/TourGuide';
import { useLocation } from 'wouter';
import DoublePlayTimeSpeedButton from '../Tools/DoublePlayTimeSpeedButton';
import { getProject, createRafDriver } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import { useJumpToNextScene } from '../hooks/useJumpToNextScene';
import SceneSpecial from '../pages/SceneSpecial';
import { XR, createXRStore } from '@react-three/xr';
import SceneSpecialState from '../sceneSpecial.json';
import { TheatreXRDriver } from '../utils/TheatreXRDriver';


function PageSpecial({ isPortraitPhoneScreen }) {
    const sceneSpecialProject = getProject('SceneSpecial', { state: SceneSpecialState });
    const sceneSpecialSheet = sceneSpecialProject.sheet('SceneSpecial');
    const [xrStore] = useState(() => createXRStore());

    const xrRafDriver = useMemo(
        () => createRafDriver({ name: "XR Driver" }),
        []
    )
    const enterVrButtonStyle = {
        position: 'fixed',
        left: '50%',
        top: '60%',
        transform: 'translate(-50%, -50%)',
        zIndex: 20,
        padding: '14px 24px',
        borderRadius: '999px',
        border: '1px solid rgba(255, 255, 255, 0.28)',
        background: 'linear-gradient(135deg, rgba(20, 28, 40, 0.92), rgba(9, 14, 24, 0.84))',
        color: '#ffffff',
        fontSize: '16px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        boxShadow: '0 14px 40px rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        cursor: 'pointer',
    };

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene Special: For Tim's special moment</title>
                <meta name="description" content="This is a special scene for Tim and can only be accessed by him under specific circumstances." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene Special: For Tim's special moment" />
                <meta property="og:description" content="This is a special scene for Tim and can only be accessed by him under specific circumstances." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/scene_special" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/scene_special" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <button
                    type="button"
                    onClick={async () => {
                        await xrStore.enterVR();
                        await xrStore.requestFrame();
                        sceneSpecialProject.ready.then(() => {
                            sceneSpecialSheet.sequence.position = 0;
                            sceneSpecialSheet.sequence.play([0, 25], { loop: false, rafDriver: xrRafDriver });
                        });
                    }}
                    style={enterVrButtonStyle}
                >
                    Enter VR
                </button>
                <CanvasProvider enableWebGPU={false}>
                    <RafDriverProvider driver={xrRafDriver}>
                        <SheetProvider sheet={sceneSpecialSheet}>
                            <XR store={xrStore}>
                                <TheatreXRDriver driver={xrRafDriver} />
                                <SceneSpecial sceneSpecialSheet={sceneSpecialSheet} sceneSpecialProject={sceneSpecialProject} isPortraitPhoneScreen={isPortraitPhoneScreen} />
                            </XR>
                        </SheetProvider>
                    </RafDriverProvider>
                </CanvasProvider>
            </div>

        </>
    )

}

export default PageSpecial;
