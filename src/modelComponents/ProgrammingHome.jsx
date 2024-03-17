import { useGLTF } from "@react-three/drei";
import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import { useAnimations } from "@react-three/drei";

const animations = ["SPEAKER|defaultMaterialAction", "SPEAKER.001|defaultMaterialAction.002"];

function ProgrammingHome({ position, rotation, sequence, unloadPoint, onSequencePass }) {
    const homeModel = useGLTF(bucketURL + "home_setup.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKey = "Home scene";
    const animation1 = useAnimations(homeModel.animations, homeModel.scene)
    const action1 = animation1.actions[animations[0]]
    const action2 = animation1.actions[animations[1]]

    useFrame(() => {
        action1.play()
        action2.play()
    })


    useEffect(() => {
        homeModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [homeModel.scene, opacity]);

    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position > unloadPoint) {
            onSequencePass();
        }
    });



    return (
        <>
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
                <primitive object={homeModel.scene} />
            </e.mesh>
        </>
    );


}
// useGLTF.preload(bucketURL + "home_setup.glb");
export default ProgrammingHome;