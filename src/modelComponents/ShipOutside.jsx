import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';


function ShipOutside({ onSequencePass, unloadPoint, sequence }) {
    const shipModel = useGLTF(bucketURL + "oas.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const [wireframe, setWireframe] = useState(false);

    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [shipModel.scene, opacity]);

    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.wireframe = wireframe;
            }
        });
    }, [shipModel.scene, wireframe]);


    useFrame(() => {
        if (unloadPoint) {
            if (sequence && sequence.position > unloadPoint) {
                onSequencePass();
            }
        }
    });

    return (
        <>
            <e.mesh theatreKey="ShipOutside" scale={0.01} additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
                wireframe: types.boolean(wireframe, { range: [true, false] })
            }} objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                    setWireframe(newValues.wireframe);
                });
            }}>
                <primitive object={shipModel.scene} position={[550, -30, 0]} />
            </e.mesh>
        </>
    );
}

// useGLTF.preload(bucketURL + "oas.glb");
export default ShipOutside;
