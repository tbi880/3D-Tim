import { useState, useRef, useEffect } from 'react';

export function useTurnstile(sitekey = '0x4AAAAAAB-aBBE_EPA75daZ') {
    const [token, setToken] = useState(null);
    const widgetIdRef = useRef(null);
    const containerRef = useRef(null);

    // 加载 Turnstile 脚本（只加载一次）
    useEffect(() => {
        if (window.turnstile) return;
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
    }, []);

    // 渲染 widget
    useEffect(() => {
        if (!containerRef.current) return;

        const tryRender = () => {
            if (!window.turnstile) {
                const t = setInterval(() => {
                    if (window.turnstile) {
                        clearInterval(t);
                        renderTurnstile();
                    }
                }, 200);
                return () => clearInterval(t);
            }
            renderTurnstile();
        };

        const renderTurnstile = () => {
            setToken(null);
            if (widgetIdRef.current !== null && window.turnstile.reset) {
                try { window.turnstile.reset(widgetIdRef.current); } catch (e) { }
            }
            const id = window.turnstile.render(containerRef.current, {
                sitekey,
                theme: 'dark',
                callback: (t) => setToken(t),
                'error-callback': () => setToken(null),
                'expired-callback': () => setToken(null),
            });
            widgetIdRef.current = id;
        };

        tryRender();
    }, [sitekey]);

    return { token, containerRef, widgetIdRef };
}

export default useTurnstile;