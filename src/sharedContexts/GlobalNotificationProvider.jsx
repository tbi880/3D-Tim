import { createContext, useEffect } from "react";
import { message } from 'antd';


export const GlobalNotificationContext = createContext();

export const GlobalNotificationProvider = ({ children }) => {
    const [messageApi, contextHolder] = message.useMessage();

    const customMessage = (type, content, duration = 2.5) => {
        return messageApi.open({
            type,
            content,
            duration,
            style: {
                textAlign: 'center',
                fontFamily: "'Orbitron', sans-serif",
            },
        });
    };


    return (
        <GlobalNotificationContext.Provider value={{ messageApi: customMessage }}>
            {contextHolder}
            {children}
        </GlobalNotificationContext.Provider >
    );
};
