import { createContext, useState } from "react";
import { getUserDisableUnnecessaryComponentAnimation, getUserDpr, getUserAntialias } from "../pages/Status";

export const graphicSettingContext = createContext();
export const GraphicSettingProvider = ({ children }) => {
    const [dpr, setDpr] = useState(() => getUserDpr() ?? (isPortraitPhoneScreen ? 1 : 1.5));
    const [antialias, setAntialias] = useState(() => getUserAntialias() ?? (isPortraitPhoneScreen ? false : true));
    const [disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation] = useState(() => getUserDisableUnnecessaryComponentAnimation() ?? (window.innerHeight > window.innerWidth ? true : false));


    return (
        <graphicSettingContext.Provider value={{ dpr, setDpr, antialias, setAntialias, disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation }}>
            {children}
        </graphicSettingContext.Provider>
    );
};
