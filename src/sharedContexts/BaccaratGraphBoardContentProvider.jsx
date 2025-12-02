import { createContext, useState } from "react";

export const BaccaratGraphBoardContentContext = createContext();

export const BaccaratGraphBoardContentProvider = ({ children }) => {
    const [baccaratGraphBoardContent, setBaccaratGraphBoardContent] = useState([]);

    return (
        <BaccaratGraphBoardContentContext.Provider value={{ baccaratGraphBoardContent, setBaccaratGraphBoardContent }}>
            {children}
        </BaccaratGraphBoardContentContext.Provider>
    );
};
