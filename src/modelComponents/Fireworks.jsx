import { useGLTF, useAnimations } from '@react-three/drei'
import { bucketURL } from '../Settings';
import { editable as e } from '@theatre/r3f';
import { useEffect } from 'react';

const animationnames = ["Object_0"]


const Fireworks = () => {
    const fireworksModel = useGLTF(bucketURL + "toJessie/fireworks-transformed.glb", true, true)
    const theatreKey = ("Fireworks");
    const animation1 = useAnimations(fireworksModel.animations, fireworksModel.scene)
    const action1 = animation1.actions[animationnames[0]]

    useEffect(() => {
        action1.play()
        action1.timeScale = 2;
    })

    return (<>
        <e.mesh theatreKey={theatreKey} scale={5} position={[0, 0, 0]} rotation={[0, 0, 0]} >
            <primitive object={fireworksModel.scene} />

        </e.mesh>
    </>
    )
}


export default Fireworks

