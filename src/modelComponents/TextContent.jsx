import { useEffect, useState } from 'react';
import { useLoader, extend } from '@react-three/fiber';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';

const fontFile = "fonts/Play_Regular.json";

extend({ TextGeometry });

function TextContent({ title, order, lines, color, size, position = [0, 0, 0], rotation = [0, 0, 0], }) {
    const font = useLoader(FontLoader, fontFile); // 使用useLoader来加载字体
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）

    // 使用Effect确保在字体加载后应用透明度
    useEffect(() => {
        // 这里不需要额外操作，因为透明度将通过Theatre.js动态控制
    }, [font]);

    const theatreKeyText = ("TextContent: " + title + order).trim();



    return (
        <e.mesh theatreKey={theatreKeyText} position={position} rotation={rotation} additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
            });
        }}>
            {lines.map((line, index) => (
                <mesh key={index} position={[0, -(index * size * 1.3), 0]}>
                    <textGeometry args={[line, { font: font, size: size, height: 0, curveSegments: 12 }]} />
                    <meshStandardMaterial color={color} transparent={true} opacity={opacity} />
                </mesh>
            ))}
        </e.mesh>
    );
}

export default TextContent;
