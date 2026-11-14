/**
 * Graphics presets for the game page, picked in the settings menu (`settings.graphics`).
 *
 * The game draws through a post-processing composer (bloom, tone mapping), so the WebGL
 * canvas's own antialiasing never reaches the screen: the canvas is always created without
 * it, and the composer's multisampling is what smooths edges. The other big lever is the
 * pixel ratio, since nearly every cost on the GPU grows with the number of pixels.
 *
 * - `performance` (default): one rendered pixel per CSS pixel, no MSAA. Smooth on laptops
 *   and phones; on a Retina screen the picture is slightly softer.
 * - `quality`: up to 1.5x pixel ratio and 4x MSAA, for strong GPUs.
 */
export const GRAPHICS = Object.freeze({
    performance: { maxDpr: 1, multisampling: 0 },
    quality: { maxDpr: 1.5, multisampling: 4 },
});

export const GRAPHICS_ORDER = Object.freeze(['performance', 'quality']);
export const DEFAULT_GRAPHICS = 'performance';

/** Pixel ratio for the 3D canvas: never more than the screen has, never more than the preset allows. */
export function graphicsDpr(preset) {
    const screenDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return Math.min(screenDpr, GRAPHICS[preset].maxDpr);
}
