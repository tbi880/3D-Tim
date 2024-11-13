import { useGLTF } from "@react-three/drei";
import * as THREE from 'three';
import { useContext, useEffect, useState } from 'react';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import { useAnimations } from "@react-three/drei";
import { disableUnnecessaryAnimationContext } from "../sharedContexts/DisableUnnecessaryAnimation";

const animationName = "Take 001";

function ProgrammingFuture({ position, rotation, sequence, unloadPoint, onSequencePass }) {
    const futureModel = useGLTF(bucketURL + "future_office.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKey = "future scene";
    const animation1 = useAnimations(futureModel.animations, futureModel.scene)
    const action1 = animation1.actions[animationName]
    const { disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation } = useContext(disableUnnecessaryAnimationContext);

    useEffect(() => {
        if (disableUnnecessaryComponentAnimation) {
            action1.stop();
        } else {
            action1.play();
            action1.timeScale = 0.1;
        }
        return () => {
            action1.stop();
        };
    }, [disableUnnecessaryComponentAnimation])


    useEffect(() => {
        futureModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [futureModel.scene, opacity]);

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
            <primitive object={futureModel.scene} scale={[1, 1, 1,]} />
        </e.mesh>

    );


}

// useGLTF.preload(bucketURL + "future_office.glb");
export default ProgrammingFuture;