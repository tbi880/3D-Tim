import { createContext, useContext } from "react";
import { canvasContext } from "../sharedContexts/CanvasProvider";
import { XrToolsProvider } from "../sharedContexts/XrToolsProvider";

const XrToolMiddleLayerContext = createContext();

export const XrToolMiddleLayer = ({ children }) => {

    const { isVRSupported, setIsVRSupported } = useContext(canvasContext);

    return (
        <XrToolMiddleLayerContext.Provider value={{}}>
            {isVRSupported ? (
                <XrToolsProvider>{children}</XrToolsProvider>
            ) : (
                children
            )}
        </XrToolMiddleLayerContext.Provider>

    )
}

export default XrToolMiddleLayer;