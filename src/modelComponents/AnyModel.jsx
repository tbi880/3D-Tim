import { useEffect, useState, useCallback, useMemo } from 'react';
import { useGLTF, useAnimations, useCursor } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';


function AnyModel(props) {
    /*
    传入的props参数：
    modelURL: 模型的URL后缀部分
    theatreKey: 模型的key（唯一）
    sequence: 用于播放动画的sequence
    stopPoints: 动画停止的点
    clickablePoint: 点击模型触发动画的点
    position: 模型的初始位置
    rotation: 模型的初始旋转
    unloadPoint: 卸载模型的点
    onSequencePass: 用于卸载模型的函数
    animationNames: 动画的名称
    animationPlayTimes: 动画的播放次数
    animationSpeeds: 动画的速度
    animationStartPoint: 动画的开始点
    animationOnClick: 是否点击模型触发动画播放
    isMultiple: 是否是多个相同的模型
    ...
    */
    const anyModel = useGLTF(bucketURL + props.modelURL, true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const { animations, scene } = anyModel;
    const { actions } = useAnimations(animations, scene);
    const theatreKey = ("[ANY] " + props.theatreKey).trim();
    const [animationIsClicked, setAnimationIsClicked] = useState(props.animationOnClick ? false : true);
    const clone = useMemo(() => anyModel.scene.clone(), [anyModel]);
    const [isPlaying, setIsPlaying] = useState(false);

    const play = useCallback(() => {
        let currentTimePosition = props.sequence.position;
        if (currentTimePosition == props.clickablePoint) {
            for (let i = 0; i < props.stopPoints.length; i++) {
                if (currentTimePosition < props.stopPoints[i]) {
                    props.sequence.play({ range: [currentTimePosition, props.stopPoints[i]] });
                    setAnimationIsClicked(true);
                    break;
                }
            }
        }
    }, [props.sequence, props.stopPoints, props.clickablePoint]);

    const eventHandlers = props.clickablePoint ? {
        onClick: play,
        onPointerOver: (e) => (e.stopPropagation(), hover(true)),
        onPointerOut: () => hover(false),
    } : {};




    const [hovered, hover] = useState(false);
    useCursor(hovered);



    useEffect(() => {
        anyModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [anyModel.scene, opacity]);


    useFrame(() => {
        if (!isPlaying) {
            if (props.animationNames && props.animationNames.length != 0) {
                if (animationIsClicked) {
                    const action = actions[props.animationNames[0]];
                    if (props.animationStartPoint) {

                        action.time = props.animationStartPoint;
                    }
                    action.play();

                    setIsPlaying(true);

                    if (props.animationPlayTimes) {
                        action.setLoop(THREE.LoopOnce, props.animationPlayTimes);
                        action.clampWhenFinished = true;
                    }
                    action.timeScale = props.animationSpeeds;
                }
            }
        }

        // 当sequence.position超过结束点时触发
        if (props.sequence && props.sequence.position >= props.unloadPoint) {
            props.onSequencePass(); // 调用从父组件传递的函数来卸载自己
        }
    });



    return (
        <>
            <e.mesh theatreKey={theatreKey} scale={props.scale ? props.scale : 0.01} position={props.position} rotation={props.rotation} {...eventHandlers}

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
                < primitive key={props.key} object={props.isMultiple ? clone : anyModel.scene} />

            </e.mesh>
            {/* Additional Sphere for easier clicking */}
        </>
    );
}

export default AnyModel;
