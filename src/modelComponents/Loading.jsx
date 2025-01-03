import { bucketURL } from '../Settings';
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';
import { useEffect, useState } from 'react'
import { useGLTF, useAnimations, RoundedBox } from '@react-three/drei'
import TextTitle from './TextTitle';
import { types } from '@theatre/core';
import TextTitle_v2 from './TextTitle_v2';


const animationNames = ["Take 01"];

export function Loading({ THkey, title, lines, position, rotation, sequence, onSequencePass, unloadPoint, textTitleVersion = 1 }) {
  const loadingModel = useGLTF(bucketURL + "loading.glb")
  const { animations, scene } = loadingModel;
  const { actions } = useAnimations(animations, scene);

  const theatreKey = THkey ? THkey : ("Loading: " + title).trim();
  const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）

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

  return (<>
    <e.mesh theatreKey={theatreKey} scale={0.5} position={position} rotation={rotation} >
      <primitive object={loadingModel.scene} />
    </e.mesh>
    {textTitleVersion === 1 && <><TextTitle text={lines[0]} color="#00FFFF" size={0.1} position={position} rotation={rotation} />
      <TextTitle text={lines[1]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 0.5, position[2]]} rotation={rotation} />
      <TextTitle text={lines[2]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 1, position[2]]} rotation={rotation} />
    </>}
    {textTitleVersion === 2 && <><TextTitle_v2 theatreKey={(THkey + " " + lines[0]).trim()} text={lines[0]} color="#00FFFF" size={0.1} position={position} rotation={rotation} />
      <TextTitle_v2 theatreKey={(THkey + " " + lines[1]).trim()} text={lines[1]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 0.5, position[2]]} rotation={rotation} />
      <TextTitle_v2 theatreKey={(THkey + " " + lines[2]).trim()} text={lines[2]} color="#00FFFF" size={0.1} position={[position[0], position[1] - 1, position[2]]} rotation={rotation} />
    </>}
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
      <RoundedBox args={[15, 15, 0.1]} radius={0.01} smoothness={4} >
        {/* 应用动态透明度到材质 */}
        <meshStandardMaterial attach="material" color={"white"} opacity={opacity} transparent={true} />
      </RoundedBox>
    </e.mesh>
  </>

  )
}


export default Loading;