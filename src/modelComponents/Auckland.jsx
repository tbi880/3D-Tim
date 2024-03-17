import { useGLTF } from '@react-three/drei'
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';
import { types } from '@theatre/core';
import { bucketURL } from '../Settings';
import { useEffect, useState } from 'react';
import * as THREE from 'three';

function Auckland({ unloadPoint, sequence, onSequencePass }) {
    const aucklandModel = useGLTF(bucketURL + "auckland.glb", true, true)
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）

    useEffect(() => {
        aucklandModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [aucklandModel.scene, opacity]);


    useFrame(() => {
        if (sequence && sequence.position >= unloadPoint) {
            onSequencePass();
        }
    });


    return (<>
        <e.mesh scale={1} theatreKey="Auckland" additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
            });
        }}>
            <primitive object={aucklandModel.scene} position={[0.9, 0, -6]} />
        </e.mesh>

    </>
    )
}

// useGLTF.preload(bucketURL + "auckland.glb");
export default Auckland;
