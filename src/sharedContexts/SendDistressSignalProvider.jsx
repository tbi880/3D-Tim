import { createContext, useState } from "react";

export const sendDistressSignalContext = createContext();

export const SendDistressSignalProvider = ({ children }) => {
    const [showForm, setShowForm] = useState(false);


    return (
        <sendDistressSignalContext.Provider value={{ showForm, setShowForm }}>
            {children}
        </sendDistressSignalContext.Provider>
    );
};
