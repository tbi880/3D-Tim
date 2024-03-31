
import SceneManager from './SceneManager';
import { useState, useCallback } from 'react';
import { getNextScene } from './Status';
import Header from '../Tools/Header';
import Status from './Status';
import { stageOfENV } from '../Settings';
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'
import 'bootstrap/dist/css/bootstrap.min.css';

if (stageOfENV != "prod") {

    studio.initialize()
    studio.extend(extension)
}





function HomePage() {

    const [showComponents, setShowComponents] = useState({
        header: true,
    });

    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));

    }, []);

    return (
        <>
            {showComponents.header && (getNextScene() == "sceneOne") && <Header onAnimationEnd={() => toggleComponentDisplay("header")} />}
            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <SceneManager />
            </div>
            <Status />
        </>
    )

}

export default HomePage;

