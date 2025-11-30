import { useEffect, useState, useCallback, useMemo, useRef, useContext } from 'react';
import PropTypes from 'prop-types';
import { useGLTF, useAnimations, useCursor } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';


function AnyModel(props) {
    /*
    传入的props参数：
    modelURL: 模型的URL后缀部分
    useTheatre: 是否使用Theatre.js
    theatreKey: 模型的key（唯一）
    sequence: 用于播放动画的sequence
    stopPoints: 动画停止的点
    clickablePoint: 点击模型触发动画的点
    position: 模型的初始位置
    rotation: 模型的初始旋转
    opacity: 模型的初始透明度
    visible: 模型的初始可见性
    scale: 模型的初始缩放
    unloadPoint: 卸载模型的点
    onSequencePass: 用于卸载模型的函数
    animationNames: 动画的名称
    animationAutoStart: 动画是否自动播放
    animationPlayTimes: 动画的播放次数
    animationSpeeds: 动画的速度
    animationStartPoint: 动画的开始点
    animationOnClick: 是否点击模型触发动画播放
    isMultiple: 是否是多个相同的模型
    modelNodeLoadMap: 模型节点的是否load的map对象 类似{obj_name1:true,obj_name2:false,...}
    modelNodeVisibility: 模型节点的可见性,传入一个usememo的map对象 类似{obj_name1:[unloadOrLoadTime1,unloadOrLoadTime2,unloadOrLoadTime3...]}
    interactablePoints: 数组，包含多个点击触发动画的时间点
    onClickPass: 函数，点击时传递当前时间点给父组件
    onHoldPass: 函数，长按时传递当前时间点给父组件
    holdDuration: 数字，长按的持续时间（毫秒）
    ...
    */
    const anyModel = useGLTF(bucketURL + props.modelURL, true, true);
    const [opacity, setOpacity] = useState(props.opacity !== undefined ? props.opacity : 1);
    const { animations, scene } = anyModel;
    const { actions } = useAnimations(animations, scene);
    const theatreKey = ("[ANY] " + props.theatreKey).trim();
    const [animationIsClicked, setAnimationIsClicked] = useState(props.animationOnClick ? false : true);
    const [isPlaying, setIsPlaying] = useState(false);
    const timeBasedMapForModelNodeVisibilityRef = useRef({});
    const nodesInTransition = useRef(new Map());
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);
    const holdTimerRef = useRef(null);
    const isHoldingRef = useRef(false);
    const pointerDownTimeRef = useRef(0);

    const clone = useMemo(() => {
        if (!anyModel || !anyModel.scene) return null;
        if (!props.isMultiple) return null;
        const c = anyModel.scene.clone(true);

        c.traverse((child) => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) {
                    child.material = child.material.map((m) => m.clone());
                } else if (child.material) {
                    child.material = child.material.clone();
                }
            }
        });

        if (!props.modelNodeLoadMap) return c;

        Object.entries(props.modelNodeLoadMap).forEach(([nodeName, shouldShow]) => {
            if (!shouldShow) {
                const node = c.getObjectByName(nodeName);
                if (node) {
                    node.parent?.remove(node);
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                        node.material.forEach((material) => material.dispose());
                    } else if (node.material) {
                        node.material.dispose();
                    }
                }
            }
        });

        return c;
    }, [anyModel, props.isMultiple, props.modelNodeLoadMap]);

    const targetRoot = props.isMultiple ? clone : anyModel.scene;


    function setNodeOpacity(node, opacity) {
        node.traverse((child) => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => {
                        material.opacity = opacity;
                    });
                } else if (child.material) {
                    child.material.opacity = opacity;
                }
            }
        });
    }

    function setNodeTransparent(node, transparent) {
        node.traverse((child) => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => {
                        material.transparent = transparent;
                    });
                } else if (child.material) {
                    child.material.transparent = transparent;
                }
            }
        });
    }

    useEffect(() => {
        const newTimeBasedMap = {};

        Object.entries(props.modelNodeVisibility).forEach(([objName, times]) => {
            times.forEach((time) => {
                if (!newTimeBasedMap[time]) {
                    newTimeBasedMap[time] = [];
                }
                newTimeBasedMap[time].push(objName);
            });
        });

        timeBasedMapForModelNodeVisibilityRef.current = newTimeBasedMap;
    }, [props.modelNodeVisibility]);

    function toggleNodeVisibilityWithTransition(node) {
        if (!node) return;

        setNodeTransparent(node, true);

        if (node.visible === false) {
            setNodeOpacity(node, 0);
            node.visible = true;

            nodesInTransition.current.set(node, {
                startTime: performance.now(),
                duration: 1000,
                fromOpacity: 0,
                toOpacity: 1,
            });
        } else {
            nodesInTransition.current.set(node, {
                startTime: performance.now(),
                duration: 1000,
                fromOpacity: node.material.opacity || 1,
                toOpacity: 0,
            });
        }
    }

    useFrame(() => {
        if (props.sequence) {
            const currentTimePosition = Math.round(props.sequence.position);
            const timeBasedMap = timeBasedMapForModelNodeVisibilityRef.current;
            if (timeBasedMap[currentTimePosition]) {
                const nodesToToggle = [...timeBasedMap[currentTimePosition]];
                nodesToToggle.forEach((objName) => {
                    const node = targetRoot.getObjectByName(objName);
                    if (node) {
                        toggleNodeVisibilityWithTransition(node);
                    }
                });
                delete timeBasedMap[currentTimePosition];
            }
        }

        const now = performance.now();
        nodesInTransition.current.forEach((transition, node) => {
            const elapsed = now - transition.startTime;
            const t = Math.min(elapsed / transition.duration, 1);
            const opacity = transition.fromOpacity + (transition.toOpacity - transition.fromOpacity) * t;
            setNodeOpacity(node, opacity);

            if (t >= 1) {
                if (transition.toOpacity === 0) {
                    node.visible = false;
                    setNodeOpacity(node, 1);
                }
                nodesInTransition.current.delete(node);
            }
        });
    });

    useEffect(() => {
        if (!targetRoot) return;
        targetRoot.traverse((child) => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => {
                        material.transparent = true;
                        material.opacity = opacity;
                    });
                } else if (child.material) {
                    child.material.transparent = true;
                    child.material.opacity = opacity;
                }
            }
        });
    }, [targetRoot, opacity]);


    // given the model is loaded, compute the bounds tree for each mesh
    useEffect(() => {
        if (!anyModel || !anyModel.scene) return;
        if (!targetRoot) return;
        targetRoot.traverse((child) => {
            if (child.isMesh) {
                const geometry = child.geometry;
                if (!geometry.boundsTree) {
                    geometry.computeBoundsTree();
                }

                child.castShadow = props.castShadow;
                child.receiveShadow = props.receiveShadow;
                child.frustumCulled = props.frustumCulled;
            }
        });
    }, [targetRoot, anyModel, props.castShadow, props.receiveShadow, props.frustumCulled]);

    const play = useCallback(() => {
        let currentTimePosition = props.sequence.position;
        if (currentTimePosition == props.clickablePoint) {
            for (let i = 0; i < props.stopPoints.length; i++) {
                if (currentTimePosition < props.stopPoints[i]) {
                    setAnimationIsClicked(true);
                    playOnce({ sequence: props.sequence, range: [currentTimePosition, props.stopPoints[i]] });
                    break;
                }
            }
        }
    }, [props.sequence, props.stopPoints, props.clickablePoint]);

    const [hovered, hover] = useState(false);

    const isClickable = props.clickablePoint !== null || (props.interactablePoints && props.interactablePoints.length > 0);
    useCursor(isClickable && hovered);

    const eventHandlers = {
        onPointerDown: (e) => {
            if (!isClickable) return;
            e.stopPropagation();
            isHoldingRef.current = true;
            pointerDownTimeRef.current = performance.now();

            const pos = props.sequence.position;

            const isInteractive = props.interactablePoints?.includes(pos);

            if (isInteractive) {
                holdTimerRef.current = setTimeout(() => {
                    if (isHoldingRef.current) {
                        props.onHoldPass(pos);
                    }
                }, props.holdDuration);
            }
        },

        onPointerUp: () => {
            isHoldingRef.current = false;
            clearTimeout(holdTimerRef.current);
        },

        onPointerOut: () => {
            isHoldingRef.current = false;
            clearTimeout(holdTimerRef.current);
            hover(false);
        },

        onPointerOver: (e) => {
            if (isClickable) {
                e.stopPropagation();
                hover(true);
            }
        },
        onClick: (e) => {
            if (props.clickablePoint && play) play();
            if (props.interactablePoints?.length && props.onClickPass) {
                const pos = props.sequence.position;
                if (props.interactablePoints.includes(pos)) {
                    props.onClickPass(pos);
                }
            }
        },
    };

    useEffect(() => {
        return () => {
            if (holdTimerRef.current) {
                clearTimeout(holdTimerRef.current);
            }
        };
    }, []);


    useEffect(() => {
        if (!targetRoot) return;
        targetRoot.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [targetRoot, opacity]);


    useEffect(() => {
        if (!props.useTheatre) {
            // 当useTheatre为false时，监听props.opacity的变化
            setOpacity(props.opacity);
        }
    }, [props.opacity, props.useTheatre]);



    useEffect(() => {
        if (!isPlaying) {
            if (props.animationAutoStart) {
                const action = actions[props.animationNames[0]];
                if (props.animationStartPoint) {

                    action.time = props.animationStartPoint;
                }
                if (props.animationSpeeds) {
                    action.timeScale = props.animationSpeeds;
                }
                action.play();
                setIsPlaying(true);
            }
            else if (props.animationNames && props.animationNames.length != 0) {
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
                    // console.log("action.timeScale", action.timeScale);
                }
            }
        }

        // 当sequence.position超过结束点时触发
        if (props.sequence && props.sequence.position >= props.unloadPoint) {
            props.onSequencePass(); // 调用从父组件传递的函数来卸载自己
        }
    }, [props.animationAutoStart, props.animationNames, props.animationPlayTimes, props.animationSpeeds, props.animationStartPoint, props.sequence, props.unloadPoint, props.onSequencePass, actions, isPlaying, animationIsClicked]);



    return (
        <>{props.useTheatre ?
            <e.mesh theatreKey={theatreKey} scale={
                Array.isArray(props.scale)
                    ? props.scale
                    : typeof props.scale === 'number'
                        ? [props.scale, props.scale, props.scale]
                        : [0.01, 0.01, 0.01] // 默认值
            } position={props.position} rotation={props.rotation} visible={props.visible} {...eventHandlers}

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
                < primitive key={props.key} object={targetRoot} />

            </e.mesh>
            :
            <mesh scale={
                Array.isArray(props.scale)
                    ? props.scale
                    : typeof props.scale === 'number'
                        ? [props.scale, props.scale, props.scale]
                        : [0.01, 0.01, 0.01] // 默认值
            } >
                <primitive
                    object={targetRoot}
                    position={props.position}
                    rotation={props.rotation}
                    visible={props.visible}
                />
                <meshStandardMaterial
                    attach="material"
                    transparent
                    opacity={opacity}
                />
            </mesh>

        }


        </>
    );
}
AnyModel.propTypes = {
    modelURL: PropTypes.string.isRequired,
    useTheatre: PropTypes.bool,
    theatreKey: PropTypes.string,
    sequence: PropTypes.object,
    stopPoints: PropTypes.array,
    clickablePoint: PropTypes.number,
    position: PropTypes.array,
    rotation: PropTypes.array,
    opacity: PropTypes.number,
    visible: PropTypes.bool,
    scale: PropTypes.oneOfType([
        PropTypes.number, // 支持单个数字
        PropTypes.arrayOf(PropTypes.number), // 或者一个数组
    ]), unloadPoint: PropTypes.number,
    onSequencePass: PropTypes.func,
    animationNames: PropTypes.array,
    animationAutoStart: PropTypes.bool,
    animationPlayTimes: PropTypes.number,
    animationSpeeds: PropTypes.number,
    animationStartPoint: PropTypes.number,
    animationOnClick: PropTypes.bool,
    isMultiple: PropTypes.bool,
    modelNodeVisibility: PropTypes.object,
    castShadow: PropTypes.bool,
    receiveShadow: PropTypes.bool,
    frustumCulled: PropTypes.bool,
    interactablePoints: PropTypes.arrayOf(PropTypes.number),
    onClickPass: PropTypes.func,
    onHoldPass: PropTypes.func,
    holdDuration: PropTypes.number,
};

AnyModel.defaultProps = {
    useTheatre: false,
    theatreKey: "",
    sequence: {},
    stopPoints: [],
    clickablePoint: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    opacity: 1,
    visible: true,
    scale: 0.01, // 默认值可以是单个数字    
    unloadPoint: Infinity,
    onSequencePass: () => { },
    animationNames: [],
    animationAutoStart: false,
    animationPlayTimes: 1,
    animationSpeeds: 1,
    animationStartPoint: 0,
    animationOnClick: false,
    isMultiple: false,
    modelNodeVisibility: {},
    castShadow: false,
    receiveShadow: false,
    frustumCulled: true,
    interactablePoints: [],
    onClickPass: () => { },
    onHoldPass: () => { },
    holdDuration: 1000,
};

export default AnyModel;