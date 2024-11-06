import { createContext, useState } from "react";

export const searchForEmergencyPlansContext = createContext();

export const SearchForEmergencyPlansProvider = ({ children }) => {
    const [showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer] = useState(false);


    return (
        <searchForEmergencyPlansContext.Provider value={{ showSearchForEmergencyPlansLayer, setShowSearchForEmergencyPlansLayer }}>
            {children}
        </searchForEmergencyPlansContext.Provider>
    );
};
