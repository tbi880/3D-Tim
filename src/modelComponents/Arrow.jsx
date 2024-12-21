import { useEffect, useState, useCallback, useRef, useContext } from 'react';
import { useGLTF, useAnimations, useCursor } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';


const animationNames = ["CINEMA_4D_Main"];


function Arrow({ screenTitle, isNext, position, rotation, sequence, stopPoints, disableUnnecessaryComponentAnimation }) {
    const arrowModel = useGLTF(bucketURL + "arrow-transformed.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const { animations, scene } = arrowModel;
    const { actions } = useAnimations(animations, scene);
    const theatreKey = ("arrow: " + screenTitle + (isNext ? " Next" : " Back")).trim();
    const sphereRef = useRef(); // Ref for the clickable sphere
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);


    const play = useCallback(() => {
        let currentTimePosition = sequence.position;
        if (!stopPoints.includes(currentTimePosition) && currentTimePosition !== 0 && currentTimePosition !== stopPoints[0] - 0.5) {
            return;
        }
        for (let i = 0; i < stopPoints.length; i++) {
            if (currentTimePosition < stopPoints[i]) {
                playOnce({ sequence: sequence, range: [currentTimePosition, stopPoints[i]] });
                break;
            }
        }
    }, [sequence, stopPoints]);

    const [hovered, hover] = useState(false);
    useCursor(hovered);



    useEffect(() => {
        arrowModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [arrowModel.scene, opacity]);


    useEffect(() => {

        if (disableUnnecessaryComponentAnimation) {
            actions[animationNames[0]].stop();
        } else {
            actions[animationNames[0]].play();
        }
        // 当组件卸载时，停止动画循环
        return () => {
            actions[animationNames[0]].stop();
        };
    }, [disableUnnecessaryComponentAnimation]); // 确保这个useEffect只执行一次


    return (
        <>
            {/* <e.mesh theatreKey={theatreKey} scale={0.01} position={position} rotation={rotation} onClick={play} */}
            <e.mesh theatreKey={theatreKey} scale={0.01} position={position} rotation={rotation} onClick={play} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)}

                additionalProps={{
                    opacity: types.number(opacity, {
                        range: [0, 1],
                    }),
                }} objRef={(theatreObject) => {
                    // 监听Theatre.js中透明度的变化
                    theatreObject.onValuesChange((newValues) => {
                        setOpacity(newValues.opacity);
                    });
                }}>
                <primitive object={arrowModel.scene} />
            </e.mesh>
            {/* Additional Sphere for easier clicking */}
            <e.mesh theatreKey={theatreKey + " sphereBG"} ref={sphereRef} position={position}
                scale={[1, 1, 1]}
                onClick={play} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)}>
                {/* <e.mesh theatreKey={theatreKey + " sphereBG"} ref={sphereRef} position={position}
                scale={[1, 1, 1]}
                onClick={play} > */}
                <sphereGeometry args={[10, 32, 32]} />
                <meshStandardMaterial color="skyblue" transparent opacity={0} /> {/* 透明度设置为1（不透明）每次复制记得调整这个数字！！！不然看不见！！！ */}
            </e.mesh>
        </>
    );
}

useGLTF.preload(bucketURL + "arrow-transformed.glb");
export default Arrow;
