
import SceneManager from './SceneManager';
import Status from './Status';
import { stageOfENV } from '../Settings';
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'

if (stageOfENV != "prod") {

    studio.initialize()
    studio.extend(extension)
}





function HomePage() {

    return (
        <>
            <SceneManager />
            <Status />
        </>

    )

}

export default HomePage;

