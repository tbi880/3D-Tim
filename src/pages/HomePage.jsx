import { Canvas } from '@react-three/fiber';
import Loader from './Loader';
import StrangerStar from '../modelComponents/StrangerStar';
import ShipOutside from '../modelComponents/ShipOutside';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import InfoScreenDisplayStarShipInfoLoadManager from '../modelComponents/infoScreenDisplayStarShipInfoLoadManager';
import ViewPort from '../modelComponents/ViewPort';
import Music from '../modelComponents/Music';
import { Suspense, useState, useCallback, useEffect } from 'react';
import projectState from '../theatre-project-state5.json'

import PreloadAssets from '../modelComponents/preloadAssets';


import { getProject } from '@theatre/core'

// our Theatre.js project sheet, we'll use this later
const holoSheet = getProject('Holo Project', { state: projectState }).sheet('Holo Sheet')


import { editable as e, PerspectiveCamera, SheetProvider } from '@theatre/r3f'

// import studio from '@theatre/studio'
// import extension from '@theatre/r3f/dist/extension'

// studio.initialize()
// studio.extend(extension)





function HomePage() {
    const [year, setYear] = useState(new Date().getFullYear());
    const [month, setMonth] = useState(new Date().getMonth());
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    const monthName = monthNames[month];

    const screenWelcomeContent = "You are about to awaken on a starship that has been voyaging for centuries. The course has been mysteriously affected by an external force. Please click on the 'Next' button down below(>>>).        Good! Now you have a basic idea of how to use this 3D website. Please enjoy the trip. Hopefully, we can see each other face to face in AD " + year + " " + monthName + " in NZ on earth!";

    const screenStarShipInfo = "This starship, laden with humanity's hopes, pioneers space exploration with true self-learning, multi-purpose AI robots. Each AI holds a unique role: service AIs cater to the needs of all on board, maintenance AIs ensure the ship's upkeep, and research AIs delve into cutting-edge theories, transforming them into technologies that not only prevent the ship from deteriorating over its millennia-long journey but also significantly enhance its capabilities through expansions and upgrades. This visionary approach originated from the ship's first captain,whose name is Tim Bi(2001-21??), a renowned computer scientist on Earth whose early life remains largely unknown. His obscure past forms the basis of the root access questions for the ship's control system, without which altering the ship's course or initiating emergency stops is impossible. As the ship's chief engineer, it falls to you to unearth these ancient records to avert a catastrophic fate from powerful gravitational forces."
    // 使用一个对象来管理多个组件的初始显示状态
    const [showComponents, setShowComponents] = useState({
        textTitleAD32101: true,
        textTitleOuterArm: true,
        textTitleApproximately: true,
        infoScreenWelcome: true,
        shipInside: false,
        shipOutside: true,
        viewPortStarShipInfo: true,
        infoScreenDisplayStarShipInfo: false,
        // 可以添加更多组件的初始显示状态
        // 例如: otherComponent: true,
    });

    // 创建一个通用的切换函数
    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));

    }, []);


    return (
        <>
            <Canvas gl={{ preserveDrawingBuffer: true }} >

                <PreloadAssets />

                <SheetProvider sheet={holoSheet}>
                    <Suspense fallback={<Loader />}>
                        <Music sequence={holoSheet.sequence} lowVolumePoints={[30]} highVolumePoints={[0.034, 33]} />
                        <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault position={[498, -19, -61]} rotation={[0, 1.55, 0]} fov={75} near={0.01} />
                        <ambientLight />
                        <ambientLight />
                        <color attach='background' args={['black']} />

                        <ambientLight />

                        {/* <Axes /> */}
                        <Galaxy />
                        <StrangerStar />
                        <ShipOutside sequence={holoSheet.sequence} onSequencePass={() => toggleComponentDisplay('shipOutside')} />
                        {showComponents.infoScreenWelcome && (<InfoScreenDisplay title="Welcome" content={screenWelcomeContent} sequence={holoSheet.sequence} stopPoints={[0.034, 27.5]} loadPoints={[0, 0.033]} unloadPoints={[0.034, 2.5]} onSequencePass={() => toggleComponentDisplay('infoScreenWelcome')} />)}


                        {showComponents.textTitleAD32101 && (<TextTitle text="AD 32101" color="#FFD700" size={1} sequence={holoSheet.sequence} unloadPoint={5} onSequencePass={() => toggleComponentDisplay('textTitleAD32101')} />)}
                        {showComponents.textTitleOuterArm && (<TextTitle text="Outer arm of the galaxy" color="#FFD700" size={1} sequence={holoSheet.sequence} unloadPoint={9} onSequencePass={() => toggleComponentDisplay('textTitleOuterArm')} />)}
                        {showComponents.textTitleApproximately && (<TextTitle text="Approximately 18,000 light years from Earth" color="#FFD700" size={1} sequence={holoSheet.sequence} unloadPoint={15} onSequencePass={() => toggleComponentDisplay('textTitleApproximately')} />)}

                        {showComponents.viewPortStarShipInfo && (<ViewPort screenTitle={"StarShip Info"} position={[745, -16, 38]} rotation={[-1.13, -0.654, 5.2]} sequence={holoSheet.sequence} stopPoint={30} unloadPoint={37} onSequencePass={() => toggleComponentDisplay('viewPortStarShipInfo')} />)}
                        <InfoScreenDisplayStarShipInfoLoadManager sequence={holoSheet.sequence} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />
                        {showComponents.infoScreenDisplayStarShipInfo && (<InfoScreenDisplay title={"Starship Info"} content={screenStarShipInfo} sequence={holoSheet.sequence} stopPoints={[30.5, 31, 31.5, 32, 32.5, 39]} loadPoints={[29.5, 30.5, 31, 31.5, 32, 32.5]} unloadPoints={[30.5, 31, 31.5, 32, 32.5, 37]} onSequencePass={() => toggleComponentDisplay('infoScreenDisplayStarShipInfo')} />)}
                    </Suspense>


                    {/* <ShipInsideLoadManager sequence={holoSheet.sequence} onSequencePass={() => toggleComponentDisplay('shipInside')} />
                    {showComponents.shipInside && (<ShipInside sequence={holoSheet.sequence} unloadPoint={60} onSequencePass={() => toggleComponentDisplay('shipInside')} />)} */}


                </SheetProvider>



            </Canvas >
        </>
    )
}

export default HomePage;

