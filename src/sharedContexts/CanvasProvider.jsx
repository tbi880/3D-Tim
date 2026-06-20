import { useContext, useEffect, useState, useRef } from "react";
import { graphicSettingContext } from "./GraphicSettingProvider";
import { Canvas, extend } from "@react-three/fiber";
import { webGLPreserveDrawingBuffer } from '../Settings';
import * as THREE from 'three';
import * as THREE_WEBGPU from "three/webgpu";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

extend(THREE);
extend(THREE_WEBGPU);

// Override the raycast method of THREE.Mesh to use accelerated raycasting
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;


export const CanvasProvider = ({ children, frameLoopSetting = "always", enableWebGPU = true }) => {
    const { dpr, setDpr, antialias, setAntialias, disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation } = useContext(graphicSettingContext);

    const [frameloop, setFrameloop] = useState("never");
    const rendererRef = useRef(null);

    /**
 * WebGPU 仅在：
 * - 用户允许（enableWebGPU）
 * - 浏览器支持（navigator.gpu）
 */
    const canUseWebGPU =
        enableWebGPU &&
        typeof navigator !== "undefined" &&
        !!navigator.gpu;

    /**
 * WebGPU Renderer（异步）
 */
    const createWebGPURenderer = async (canvas) => {
        const renderer = new THREE_WEBGPU.WebGPURenderer({
            canvas,
            powerPreference: "high-performance",
            antialias: false,
            alpha: false,
            stencil: false,
        });

        await renderer.init();
        rendererRef.current = renderer;

        // WebGPU init 完成后再开始渲染
        setFrameloop(frameLoopSetting);
        return renderer;
    };

    /**
     * WebGL Renderer（原逻辑，完全保留）
     */
    const webGLProps = {
        antialias,
        precision: "lowp",
        powerPreference: dpr > 1 ? "high-performance" : "low-power",
        preserveDrawingBuffer: webGLPreserveDrawingBuffer,
        stencil: false,
    };

    // ⭐ 监听 dpr / antialias 改变，动态更新 WebGPU renderer
    useEffect(() => {
        const renderer = rendererRef.current;
        if (renderer) {
            // 更新 DPR
            renderer.setPixelRatio(dpr);

            // 同步 canvas 尺寸
            renderer.setSize(window.innerWidth, window.innerHeight);

        }
    }, [dpr, antialias]);


    return (
        <Canvas
            shadows="variance"
            frameloop={canUseWebGPU ? frameloop : frameLoopSetting}
            dpr={dpr}
            performance={{ min: 0.25 }}
            mode="concurrent"
            fallback={<div>Sorry no WebGPU / WebGL supported!</div>}
            gl={
                canUseWebGPU
                    ? (canvas) => createWebGPURenderer(canvas)
                    : webGLProps
            }
            style={{ background: '#000000' }}
        >
            {children}
        </Canvas>
    );
};
