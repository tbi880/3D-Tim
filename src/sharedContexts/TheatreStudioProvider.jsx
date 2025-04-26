import { createContext } from "react";
import { stageOfENV } from '../Settings';
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'


export const TheatreStudioContext = createContext();

export const TheatreStudioProvider = ({ children }) => {

    if (stageOfENV != "prod") {
        studio.initialize();
        studio.extend(extension);
    }

    return (
        <TheatreStudioContext.Provider>
            {children}
        </TheatreStudioContext.Provider >
    );
};
