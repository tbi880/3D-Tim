import { createContext, useState } from "react";

export const sendDistressSignalContext = createContext();

export const SendDistressSignalProvider = ({ children }) => {
    const [showSendDistressSignalForm, setShowSendDistressSignalForm] = useState(false);


    return (
        <sendDistressSignalContext.Provider value={{ showSendDistressSignalForm, setShowSendDistressSignalForm }}>
            {children}
        </sendDistressSignalContext.Provider>
    );
};
