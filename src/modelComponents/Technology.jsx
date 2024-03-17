import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { TextureLoader } from 'three';
import { Sphere, Plane } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { useEffect } from 'react';

function Technology({ title, imagePath }) {
    const texture = useLoader(TextureLoader, imagePath);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; // 防止图片重复

    useEffect(() => {
        return () => {
            texture.dispose();
        };
    }, [texture]);

    return (
        <e.mesh theatreKey={"technology-" + title} scale={0.1}>
            <Sphere args={[0.4, 32, 32]}>
                {/* 可以添加一些材料或属性给球体 */}
            </Sphere>
            <Plane args={[0.5, 0.5]} position={[0, 0, 0.5]} rotation={[0, 0, 0]}>
                {/* Plane的尺寸可以根据需要调整 */}
                <meshBasicMaterial attach="material" map={texture} transparent={true} />
            </Plane>
        </e.mesh>
    );
}

export default Technology;
