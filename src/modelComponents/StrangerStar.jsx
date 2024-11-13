import { useGLTF, useAnimations } from '@react-three/drei'
import { bucketURL } from '../Settings';
import { useEffect } from 'react';

const animationnames = ["Animation"]


const StrangerStar = () => {
    const starModel = useGLTF(bucketURL + "stranger_star-transformed.glb", true, true)

    const animation1 = useAnimations(starModel.animations, starModel.scene)
    const action1 = animation1.actions[animationnames[0]]

    useEffect(() => {
        action1.play()
        action1.timeScale = 0.3;
    })

    return (<>
        <mesh scale={100}>
            <primitive object={starModel.scene} position={[0, 0, 0]} />

        </mesh>
    </>
    )
}

// useGLTF.preload(bucketURL + "stranger_star-transformed.glb")
export default StrangerStar

