
import { useState, useCallback } from 'react';
import { getNextScene, getNextSceneStartPoint, getUserAntialias, getUserDpr, jumpToTheNextScene } from './Status';
import Header from '../Tools/Header';
import Status from './Status';
import { stageOfENV, webGLPreserveDrawingBuffer } from '../Settings';
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import SceneOne from './SceneOne';
import SceneOne_mobile from './SceneOne_mobile';
import { SheetProvider } from '@theatre/r3f';
import { Canvas } from '@react-three/fiber';
import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { scene1Sheet } from './SceneManager';

if (stageOfENV != "prod") {

    studio.initialize()
    studio.extend(extension)
}





function HomePage({ isPortraitPhoneScreen, vrSupported }) {
    const [showComponents, setShowComponents] = useState({
        header: true,
    });

    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));

    }, []);

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
                <title>Welcome to Tim Bi's world - 2024</title>
                <meta name="description" content="Ready for a 3D ride in Tim Bi's universe? I think you would know me very well after you finish this 'adventure'" />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - 2024" />
                <meta property="og:description" content="Ready for a 3D ride in Tim Bi's universe? I think you would know me very well after you finish this 'adventure'" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi's World" />
                <link rel="canonical" href="https://www.bty.co.nz/" />
                <meta name="author" content="Tim Bi" />

            </Helmet>
            {showComponents.header && (getNextScene() == "sceneOne") && <Header onAnimationEnd={() => toggleComponentDisplay("header")} />}
            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>

                {vrSupported && <>
                    <VRButton />
                    <Canvas gl={{ antialias: getUserAntialias(), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }}>
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene1Sheet}>
                                <SceneOne startPoint={getNextSceneStartPoint()} isVRSupported={vrSupported} unloadPoint={39} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ antialias: getUserAntialias(), preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={getUserDpr()} performance={{ min: 0.5 }}>
                        <SheetProvider sheet={scene1Sheet}>
                            <SceneOne_mobile startPoint={getNextSceneStartPoint()} unloadPoint={39} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>

                    </Canvas>}


            </div>
            <Status />
        </>

    )

}

export default HomePage;

