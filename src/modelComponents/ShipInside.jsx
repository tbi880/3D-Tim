import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';



function ShipInside({ sequence, unloadPoint, onSequencePass }) {
    const { scene } = useGLTF("./shipinside.glb", true, true);
    const [opacity, setOpacity] = useState(0); // 初始透明度设置为1（不透明）

    useEffect(() => {
        scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [scene, opacity]);


    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position > unloadPoint) {
            onSequencePass();
        }
    });


    return (
        <>
            <e.mesh theatreKey="ShipInside" scale={1} additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
            }} objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                });
            }}>
                <primitive object={scene} position={[550, -30, 0]} />
            </e.mesh>
        </>
    );
}

useGLTF.preload("./shipinside.glb");
export default ShipInside;
