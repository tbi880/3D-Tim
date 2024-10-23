import { useGLTF } from '@react-three/drei'
import { editable as e } from '@theatre/r3f';
import { bucketURL } from '../Settings';

function Galaxy({ sequence }) {
    const galaxyModel = useGLTF(bucketURL + "galaxy.glb", true, true)


    return (<>
        <e.mesh scale={1000} theatreKey="galaxy" >
            <primitive object={galaxyModel.scene} position={[-2.5, -1.4, 1.5]} />

        </e.mesh>

    </>
    )
}

export default Galaxy
