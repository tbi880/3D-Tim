/**
 * True on phones and tablets, where the primary pointer is a finger. Safe to call in Node
 * (the headless campaign simulation), where it is simply false.
 */
export function isTouchDevice() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
