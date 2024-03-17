import { useGLTF } from '@react-three/drei'
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';
import { types } from '@theatre/core';
import { bucketURL } from '../Settings';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useAnimations } from '@react-three/drei';

const animationName = "Take 01";

function Tunnel({ unloadPoint, sequence, onSequencePass }) {
    const tunnelModel = useGLTF(bucketURL + "tunnel2.glb", true, true)
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const animation1 = useAnimations(tunnelModel.animations, tunnelModel.scene)
    const action1 = animation1.actions[animationName]

    useFrame(() => {
        action1.play()
        action1.timeScale = 1;
    })


    useEffect(() => {
        tunnelModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [tunnelModel.scene, opacity]);


    useFrame(() => {
        if (sequence && sequence.position >= unloadPoint) {
            onSequencePass();
        }
    });


    return (<>
        <e.mesh scale={1} theatreKey="Tunnel" additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
            });
        }}>
            <primitive object={tunnelModel.scene} />
        </e.mesh>

    </>
    )
}

export default Tunnel;
