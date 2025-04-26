import { Progress, Typography } from "antd";
import { forwardRef, useContext, useEffect, useState } from "react";
import "./css/menu.css";
import { estHitTimeCountDownContext } from "../sharedContexts/EstHitTimeCountDownProvider";
import { hullTemperatureContext } from "../sharedContexts/HullTemperatureProvider";
import { coreEnergyContext } from "../sharedContexts/CoreEnergyProvider";
import { CaretUpOutlined, CaretDownOutlined } from "@ant-design/icons";


const ShipStatus = forwardRef(({ isPortraitPhoneScreen, isHide, onClick }, refShipStatus, hideSwitchFromOutside = false) => {
    const [stepsCount, setStepsCount] = useState(6);
    const [stepsGap, setStepsGap] = useState(5);
    const { estHitTimeCountDown } = useContext(estHitTimeCountDownContext);
    const { hullTemperature } = useContext(hullTemperatureContext);
    const { coreEnergy } = useContext(coreEnergyContext);

    const maxHullTemperature = 4500; // ship's maximum hull temperature
    const hullTemperaturePercent = (hullTemperature + 500) / maxHullTemperature * 100;
    const maxCoreEnergy = 1000; // ship's maximum core energy
    const coreEnergyPercent = (coreEnergy / maxCoreEnergy * 100).toFixed(1);

    const arrowStyle = {
        position: "absolute",
        bottom: 4,
        left: "50%",
        transform: "translateX(-50%)",
        fontSize: 16,
        color: "#fff",
        pointerEvents: "none",   // 让整个盒子仍然捕获点击
        userSelect: "none",
    };

    const containerStyle = {
        width: "300px",
        position: "fixed",
        top: "50px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        color: "#fff",
        zIndex: 500,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px",
        borderRadius: "0 0 10px 10px",
        boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.3)",
    };

    const titleStyle = {
        width: "100%",
        textAlign: "center",
        marginBottom: "10px",
        color: "white",
    };

    const progressContainerStyle = {
        display: "flex",
        flexDirection: "row",
        width: "100%",
        justifyContent: "space-between",
    };

    const progressStyle = {
        flex: 1,
        margin: "0 5px",
        textAlign: "center",
        width: "100%",
    };

    return (
        <div
            style={containerStyle}
            onClick={onClick}
            ref={refShipStatus}
        >
            <div style={titleStyle}>
                <Typography.Title level={5} style={{ color: "white" }}>
                    The ship will impact in 0 :{" "}
                    {Math.floor(estHitTimeCountDown / 60)} : {estHitTimeCountDown % 60}
                </Typography.Title>
            </div>
            {!isHide && (
                <div style={progressContainerStyle}>
                    <div style={progressStyle} className="color-white-important">
                        <Progress
                            type="dashboard"
                            steps={{ count: stepsCount, gap: stepsGap }}
                            percent={hullTemperaturePercent}
                            trailColor="white"
                            strokeWidth={20}
                            strokeColor={"red"}
                            format={() => (
                                <div >
                                    {hullTemperature}<br />°C
                                </div>
                            )}
                        />
                        <Typography.Title level={5} style={{ color: "white" }}>
                            Hull Temperature
                        </Typography.Title>
                    </div>
                    <div style={progressStyle} className="color-white-important">
                        <Progress
                            type="dashboard"
                            steps={{ count: stepsCount, gap: stepsGap }}
                            percent={coreEnergyPercent}
                            trailColor="white"
                            strokeWidth={20}
                            strokeColor={"#108ee9"}
                            format={() => (
                                <>
                                    {coreEnergyPercent} % </>)}
                        />
                        <Typography.Title level={5} style={{ color: "white" }}>
                            Core Energy
                        </Typography.Title>
                    </div>
                </div>

            )}
            <div style={arrowStyle}>
                {isHide ? <CaretDownOutlined /> : <CaretUpOutlined />}
            </div>
        </div>
    );
});

export default ShipStatus;
