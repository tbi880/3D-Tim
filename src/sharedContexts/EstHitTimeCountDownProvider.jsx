import { createContext, useState } from "react";

export const estHitTimeCountDownContext = createContext();

export const EstHitTimeCountDownProvider = ({ children }) => {

    const [estHitTimeCountDown, setEstHitTimeCountDown] = useState(null);


    const initEstHitTimeCountDown = (initialValue) => {
        if (estHitTimeCountDown === null) {  // 仅允许初始化一次
            setEstHitTimeCountDown(initialValue);
        }
    };


    return (
        <estHitTimeCountDownContext.Provider value={{ estHitTimeCountDown, setEstHitTimeCountDown, initEstHitTimeCountDown }}>
            {children}
        </estHitTimeCountDownContext.Provider>
    );
};
