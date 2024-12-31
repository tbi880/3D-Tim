import { createContext, useContext, useEffect, useState } from "react";
import { Controllers, Hands, VRButton, XR } from '@react-three/xr';
import { graphicSettingContext } from "./GraphicSettingProvider";
import { Canvas } from "@react-three/fiber";
import { webGLPreserveDrawingBuffer } from '../Settings';


export const canvasContext = createContext();

export const CanvasProvider = ({ children }) => {
    const { dpr, setDpr, antialias, setAntialias, disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation } = useContext(graphicSettingContext);

    const [isVRSupported, setIsVRSupported] = useState(false);

    useEffect(() => {
        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                if (supported) {
                    setIsVRSupported(true);
                }
            });
        }

    }, []);


    return (
        <canvasContext.Provider value={{ isVRSupported, setIsVRSupported }}>
            {isVRSupported && <>
                <VRButton />
                <Canvas gl={{ antialias: antialias, preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={dpr} performance={{ min: 0.5 }} mode="concurrent" fallback={<div>Sorry no WebGL supported!</div>}>
                    <XR>
                        <Controllers rayMaterial={{ color: '#99FFFF' }} />
                        <Hands />
                        {children}
                    </XR>
                </Canvas>
            </>}

            {!isVRSupported &&
                <Canvas gl={{ antialias: antialias, preserveDrawingBuffer: webGLPreserveDrawingBuffer }} dpr={dpr} performance={{ min: 0.5 }} mode="concurrent" fallback={<div>Sorry no WebGL supported!</div>}>
                    {children}
                </Canvas>}

        </canvasContext.Provider>
    );
};
