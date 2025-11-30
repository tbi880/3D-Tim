import { useCallback, useEffect, useState } from "react";

export function useComponentDisplayManager({ loadingComponents, initialComponents }) {
    const [showComponents, setShowComponents] = useState(loadingComponents);

    const toggleComponentDisplay = useCallback((componentKey, status) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: status !== undefined ? status : !prev[componentKey],
        }));
    }, []);

    useEffect(() => {
        setShowComponents(initialComponents);
    }, []);

    return [showComponents, toggleComponentDisplay];
}
