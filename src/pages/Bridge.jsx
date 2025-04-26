
import Status, { getNextScene, getNextSceneStartPoint, getNextSceneURI } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import SceneTwo from './SceneTwo';
import scene2State from '../scene2.json';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { useNavigate } from "react-router-dom";
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
// import XrToolMiddleLayer from '../Tools/XrToolMiddleLayer';
import DoublePlayTimeSpeedButton from '../Tools/DoublePlayTimeSpeedButton';
import { getProject } from '@theatre/core';
import { stageOfENV } from '../Settings';
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'



if (stageOfENV != "prod") {

    studio.initialize()
    studio.extend(extension)
}


function Bridge({ isPortraitPhoneScreen }) {
    const scene2Project = getProject('Scene2 Sheet', { state: scene2State });
    const scene2Sheet = scene2Project.sheet('Scene2 Sheet');
    const navigate = useNavigate();
    const welcomeMessageSent = useRef(false);
    const { messageApi } = useContext(GlobalNotificationContext);
    useEffect(() => {
        if (welcomeMessageSent.current) return;
        welcomeMessageSent.current = true;
        messageApi(
            'success',
            "Welcome - Let's go to the main bridge. Click on the viewport to start",
            3,
        )
    }, [messageApi])

    const [isJumping, setIsJumping] = useState(false);

    function checkThenJumpToTheNextScene() {
        if (!isJumping) {
            setIsJumping(true);
            navigate(getNextSceneURI(getNextScene()));
        }
    }

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene2: Arrive at the ship's bridge</title>
                <meta name="description" content="After waking up, immediately go to the bridge and find a way to save the ship, as someone qualified to know and understand Captain Tim Bi." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene2: Arrive at the ship's bridge" />
                <meta property="og:description" content="After waking up, immediately go to the bridge and find a way to save the ship, as someone qualified to know and understand Captain Tim Bi." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/bridge" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/bridge" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider >
                    {/* <XrToolMiddleLayer> */}

                    <SheetProvider sheet={scene2Sheet}>
                        <SceneTwo scene2Sheet={scene2Sheet} scene2Project={scene2Project} startPoint={getNextSceneStartPoint()} isPortraitPhoneScreen={isPortraitPhoneScreen} unloadPoints={[38, 72, 96]} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                    {/* </XrToolMiddleLayer> */}
                </CanvasProvider>


            </div>
            <DoublePlayTimeSpeedButton sheetSequence={scene2Sheet.sequence} />
            <Status />
        </>
    )

}

export default Bridge;

