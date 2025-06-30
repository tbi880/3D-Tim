import { useState, useRef } from 'react';
import { Text } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';


function TextContent({ title, order, lines, color, size, position = [0, 0, 0], rotation = [0, 0, 0], }) {
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    // 使用 useRef 来创建一个引用数组
    const meshRefs = useRef([]);
    // 确保引用数组足够长以保存所有行的引用
    meshRefs.current = meshRefs.current.slice(0, lines.length);

    // useEffect(() => {
    //     // 返回一个清理函数，清理所有的 mesh
    //     return () => {
    //         meshRefs.current.forEach(mesh => {
    //             if (mesh) {
    //                 if (mesh.geometry) mesh.geometry.dispose();
    //                 if (mesh.material) mesh.material.dispose();
    //             }
    //         });
    //     };
    // }, []); // 空依赖数组，这个 effect 只在卸载时运行


    const theatreKeyText = ("TextContent: " + title + order).trim();



    return (
        <e.group theatreKey={theatreKeyText} position={position} rotation={rotation} additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
                meshRefs.current.forEach(mesh => {
                    if (mesh) {
                        mesh.visible = newValues.opacity > 0;
                    }
                });
            });
        }}>
            {lines.map((line, index) => (
                <Text
                    key={index}
                    ref={ref => meshRefs.current[index] = ref}
                    position={[0, -(index * size * 1.3), 0]}
                    fontSize={size}
                    color={color}
                    anchorX="left"
                    anchorY="top"
                    textAlign="left"
                    fillOpacity={opacity}
                >
                    {line}
                </Text>
            ))}
        </e.group>
    );
}

export default TextContent;
