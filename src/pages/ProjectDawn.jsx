import Status, { getNextSceneStartPoint } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { SheetProvider } from '@theatre/r3f';
import scene6State from '../scene6.json';
import SceneSix from './SceneSix';
import { getProject } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';


function ProjectDawn({ vrSupported, isPortraitPhoneScreen }) {
    const scene6Project = getProject('Scene6', { state: scene6State });
    const scene6Sheet = scene6Project.sheet('Scene6');

    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - Scene6: Tim's final backup plan - Project Dawn</title>
                <meta name="description" content="Join Tim Bi in Scene 6 of his thrilling adventure, where the fate of his ship hangs by a thread. Facing imminent destruction, you activates Tim's final plan – Project Dawn – to escape the gravitational pull of a dying star." />
                <meta name="keywords" content="Tim Bi, Tianyuan Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - Scene6: Tim's final backup plan - Project Dawn" />
                <meta property="og:description" content="Join Tim Bi in Scene 6 of his thrilling adventure, where the fate of his ship hangs by a thread. Facing imminent destruction, you activates Tim's final plan – Project Dawn – to escape the gravitational pull of a dying star." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_captains_chamber" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_captains_chamber" />
                <meta name="author" content="Tim Bi" />

            </Helmet>

            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider>

                    {/* <Canvas gl={{ antialias: antialias, preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={dpr} performance={{ min: 0.5 }} mode="concurrent" fallback={<div>Sorry no WebGL supported!</div>}> */}
                    <SheetProvider sheet={scene6Sheet}>
                        <SceneSix scene6Sheet={scene6Sheet} scene6Project={scene6Project} startPoint={getNextSceneStartPoint()} isPortraitPhoneScreen={isPortraitPhoneScreen} /></SheetProvider>

                    {/* </Canvas> */}
                </CanvasProvider>
            </div>

            <Status />
        </>
    )

}

export default ProjectDawn;

