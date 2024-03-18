import { useState, useCallback } from 'react';
import { RoundedBox, Text, useCursor } from '@react-three/drei';
import { types } from '@theatre/core';
import { editable as e } from '@theatre/r3f';
import { useFrame } from '@react-three/fiber';

function Button({ title, position, rotation, clickablePoint, jumpToPoint, stopPoint, unloadPoint, sequence, onSequencePass, alertAndNoPlay, alertMessage }) {
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKey = ("Button-" + title).trim();

    useFrame(() => {
        // 当sequence.position超过结束点时触发
        if (sequence && sequence.position > unloadPoint) {
            onSequencePass();
        }
    });


    const play = useCallback(() => {

        // console.log(alertAndNoPlay)
        if (sequence && sequence.position != clickablePoint) {
            return;
        }

        if (alertAndNoPlay) {
            alert(alertMessage);
            return;
        }

        if (jumpToPoint && jumpToPoint < stopPoint) {
            sequence.play({ range: [jumpToPoint, stopPoint] });
        }

    }, [jumpToPoint, stopPoint]);

    const [hovered, setHovered] = useState(false);
    useCursor(hovered);
    const boxColor = hovered ? "#D3D3D3" : "#ffffff"; // 浅灰色为#D3D3D3，否则为白色






    return (
        <e.mesh
            theatreKey={theatreKey}
            position={position}
            rotation={rotation}
            scale={1}

            additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
            }}
            objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                });
            }}
        >
            <RoundedBox args={[1, 0.2, 0.1]} radius={0.05} smoothness={4} onClick={play}
                onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }} // 鼠标悬停时设置hovered为true
                onPointerOut={(e) => { setHovered(false); }}
            >
                {/* 应用动态透明度到材质 */}
                <meshStandardMaterial attach="material" color={boxColor} opacity={opacity} transparent={true} />
            </RoundedBox>
            <Text
                position={[0, 0, 0.055]} // 将文字稍微向前移动，确保它位于RoundedBox的表面之上
                fontSize={0.1}
                color={'#000000'}
                anchorX="center"
                anchorY="middle"
                fillOpacity={opacity}
            >
                {title}
            </Text>
        </e.mesh>
    );
}

export default Button;
