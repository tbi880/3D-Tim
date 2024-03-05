import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';


// const animationNames = ["Animation"];


const ShipOutside = () => {
    const shipModel = useGLTF(bucketURL + "oas.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    // const { animations, scene } = shipModel;
    // const { actions } = useAnimations(animations, scene);




    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [shipModel.scene, opacity]);

    // useFrame(() => {
    //     const action = actions[animationNames[0]];
    //     action.play();
    //     action.timeScale = 0.3;
    // });


    return (
        <>
            <e.mesh theatreKey="ShipOutside" scale={0.01} additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
            }} objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                });
            }}>
                <primitive object={shipModel.scene} position={[550, -30, 0]} />
            </e.mesh>
        </>
    );
}

useGLTF.preload(bucketURL + "oas.glb");
export default ShipOutside;
