
import Status, { getNextScene, jumpToTheNextScene } from './Status';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { Canvas } from '@react-three/fiber';
import { SheetProvider } from '@theatre/r3f';
import { scene3Sheet } from './SceneManager';
import SceneThree_mobile from './SceneThree_mobile';
import SceneThree from './SceneThree';





function ShipHanger({ vrSupported, isPortraitPhoneScreen }) {

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
                    <Canvas gl={{ preserveDrawingBuffer: true }} >
                        <XR>
                            <Controllers rayMaterial={{ color: '#99FFFF' }} />
                            <Hands />
                            <SheetProvider sheet={scene3Sheet}>
                                <SceneThree isVRSupported={vrSupported} unloadPoint={64} onSequencePass={() => jumpToTheNextScene(getNextScene())} /></SheetProvider>

                        </XR>



                    </Canvas>

                </>}

                {!vrSupported &&
                    <Canvas gl={{ preserveDrawingBuffer: true }} >
                        <SheetProvider sheet={scene3Sheet}>
                            <SceneThree_mobile unloadPoint={64} onSequencePass={() => jumpToTheNextScene(getNextScene())} /></SheetProvider>

                    </Canvas>}


            </div>
            <Status />
        </>
    )

}

export default ShipHanger;
