import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { editable as e } from '@theatre/r3f';
import { types } from '@theatre/core';
import * as THREE from 'three';
import { bucketURL } from '../Settings';
import { useFrame } from '@react-three/fiber';


function ShipOutside({ onSequencePass, unloadPoint, sequence }) {
    const shipModel = useGLTF(bucketURL + "oas-transformed.glb", true, true);
    const [opacity, setOpacity] = useState(1); // 初始透明度设置为1（不透明）
    const [wireframe, setWireframe] = useState(false);

    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }, [shipModel.scene, opacity]);

    useEffect(() => {
        shipModel.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material.wireframe = wireframe;
            }
        });
    }, [shipModel.scene, wireframe]);


    // The ship leaves Scene 5 at 20 and returns at 130 (and its 3 textures are the largest in
    // the scene). Free its GPU copies while it is gone; three.js re-uploads them from the
    // cached model when it is shown again.
    useEffect(() => () => {
        shipModel.scene.traverse((child) => {
            if (!child.isMesh) return;
            child.geometry?.dispose();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) {
                if (!material) continue;
                for (const value of Object.values(material)) {
                    if (value && value.isTexture) value.dispose();
                }
            }
        });
    }, [shipModel.scene]);

    useFrame(() => {
        if (unloadPoint) {
            if (sequence && sequence.position > unloadPoint) {
                onSequencePass();
            }
        }
    });

    return (
        <>
            <e.mesh theatreKey="ShipOutside" scale={0.01} additionalProps={{
                opacity: types.number(opacity, {
                    range: [0, 1],
                }),
                wireframe: types.boolean(wireframe, { range: [true, false] })
            }} objRef={(theatreObject) => {
                // 监听Theatre.js中透明度的变化
                theatreObject.onValuesChange((newValues) => {
                    setOpacity(newValues.opacity);
                    setWireframe(newValues.wireframe);
                });
            }}>
                <primitive object={shipModel.scene} position={[550, -30, 0]} />
            </e.mesh>
        </>
    );
}

// useGLTF.preload(bucketURL + "oas-transformed.glb");
export default ShipOutside;
