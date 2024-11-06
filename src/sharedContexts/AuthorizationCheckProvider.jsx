import { createContext, useState } from "react";

export const authorizationCheckContext = createContext();

export const AuthorizationCheckProvider = ({ children }) => {
    const [showAuthorizationCheckForm, setShowAuthorizationCheckForm] = useState(false);


    return (
        <authorizationCheckContext.Provider value={{ showAuthorizationCheckForm, setShowAuthorizationCheckForm }}>
            {children}
        </authorizationCheckContext.Provider>
    );
};
