import { createContext, useState } from "react";
import { getUserDisableUnnecessaryComponentAnimation } from "../pages/Status";

export const disableUnnecessaryAnimationContext = createContext();

export const DisableUnnecessaryAnimationProvider = ({ children }) => {

    const [disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation] = useState(() => getUserDisableUnnecessaryComponentAnimation() ?? (window.innerHeight > window.innerWidth ? true : false));


    return (
        <disableUnnecessaryAnimationContext.Provider value={{ disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation }}>
            {children}
        </disableUnnecessaryAnimationContext.Provider>
    );
};
