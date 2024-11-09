
import Status, { getNextScene, getNextSceneStartPoint, getUserAntialias, getUserDpr, jumpToTheNextScene } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import SceneTwo from './SceneTwo';
import { scene2Sheet } from './SceneManager';
import SceneTwo_mobile from './SceneTwo_mobile';
import { useContext, useEffect, useState } from 'react';
import { webGLPreserveDrawingBuffer } from '../Settings';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';





function Bridge({ vrSupported, isPortraitPhoneScreen }) {
    const { messageApi } = useContext(GlobalNotificationContext);
    useEffect(() => {
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
            jumpToTheNextScene(getNextScene());
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

                {vrSupported && <>
                    <VRButton />
                    <Canvas gl={{ antialias: getUserAntialias(), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }} mode="concurrent">
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene2Sheet}>
                                <SceneTwo startPoint={getNextSceneStartPoint()} isVRSupported={vrSupported} unloadPoints={[38, 72, 96]} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ antialias: getUserAntialias(), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }} mode="concurrent">
                        <SheetProvider sheet={scene2Sheet}>
                            <SceneTwo_mobile startPoint={getNextSceneStartPoint()} unloadPoints={[38, 72, 96]} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                    </Canvas>}


            </div>
            <Status />
        </>
    )

}

export default Bridge;

