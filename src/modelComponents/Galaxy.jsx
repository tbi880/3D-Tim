import { useGLTF } from '@react-three/drei'
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { bucketURL } from '../Settings';

function Galaxy({ sequence, onSequencePass }) {
    const galaxyModel = useGLTF(bucketURL + "galaxy.glb", true, true)
    const checkPoint = useRef(true);

    useFrame(() => {
        if (checkPoint.current) {
            if (sequence && sequence.position >= 30.5) {
                checkPoint.current = false;
                onSequencePass();
            }
        }
    });


    return (<>
        <e.mesh scale={1000} theatreKey="galaxy" >
            <primitive object={galaxyModel.scene} position={[-2.5, -1.4, 1.5]} />

        </e.mesh>

    </>
    )
}

export default Galaxy
