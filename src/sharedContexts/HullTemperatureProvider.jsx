import { createContext, useState } from "react";

export const hullTemperatureContext = createContext();

export const HullTemperatureProvider = ({ children }) => {

    const [hullTemperature, setHullTemperature] = useState(null);


    const initHullTemperature = (initialValue) => {
        if (hullTemperature === null) {
            setHullTemperature(initialValue);
        }
    };


    return (
        <hullTemperatureContext.Provider value={{ hullTemperature, setHullTemperature, initHullTemperature }}>
            {children}
        </hullTemperatureContext.Provider>
    );
};
