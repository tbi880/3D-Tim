import { useEffect, useState, useRef } from 'react';
import { useLoader, useFrame, extend } from '@react-three/fiber';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import { bucketURL } from '../Settings';

const fontFile = bucketURL + "fonts/Orbitron_Bold.json";
extend({ TextGeometry });


function TextTitle_v2({ theatreKey, text, fontURL, color, size, position = [0, 0, 0], rotation = [0, 0, 0], sequence, unloadPoint, onSequencePass }) {

    const font = useLoader(FontLoader, (fontURL ? bucketURL + fontURL : fontFile)); // 使用useLoader来加载字体
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const theatreKeyText = "TextTitle_v2: " + theatreKey;
    const meshRef = useRef();

    // 使用Effect确保在字体加载后应用透明度
    useEffect(() => {
        if (!theatreKey) {
            console.error("TextTitle_v2: key is required");
            return null;
        }
        // 这里不需要额外操作，因为透明度将通过Theatre.js动态控制

    }, [font, theatreKey]);

    useEffect(() => {
        return () => {
            if (meshRef.current) {
                if (meshRef.current.geometry) {
                    meshRef.current.geometry.dispose();
                }
                if (meshRef.current.material) {
                    meshRef.current.material.dispose();
                }
            }
        };
    }, []);

    useFrame(() => {
        if (sequence && sequence.position >= unloadPoint) {
            onSequencePass();
        }
    });

    return (
        <e.mesh ref={meshRef} theatreKey={theatreKeyText} position={position} rotation={rotation} additionalProps={{
            opacity: types.number(opacity, {
                range: [0, 1],
            }),
        }} objRef={(theatreObject) => {
            // 监听Theatre.js中透明度的变化
            theatreObject.onValuesChange((newValues) => {
                setOpacity(newValues.opacity);
            });
        }}>
            <mesh>
                <textGeometry args={[text, { font: font, size: size, height: 0, curveSegments: 12 }]} />
                <meshStandardMaterial color={color} transparent={true} opacity={opacity} />
            </mesh>
        </e.mesh>
    );
}

export default TextTitle_v2;
