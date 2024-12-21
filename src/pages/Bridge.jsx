
import Status, { getNextScene, getNextSceneStartPoint, getNextSceneURI } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import SceneTwo from './SceneTwo';
import { scene2Sheet } from './SceneManager';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { useNavigate } from "react-router-dom";
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import XrToolMiddleLayer from '../Tools/XrToolMiddleLayer';
import DoublePlayTimeSpeedButton from '../Tools/DoublePlayTimeSpeedButton';



function Bridge({ isPortraitPhoneScreen }) {
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
                <meta property="og:site_name" content="Tim Bi's World" />
                <link rel="canonical" href="https://www.bty.co.nz/bridge" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider>
                    <XrToolMiddleLayer>

                        <SheetProvider sheet={scene2Sheet}>
                            <SceneTwo startPoint={getNextSceneStartPoint()} isPortraitPhoneScreen={isPortraitPhoneScreen} unloadPoints={[38, 72, 96]} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                    </XrToolMiddleLayer>
                </CanvasProvider>


            </div>
            <DoublePlayTimeSpeedButton sheetSequence={scene2Sheet.sequence} />
            <Status />
        </>
    )

}

export default Bridge;

