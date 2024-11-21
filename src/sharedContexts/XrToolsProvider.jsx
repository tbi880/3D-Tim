import { useXR } from "@react-three/xr";
import { createContext, useContext, useEffect, useState } from "react";
import { canvasContext } from "./CanvasProvider";

export const XrToolsContext = createContext();

export const XrToolsProvider = ({ children }) => {
    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);
    const [xrPlayer, setXrPlayer] = useState(null);
    const [xrIsPresenting, setXrIsPresenting] = useState(false);
    const { player, isPresenting } = useXR();

    useEffect(() => {
        if (isVRSupported) {
            setXrPlayer(player);
            setXrIsPresenting(isPresenting);
        } else {
            setXrPlayer(null);
            setXrIsPresenting(false);
        }
    }, [isVRSupported, player, isPresenting]);

    return (
        <XrToolsContext.Provider value={{ xrPlayer, xrIsPresenting }}>
            {children}
        </XrToolsContext.Provider>
    );
};
