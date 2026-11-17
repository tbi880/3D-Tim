/**
 * Whether two values that are going to the HUD hold the same content: numbers, strings,
 * booleans and null as they are, arrays and plain objects member by member. What GameSession
 * publishes is made of nothing else - and a ship or other live object is only ever the same
 * object as itself.
 */
export function sameValue(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
        return true;
    }
    // Only plain records are compared by content; anything else (a Vector3, a ship) by identity, above.
    if (Object.getPrototypeOf(a) !== Object.prototype) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (!Object.hasOwn(b, key) || !sameValue(a[key], b[key])) return false;
    }
    return true;
}
