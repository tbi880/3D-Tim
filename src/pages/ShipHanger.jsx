
import Status, { getNextScene, getNextSceneStartPoint, getNextSceneURI, getUserAntialias, getUserDpr, } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import { scene3Sheet } from './SceneManager';
import SceneThree_mobile from './SceneThree_mobile';
import SceneThree from './SceneThree';
import { useContext, useEffect, useState } from 'react';
import { webGLPreserveDrawingBuffer } from '../Settings';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { useNavigate } from 'react-router-dom';





function ShipHanger({ vrSupported, isPortraitPhoneScreen }) {
    const navigate = useNavigate();
    const { messageApi } = useContext(GlobalNotificationContext);
    useEffect(() => {

        messageApi(
            'success',
            "Welcome to the ship hanger - Tim's memory of his tech journey! Click on the viewport to access.",
            3,
        )
    }, [messageApi])

    const [isJumping, setIsJumping] = useState(false);

    function checkThenjumpToTheNextScene() {
        if (!isJumping) {
            setIsJumping(true);
            navigate(getNextSceneURI(getNextScene()));

        }
    }

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
                <meta property="og:site_name" content="Tim Bi's World" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_hanger" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>

                {vrSupported && <>
                    <VRButton />
                    <Canvas gl={{ antialias: getUserAntialias(isPortraitPhoneScreen), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }} mode="concurrent">
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene3Sheet}>
                                <SceneThree startPoint={getNextSceneStartPoint()} isVRSupported={vrSupported} unloadPoint={64} onSequencePass={() => checkThenjumpToTheNextScene()} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ antialias: getUserAntialias(isPortraitPhoneScreen), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }} mode="concurrent">
                        <SheetProvider sheet={scene3Sheet}>
                            <SceneThree_mobile startPoint={getNextSceneStartPoint()} unloadPoint={64} onSequencePass={() => checkThenjumpToTheNextScene()} /></SheetProvider>

                    </Canvas>}


            </div>
            <Status />
        </>
    )

}

export default ShipHanger;

