
import { useState, useCallback } from 'react';
import { getNextSceneStartPoint } from '../pages/Status';
import Header from '../Tools/Header';
import Status from '../pages/Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import SceneOne from '../pages/SceneOne';
import scene1State from '../scene1.json';
import { SheetProvider } from '@theatre/r3f';
import XrToolMiddleLayer from '../Tools/XrToolMiddleLayer';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import { getProject } from '@theatre/core';
import { useJumpToNextScene } from '../hooks/useJumpToNextScene';



function HomePage({ isPortraitPhoneScreen }) {

    const scene1Project = getProject('Scene1 Sheet', { state: scene1State });
    const scene1Sheet = scene1Project.sheet('Scene1 Sheet');

    const [showComponents, setShowComponents] = useState({
        header: true,
    });

    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));

    }, []);

    const { checkThenJumpToTheNextScene } = useJumpToNextScene();

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene1: Tim Bi's story starts here</title>
                <meta name="description" content="Ready for a 3D ride in Tim Bi's universe? I think you would know me very well after you finish this 'adventure'" />
                <meta name="keywords" content="Tim Bi, 毕天元, Tianyuan Bi" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene1: Tim Bi's story starts here" />
                <meta property="og:description" content="Ready for a 3D ride in Tim Bi's universe? I think you would know me very well after you finish this 'adventure'" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Welcome to Tim Bi's world - Scene1: Tim Bi's story starts here" />
                <link rel="canonical" href="https://www.bty.co.nz/" />
                <meta name="author" content="Tim Bi" />

            </Helmet>
            {showComponents.header && <Header onAnimationEnd={() => toggleComponentDisplay("header")} />}
            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>

                <CanvasProvider vrEnabled={true}>
                    <XrToolMiddleLayer>

                        <SheetProvider sheet={scene1Sheet}>
                            <SceneOne scene1Sheet={scene1Sheet} scene1Project={scene1Project} startPoint={getNextSceneStartPoint()} isPortraitPhoneScreen={isPortraitPhoneScreen} unloadPoint={39} onSequencePass={() => checkThenJumpToTheNextScene()} /></SheetProvider>
                    </XrToolMiddleLayer>
                </CanvasProvider>

            </div >
            <Status />
        </>

    )

}

export default HomePage;

