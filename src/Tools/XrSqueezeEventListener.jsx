import { useXREvent } from "@react-three/xr";


export function XrSqueezeEventListener({ onLeftSqueeze, onRightSqueeze }) {
    // 前往上一个VR坐标（调用自定义逻辑）
    useXREvent(
        "squeeze",
        (event) => {
            if (onLeftSqueeze) {
                onLeftSqueeze();
            }
        },
        { handedness: "left" }
    );

    // 前往下一个VR坐标（调用自定义逻辑）
    useXREvent(
        "squeeze",
        (event) => {
            if (onRightSqueeze) {
                onRightSqueeze();
            }
        },
        { handedness: "right" }
    );

    return <></>;
}


export default XrSqueezeEventListener;