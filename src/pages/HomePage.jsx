import { Canvas } from '@react-three/fiber';
import Loader from './Loader';
import StrangerStar from '../modelComponents/StrangerStar';
import ShipOutside from '../modelComponents/ShipOutside';
import Galaxy from '../modelComponents/Galaxy';
import TextTitle from '../modelComponents/TextTitle';
import InfoScreenDisplay from '../modelComponents/InfoScreenDisplay';
import InfoScreenDisplayStarShipInfoLoadManager from '../modelComponents/infoScreenDisplayStarShipInfoLoadManager';
import ViewPort from '../modelComponents/ViewPort';
import AsyncMusic, { createAudioLoader } from '../modelComponents/AsyncMusic';
import { Suspense, useState, useCallback } from 'react';


import PreloadAssets from '../modelComponents/preloadAssets';

import SceneOne from './SceneOne';
import SceneManager from './SceneManager';




// const scene2Sheet = getProject('Scene2 Sheet').sheet('Scene2 Sheet')




import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'

studio.initialize()
studio.extend(extension)




function HomePage() {

    return (
        <>
            <SceneManager />
        </>

    )

}

export default HomePage;

