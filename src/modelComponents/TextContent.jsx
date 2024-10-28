import { useEffect, useState, useRef } from 'react';
import { useLoader, extend } from '@react-three/fiber';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import { bucketURL } from '../Settings';

const fontFile = bucketURL + "fonts/Play_Regular.json";

extend({ TextGeometry });

function TextContent({ title, order, lines, color, size, position = [0, 0, 0], rotation = [0, 0, 0], }) {
    const font = useLoader(FontLoader, fontFile); // 使用useLoader来加载字体
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    // 使用 useRef 来创建一个引用数组
    const meshRefs = useRef([]);
    // 确保引用数组足够长以保存所有行的引用
    meshRefs.current = meshRefs.current.slice(0, lines.length);

    useEffect(() => {
        // 返回一个清理函数，清理所有的 mesh
        return () => {
            meshRefs.current.forEach(mesh => {
                if (mesh) {
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) mesh.material.dispose();
                }
            });
        };
    }, []); // 空依赖数组，这个 effect 只在卸载时运行

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
                meshRefs.current.forEach(mesh => {
                    if (mesh) {
                        mesh.visible = newValues.opacity > 0;
                    }
                });
            });
        }}>
            {lines.map((line, index) => (
                <mesh key={index} ref={ref => meshRefs.current[index] = ref} position={[0, -(index * size * 1.3), 0]}>
                    <textGeometry args={[line, { font: font, size: size, height: 0, curveSegments: 12 }]} />
                    <meshStandardMaterial color={color} transparent={true} opacity={opacity} />
                </mesh>
            ))}
        </e.mesh>
    );
}

export default TextContent;
