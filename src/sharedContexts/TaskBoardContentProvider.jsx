import { createContext, useState } from "react";

export const TaskBoardContentContext = createContext();

export const TaskBoardContentProvider = ({ children }) => {
    const [taskBoardContent, setTaskBoardContent] = useState([]);


    return (
        <TaskBoardContentContext.Provider value={{ taskBoardContent, setTaskBoardContent }}>
            {children}
        </TaskBoardContentContext.Provider>
    );
};
