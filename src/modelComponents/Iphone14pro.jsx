import { bucketURL } from '../Settings';
import { editable as e } from '@theatre/r3f';
import { useGLTF } from '@react-three/drei';
import { useContext, useEffect, useState } from 'react';
import * as THREE from 'three';
import { types } from '@theatre/core';
import { useCursor } from '@react-three/drei';
import { useCallback } from 'react';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';


export function Iphone14pro({ title, clickablePoint, sequence }) {
  const { nodes, materials, scene } = useGLTF(bucketURL + 'iphone-transformed.glb');
  const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
  const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);


  const play = useCallback(() => {
    if (sequence && sequence.position === clickablePoint) {
      playOnce({ sequence: sequence, range: [31, 50] });
    }
  }, [sequence, clickablePoint]);

  const [hovered, hover] = useState(false);
  useCursor(hovered);

  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    });
  }, [scene, opacity]);

  return (<e.mesh theatreKey={'Iphone-' + title} scale={[0.1, 0.1, 0.1]} onClick={play} onPointerOver={(e) => (e.stopPropagation(), hover(true))} onPointerOut={() => hover(false)}
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

    <primitive object={scene} />
  </e.mesh>
  )
}

// useGLTF.preload('/iphone14pro-transformed.glb')

export default Iphone14pro;