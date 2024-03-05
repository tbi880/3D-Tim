import { useEffect, useState, useCallback, useRef } from 'react';
import { useGLTF, useAnimations, useCursor } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';


const animationNames = ["Armature|off state"];


function ViewPort({ screenTitle, position, rotation, sequence, stopPoint, unloadPoint, onSequencePass }) {
    const ViewPortModel = useGLTF("https://f005.backblazeb2.com/file/tim3Dweb/viewport.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const { animations, scene } = ViewPortModel;
    const { actions } = useAnimations(animations, scene);
    const sphereRef = useRef(); // Ref for the clickable sphere


    const theatreKey = "ViewPort: " + screenTitle;

    useEffect(() => {
        ViewPortModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [ViewPortModel.scene, opacity]);

    useFrame(() => {
        const action = actions[animationNames[0]];
        action.play();
    });

    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position >= unloadPoint) {
            onSequencePass(); // 调用从父组件传递的函数来卸载自己
        }
    });


    const play = useCallback(() => {
        let currentTimePosition = sequence.position;

        if (currentTimePosition < stopPoint) {
            sequence.play({ range: [currentTimePosition, stopPoint] });
        }

    }, [sequence, stopPoint]);

    const [hovered, hover] = useState(false);
    useCursor(hovered);

    return (
        <>

            {/* <e.mesh theatreKey={theatreKey} scale={0.00001} position={position} rotation={rotation} onClick={play} additionalProps={{ */}
            <e.mesh theatreKey={theatreKey} scale={0.00001} position={position} rotation={rotation} onClick={play} onPointerOver={(e) => (e.stopPropagation(), hover(true))} additionalProps={{

                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
            }} objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                });
            }}>
                <primitive object={ViewPortModel.scene} />
            </e.mesh>
            {/* Additional Sphere for easier clicking */}
            <e.mesh theatreKey={theatreKey + " sphereBG"} ref={sphereRef} position={position}
                scale={[1, 1, 1]}
                onClick={play} onPointerOver={() => hover(true)} onPointerOut={() => hover(false)}>
                {/* onClick={play}> */}
                <sphereGeometry args={[10, 32, 32]} />
                <meshStandardMaterial color="skyblue" transparent opacity={0} />
            </e.mesh>
        </>
    );
}

useGLTF.preload("https://f005.backblazeb2.com/file/tim3Dweb/viewport.glb");
export default ViewPort;
