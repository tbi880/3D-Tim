import { useContext, useEffect } from "react";
import { graphicSettingContext } from "./GraphicSettingProvider";
import { Canvas, extend } from "@react-three/fiber";
import { webGLPreserveDrawingBuffer } from '../Settings';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { isIOSDevice, IOS_MAX_DPR } from '../utils/deviceProfile';
import { installGLTFMemoryGuard, releaseLoadedModels } from '../utils/gltfMemoryGuard';

extend(THREE);

// Override the raycast method of THREE.Mesh to use accelerated raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// iOS only: cap glTF texture sizes, limit Draco workers, evict cached models between scenes.
installGLTFMemoryGuard();

/*
 * About WebGPU: @react-three/fiber v8 only accepts a renderer that `gl` returns
 * synchronously. The previous async WebGPU factory returned a Promise, so whenever
 * navigator.gpu existed (Chrome/Edge desktop, Safari 26 on macOS/iOS/iPadOS):
 *  - R3F quietly created its own default WebGLRenderer instead (antialias always on,
 *    the graphics-menu antialias setting ignored);
 *  - the unused WebGPURenderer still requested a GPU device and started its own
 *    requestAnimationFrame loop. Neither was ever released, so every scene change left
 *    one more behind.
 * WebGPU needs R3F v9 (async `gl` support) plus a renderer created with `await renderer.init()`.
 */
export const CanvasProvider = ({ children, frameLoopSetting = "always" }) => {
    const { dpr, antialias } = useContext(graphicSettingContext);

    // On iOS the drawing buffer counts towards the page's memory budget.
    const effectiveDpr = isIOSDevice ? Math.min(dpr, IOS_MAX_DPR) : dpr;

    const webGLProps = {
        antialias,
        powerPreference: effectiveDpr > 1 ? "high-performance" : "low-power",
        preserveDrawingBuffer: webGLPreserveDrawingBuffer,
        stencil: false,
    };

    // Leaving the scene: R3F destroys this canvas's WebGL context; also drop the models'
    // CPU-side data (iOS only) so the next scene starts with that memory free.
    useEffect(() => () => releaseLoadedModels(), []);

    return (
        <Canvas
            shadows="variance"
            frameloop={frameLoopSetting}
            dpr={effectiveDpr}
            performance={{ min: 0.25 }}
            mode="concurrent"
            fallback={<div>Sorry no WebGL supported!</div>}
            gl={webGLProps}
            style={{ background: '#000000' }}
        >
            {children}
        </Canvas>
    );
};
