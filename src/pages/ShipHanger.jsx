
import Status, { getNextSceneStartPoint } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import scene3State from '../scene3.json';
import SceneThree from './SceneThree';
import { useContext, useEffect, useRef } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
// import XrToolMiddleLayer from '../Tools/XrToolMiddleLayer';
import DoublePlayTimeSpeedButton from '../Tools/DoublePlayTimeSpeedButton';
import { getProject } from '@theatre/core';
import { useJumpToNextScene } from '../hooks/useJumpToNextScene';



function ShipHanger({ isPortraitPhoneScreen }) {
    const scene3Project = getProject('Scene3 Sheet', { state: scene3State });
    const scene3Sheet = scene3Project.sheet('Scene3 Sheet');
    const welcomeMessageSent = useRef(false);
    const { messageApi } = useContext(GlobalNotificationContext);
    useEffect(() => {
        if (welcomeMessageSent.current) return;
        welcomeMessageSent.current = true;
        messageApi(
            'success',
            "Welcome to the ship hanger - Tim's memory of his tech journey! Click on the viewport to access.",
            3,
        )
    }, [messageApi])

    const { checkThenJumpToTheNextScene } = useJumpToNextScene();

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene3: Arrive at the ship hanger</title>
                <meta name="description" content="You choose to go to the ship hanger and access Tim Bi's memory of his tech journey, with the resume of Tim Bi if you care to download." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene3: Arrive at the ship hanger" />
                <meta property="og:description" content="You choose to go to the ship hanger and access Tim Bi's memory of his tech journey, with the resume of Tim Bi if you care to download." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_hanger" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_hanger" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>

                <CanvasProvider>
                    {/* <XrToolMiddleLayer> */}
                    <SheetProvider sheet={scene3Sheet}>
                        <SceneThree scene3Sheet={scene3Sheet} scene3Project={scene3Project} startPoint={getNextSceneStartPoint()} isPortraitPhoneScreen={isPortraitPhoneScreen} unloadPoint={64} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>
                    {/* </XrToolMiddleLayer> */}
                </CanvasProvider>
            </div >
            <DoublePlayTimeSpeedButton sheetSequence={scene3Sheet.sequence} />

            <Status />
        </>
    )

}

export default ShipHanger;

