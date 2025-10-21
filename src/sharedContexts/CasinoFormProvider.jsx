import { createContext, useState } from "react";

export const casinoFormContext = createContext();

export const CasinoFormProvider = ({ children }) => {
    const [showCasinoForm, setShowCasinoForm] = useState(false);


    return (
        <casinoFormContext.Provider value={{ showCasinoForm, setShowCasinoForm }}>
            {children}
        </casinoFormContext.Provider>
    );
};
