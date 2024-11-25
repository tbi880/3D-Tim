import { useCallback, useEffect, useState } from "react";

export function useComponentDisplayManager({ loadingComponents, initialComponents }) {
    const [showComponents, setShowComponents] = useState(loadingComponents);

    const toggleComponentDisplay = useCallback((componentKey) => {
        setShowComponents((prev) => ({
            ...prev,
            [componentKey]: !prev[componentKey],
        }));
    }, []);

    useEffect(() => {
        setShowComponents(initialComponents);
    }, []);

    return [showComponents, toggleComponentDisplay];
}
