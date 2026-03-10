import { useState, useRef, useEffect } from 'react';

export function useTurnstile(sitekey = '0x4AAAAAAB-aBBE_EPA75daZ') {
    const [token, setToken] = useState(null);
    const widgetIdRef = useRef(null);
    const containerRef = useRef(null);

    // Load Turnstile script once
    useEffect(() => {
        if (window.turnstile) return;

        const script = document.createElement('script');
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=turnstileCallback";
        script.async = true;
        document.body.appendChild(script);

        window.turnstileCallback = () => {
            // console.log("Turnstile script loaded");
        };

        return () => {
            delete window.turnstileCallback;
        };
    }, []);

    // Render widget
    useEffect(() => {
        if (!containerRef.current) return;
        if (!window.turnstile) return;

        // Avoid double render
        if (widgetIdRef.current !== null) return;

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey,
            theme: 'dark',
            callback: (token) => setToken(token),
        });

        return () => {
            if (widgetIdRef.current !== null && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, [containerRef.current, window.turnstile]);

    // Refresh token
    const refreshTurnstile = () => {
        if (!window.turnstile || widgetIdRef.current === null) return;
        window.turnstile.reset(widgetIdRef.current);
        setToken(null);
    };

    return { token, containerRef, refreshTurnstile };
}

export default useTurnstile;