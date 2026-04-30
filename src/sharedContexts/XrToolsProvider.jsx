import { useXR } from "@react-three/xr";
import { createContext, useContext, useEffect, useState } from "react";
import { canvasContext } from "./CanvasProvider";

export const XrToolsContext = createContext();

export const XrToolsProvider = ({ children }) => {
    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);
    const [xrPlayer, setXrPlayer] = useState(null);
    const [xrIsPresenting, setXrIsPresenting] = useState(false);
    const origin = useXR((state) => state.origin);
    const session = useXR((state) => state.session);

    useEffect(() => {
        if (isVRSupported) {
            setXrPlayer(origin ?? null);
            setXrIsPresenting(Boolean(session));
        } else {
            setXrPlayer(null);
            setXrIsPresenting(false);
        }
    }, [isVRSupported, origin, session]);

    return (
        <XrToolsContext.Provider value={{ xrPlayer, xrIsPresenting }}>
            {children}
        </XrToolsContext.Provider>
    );
};
