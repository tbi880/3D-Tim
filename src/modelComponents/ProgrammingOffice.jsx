import { useGLTF } from "@react-three/drei";
import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';



function ProgrammingOffice({ position, rotation, sequence, unloadPoint, onSequencePass }) {
    const officeModel = useGLTF(bucketURL + "office_setup.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKey = "office scene";


    useEffect(() => {
        officeModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [officeModel.scene, opacity]);

    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position > unloadPoint) {
            onSequencePass();
        }
    });



    return (

        <e.mesh theatreKey={theatreKey} scale={1} position={position} rotation={rotation} additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
            });
        }}>
            <primitive object={officeModel.scene} scale={[0.01, 0.01, 0.01]} />
        </e.mesh>

    );


}

// useGLTF.preload(bucketURL + "office_setup.glb");
export default ProgrammingOffice;