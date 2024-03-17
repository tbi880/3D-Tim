import { bucketURL } from '../Settings';
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';
import React, { useState, useEffect } from 'react'
import { useGLTF, useAnimations, RoundedBox } from '@react-three/drei'
import TextTitle from './TextTitle';
import * as THREE from 'three';
import { types } from '@theatre/core';


const animationNames = ["Take 01"];

export function Loading({ title, lines, position, rotation, sequence, onSequencePass, unloadPoint }) {
  const loadingModel = useGLTF(bucketURL + "loading.glb")
  const { animations, scene } = loadingModel;
  const { actions } = useAnimations(animations, scene);
  const theatreKey = ("Loading: " + title).trim();
  const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）



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

  return (<>
    <e.mesh theatreKey={theatreKey} scale={0.5} position={position} rotation={rotation} >
      <primitive object={loadingModel.scene} />
    </e.mesh>

    <TextTitle text={lines[0]} color="#00FFFF" size={0.1} position={position} rotation={rotation} />
    <TextTitle text={lines[1]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 0.5, position[2]]} rotation={rotation} />
    <TextTitle text={lines[2]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 1, position[2]]} rotation={rotation} />
    <e.mesh theatreKey={'screen blocker' + title} additionalProps={{
      opacity: types.number(opacity, {
        range: [0, 1],
      }),
    }}
      objRef={(theatreObject) => {
        // 监听Theatre.js中透明度的变化
        theatreObject.onValuesChange((newValues) => {
          setOpacity(newValues.opacity);
        });
      }}>
      <RoundedBox args={[10, 10, 0.1]} radius={0.01} smoothness={4} >
        {/* 应用动态透明度到材质 */}
        <meshStandardMaterial attach="material" color={"white"} opacity={opacity} transparent={true} />
      </RoundedBox>
    </e.mesh>
  </>

  )
}

useGLTF.preload(bucketURL + 'loading.glb')
export default Loading;