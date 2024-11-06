import { createContext, useState } from "react";

export const headerSubTitleContext = createContext();

export const HeaderSubTitleProvider = ({ children }) => {
    const [showHeaderSubTitle, setShowHeaderSubTitle] = useState(false);


    return (
        <headerSubTitleContext.Provider value={{ showHeaderSubTitle, setShowHeaderSubTitle }}>
            {children}
        </headerSubTitleContext.Provider>
    );
};
