import { useState, useRef, useEffect, useMemo } from "react";
import GraphicSetting from "./GraphicSetting";
import TaskBoard from "./TaskBoard";
import Menu from "./Menu";
import "./css/general.css";
import { useLocation } from 'wouter';
import TourGuide from "./TourGuide";
import { bucketURL } from "../Settings";
import { getTourMapFromLocalStorage, hasTourGuided } from "../pages/Status";


export function OverlayDisplayManager({ isPortraitPhoneScreen }) {
    const tourStartSceneURI = "/bridge";
    const [location, setLocation] = useLocation();
    const [displayOverlay, setDisplayOverlay] = useState("none");
    const setDisplayOverlayCallback = (overlay) => {
        setDisplayOverlay(overlay);
    };
    const refMenu = useRef(null);
    const refGraphicSetting = useRef(null);
    const refTaskBoard = useRef(null);
    const refSpeedControl = useRef(null);
    const [open, setOpen] = useState(false);

    const stepsConfig = useMemo(() => ([
        {
            ref: refMenu,
            title: 'Open menu here',
            description: 'You can go back to the previous scenes from here if you want to re-experience.',
            placement: isPortraitPhoneScreen ? null : 'right',
            cover: (
                <img
                    height={"200px"}
                    width={isPortraitPhoneScreen ? "50px" : "80px"}
                    alt="menu.png"
                    src={bucketURL + "pic/menu.png"}
                />
            ),
        },
        {
            ref: refGraphicSetting,
            title: 'Change the graphic settings',
            description: 'Save your changes then the canvas will be re-rendered.',
            placement: isPortraitPhoneScreen ? null : 'left',
            cover: (
                <img
                    height={"200px"}
                    width={isPortraitPhoneScreen ? "50px" : "80px"}
                    alt="menu.png"
                    src={bucketURL + "pic/graphicSetting.png"}
                />
            ),
        },
        {
            ref: refTaskBoard,
            title: 'See your tasks here',
            description: 'If you don\'t know what to do, you can check your tasks or hints here.',
            cover: (
                <img
                    height={"200px"}
                    width={isPortraitPhoneScreen ? "50px" : "80px"}
                    alt="menu.png"
                    src={bucketURL + "pic/taskBoard.png"}
                />
            ),
        },
        {
            ref: refSpeedControl,
            title: 'Speed up the animation in between / reset the speed',
            description: 'You can speed up the animation in between or reset the speed here. You might get dizzy if you speed up too much~',

        },
    ]), [refMenu, refGraphicSetting, refTaskBoard, refSpeedControl]);

    useEffect(() => {
        const tourMap = getTourMapFromLocalStorage();
        if (!(location in tourMap) || tourMap[location] || location != tourStartSceneURI) {
            return;
        }
        setOpen(true);
        hasTourGuided(location);
    }, [location]);


    return (
        <>
            {(displayOverlay === "none" || displayOverlay === "menu") && <Menu ref={refMenu} isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} />}
            {(displayOverlay === "none" || displayOverlay === "setting") && <GraphicSetting ref={refGraphicSetting} isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} />}
            {(location != "/") && (displayOverlay === "none" || displayOverlay === "taskBoard") && <TaskBoard ref={refTaskBoard} isPortraitPhoneScreen={isPortraitPhoneScreen} setDisplayOverlayCallback={setDisplayOverlayCallback} currentUri={location} />}
            <div ref={refSpeedControl} className={"double-speed-button"} style={{ zIndex: -99999, height: "85px", width: "60px" }} />
            <TourGuide stepsConfig={stepsConfig} open={open} onClose={() => setOpen(false)} />

        </>
    );
};
