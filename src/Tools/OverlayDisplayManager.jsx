import { useState } from "react";
import GraphicSetting from "./GraphicSetting";
import TaskBoard from "./TaskBoard";
import Menu from "./Menu";
import { useLocation } from 'wouter';


export function OverlayDisplayManager({ isPortraitPhoneScreen }) {
    const [location, setLocation] = useLocation();
    const [displayOverlay, setDisplayOverlay] = useState("none");
    const setDisplayOverlayCallback = (overlay) => {
        setDisplayOverlay(overlay);
    };

    return (
        <>
            {(displayOverlay === "none" || displayOverlay === "menu") && <Menu isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} />}
            {(displayOverlay === "none" || displayOverlay === "setting") && <GraphicSetting isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} />}
            {(location != "/") && (displayOverlay === "none" || displayOverlay === "taskBoard") && <TaskBoard isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} currentUri={location} />}
        </>
    );
};
