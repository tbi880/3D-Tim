import { createContext } from "react";
import { stageOfENV } from '../Settings';
import { useEffect } from "react";


export const TheatreStudioContext = createContext();

export const TheatreStudioProvider = ({ children }) => {
    useEffect(() => {
        if (stageOfENV !== "prod") {
            (async () => {
                const [core, studio, extension] = await Promise.all([
                    import('@theatre/core'),
                    import('@theatre/studio'),
                    import('@theatre/r3f/dist/extension'),
                ]);

                studio.default.initialize();
                studio.default.extend(extension.default);
            })();
        }
    }, []);

    return (
        <TheatreStudioContext.Provider value={null}>
            {children}
        </TheatreStudioContext.Provider>
    );
};
