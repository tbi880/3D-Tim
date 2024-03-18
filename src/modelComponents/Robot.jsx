import { useGLTF } from "@react-three/drei";
import * as THREE from 'three';
import { useEffect, useState } from 'react';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import { useAnimations } from "@react-three/drei";

const animation = "Scene";

function Robots({ title, position, rotation, sequence, unloadPoint, onSequencePass }) {
    const robotModel = useGLTF(bucketURL + "robot-transformed.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKey = ("Robots-" + title).trim();
    const animation1 = useAnimations(robotModel.animations, robotModel.scene)
    const action1 = animation1.actions[animation]

    useFrame(() => {
        action1.play()
        action1.timeScale = 1;
    })

    useEffect(() => {
        // 组件卸载时的清理逻辑
        return () => {
            // 遍历并清理几何体
            if (robotModel.nodes) {
                Object.values(robotModel.nodes).forEach(node => {
                    if (node.geometry) {
                        node.geometry.dispose();
                    }
                });
            }

            // 遍历并清理材质
            if (robotModel.materials) {
                Object.values(robotModel.materials).forEach(material => {
                    if (material.dispose) {
                        material.dispose();
                    }
                });
            }

            // 如果有纹理，也应该进行遍历和清理
            if (robotModel.textures) {
                Object.values(robotModel.textures).forEach(texture => {
                    if (texture.dispose) {
                        texture.dispose();
                    }
                });
            }
        };

    }, [robotModel]);

    useEffect(() => {
        robotModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [robotModel.scene, opacity]);

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
                <primitive object={robotModel.scene} />
            </e.mesh>
        </>
    );


}
// useGLTF.preload(bucketURL + "robot-transformed.glb");
export default Robots;