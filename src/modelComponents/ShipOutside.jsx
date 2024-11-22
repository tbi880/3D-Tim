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

    // useEffect(() => {
    //     // 组件卸载时的清理逻辑
    //     return () => {
    //         // 遍历并清理几何体
    //         if (shipModel.nodes) {
    //             Object.values(shipModel.nodes).forEach(node => {
    //                 if (node.geometry) {
    //                     node.geometry.dispose();
    //                 }
    //             });
    //         }

    //         // 遍历并清理材质
    //         if (shipModel.materials) {
    //             Object.values(shipModel.materials).forEach(material => {
    //                 if (material.dispose) {
    //                     material.dispose();
    //                 }
    //             });
    //         }

    //         // 如果有纹理，也应该进行遍历和清理
    //         if (shipModel.textures) {
    //             Object.values(shipModel.textures).forEach(texture => {
    //                 if (texture.dispose) {
    //                     texture.dispose();
    //                 }
    //             });
    //         }
    //     };

    // }, [shipModel]);


    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [shipModel.scene, opacity]);

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

// useGLTF.preload(bucketURL + "oas.glb");
export default ShipOutside;
