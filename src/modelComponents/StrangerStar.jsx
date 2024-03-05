import { useGLTF, useAnimations } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'


const animationnames = ["Animation"]


const StrangerStar = () => {
    const starModel = useGLTF("https://f005.backblazeb2.com/file/tim3Dweb/stranger_star.glb", true, true)

    const animation1 = useAnimations(starModel.animations, starModel.scene)
    const action1 = animation1.actions[animationnames[0]]

    useFrame(() => {
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

useGLTF.preload("https://f005.backblazeb2.com/file/tim3Dweb/stranger_star.glb")
export default StrangerStar

