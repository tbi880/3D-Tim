import { useState, useCallback } from "react";

export function useCameraSwitcher({ isFirstPersonCameraForStart = false }) {
    const [isFirstPersonCamera, setIsFirstPersonCamera] = useState(isFirstPersonCameraForStart);

    const switchCamera = useCallback((isFirstPerson) => {
        setIsFirstPersonCamera(isFirstPerson);
    }, []);

    return { isFirstPersonCamera, switchCamera };
}
