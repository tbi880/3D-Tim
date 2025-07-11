import { useEffect, useState, useCallback, useRef, useContext } from 'react';
import { useGLTF, useAnimations, useCursor } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { bucketURL } from '../Settings';
import { setNextScene, setNextSceneStartPoint, unlockScene } from '../pages/Status';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';

const animationNames = ["Armature|off state"];


function ViewPort({ screenTitle, position, rotation, sequence, stopPoint, unloadPoint, onSequencePass, isSetNextScene, nextScene, nextSceneStartPoint = 0 }) {
    const ViewPortModel = useGLTF(bucketURL + "viewport.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const { animations, scene } = ViewPortModel;
    const { actions } = useAnimations(animations, scene);
    const sphereRef = useRef(); // Ref for the clickable sphere
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);



    const theatreKey = ("ViewPort: " + screenTitle).trim();

    useEffect(() => {
        scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [scene, opacity]);

    // given the model is loaded, compute the bounds tree for each mesh
    useEffect(() => {
        if (!scene) return;
        scene.traverse((child) => {
            if (child.isMesh) {
                const geometry = child.geometry;
                if (!geometry.boundsTree) {
                    geometry.computeBoundsTree();
                }
                child.castShadow = false; // Disable shadow casting for the arrow mesh
                child.receiveShadow = false; // Disable shadow receiving for the arrow mesh
                child.frustumCulled = true; // Enable frustum culling for the arrow mesh
            }
        });
    }, [scene]);

    useEffect(() => {
        const action = actions[animationNames[0]];
        action.play();
    }, []);

    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position >= unloadPoint) {
            onSequencePass(); // 调用从父组件传递的函数来卸载自己
        }
    });


    const play = useCallback(() => {
        let currentTimePosition = sequence.position;

        if (currentTimePosition < stopPoint) {
            playOnce({ sequence: sequence, range: [currentTimePosition, stopPoint] });
        }

        if (isSetNextScene) {
            setNextScene(nextScene);
            setNextSceneStartPoint(nextSceneStartPoint);
            unlockScene(nextScene);
            //console.log("Next Scene: " + getNextScene() + " Start Point: " + getNextSceneStartPoint());
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
                <meshStandardMaterial color="skyblue" transparent opacity={0} /> {/* 透明度设置为1（不透明）测试的时候可以设置，记得改回0 */}
            </e.mesh>
        </>
    );
}

// useGLTF.preload(bucketURL + "viewport.glb");
export default ViewPort;
