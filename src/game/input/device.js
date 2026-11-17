const COARSE_POINTER = '(pointer: coarse)';

/**
 * True on phones and tablets, where the primary pointer is a finger. Safe to call in Node
 * (the headless campaign simulation), where it is simply false.
 */
export function isTouchDevice() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE_POINTER).matches;
}

/**
 * Calls `onChange` whenever the answer of isTouchDevice() changes while the page is open: a
 * trackpad keyboard put on or taken off a tablet, a browser's phone emulation switched on or
 * off. Returns the function that stops listening (the shape React's useSyncExternalStore wants).
 */
export function watchTouchDevice(onChange) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const query = window.matchMedia(COARSE_POINTER);
    if (query.addEventListener) {
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }
    // Safari before 14.
    query.addListener(onChange);
    return () => query.removeListener(onChange);
}
