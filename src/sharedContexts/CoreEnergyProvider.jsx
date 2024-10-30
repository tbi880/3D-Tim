import { createContext, useState } from "react";

export const coreEnergyContext = createContext();

export const CoreEnergyProvider = ({ children }) => {

    const [coreEnergy, setCoreEnergy] = useState(null);


    const initCoreEnergy = (initialValue) => {
        if (coreEnergy === null) {
            setCoreEnergy(initialValue);
        }
    };


    return (
        <coreEnergyContext.Provider value={{ coreEnergy, setCoreEnergy, initCoreEnergy }}>
            {children}
        </coreEnergyContext.Provider>
    );
};
