/**
 * Sectors are the places the story visits. Each one describes its backdrop (which of the
 * site's existing GLB models hang in the sky), its lighting mood and optional asteroids.
 *
 * Backdrop objects are drawn on a "sky dome" that follows the camera, so they are placed
 * by direction + apparent size instead of real distance:
 *   direction - where in the sky (does not need to be normalised)
 *   size      - apparent diameter, in units at SKY_DISTANCE (see scene/SectorBackdrop.jsx)
 *   modelSize - the model's own diameter in its file, used to normalise the scale
 *
 * asteroids.clearings lists `[x, y, z, radius]` spheres that are kept free of rocks, so
 * nothing the story places (the player, the buoy, the warden) starts inside one.
 */
export const SECTORS = Object.freeze({
    collapse: {
        id: 'collapse',
        nameKey: 'sector.collapse',
        playerStart: { position: [0, 0, 600], facing: [0, 0, -1] },
        sky: { nebulaA: '#1b2a6b', nebulaB: '#7a2bd6', intensity: 0.55 },
        light: { sunDirection: [-0.4, 0.5, -0.8], sunColor: '#cfd9ff', sunIntensity: 3.0, ambient: 0.8 },
        backdrop: [
            {
                model: 'blackhole-transformed.glb', modelSize: 6.1, direction: [-0.25, 0.12, -1], size: 5200,
                rotation: [0.35, 0, 0.2], animation: 'Take 001', animationSpeed: 0.3,
            },
            {
                model: 'strangest_star-transformed.glb', modelSize: 43, direction: [-0.25, 0.12, -1], size: 9500,
                rotation: [0.35, 0, 0.2], animation: 'Animation', animationSpeed: 0.3,
            },
        ],
        asteroids: {
            count: 70, centre: [0, -40, -1500], spread: [1500, 420, 1500], minRadius: 8, maxRadius: 42, seed: 7,
            clearings: [[0, -30, -1400, 260], [0, 0, 0, 300]],
        },
    },
    veil: {
        id: 'veil',
        nameKey: 'sector.veil',
        playerStart: { position: [0, 0, 900], facing: [0, 0, -1] },
        sky: { nebulaA: '#3a1466', nebulaB: '#d4418e', intensity: 0.8 },
        light: { sunDirection: [0.7, 0.35, 0.4], sunColor: '#f3d6ff', sunIntensity: 3.3, ambient: 1.0 },
        backdrop: [
            {
                model: 'planets/purplePlanet-transformed.glb', modelSize: 2.07, direction: [0.55, -0.12, -1], size: 9000,
                rotation: [0.2, 0.5, 0], animation: 'Take 01', animationSpeed: 0.15,
            },
            {
                model: 'planets/jupiter-transformed.glb', modelSize: 3.85, direction: [-1, 0.45, 0.6], size: 2200,
                rotation: [0.1, 0, 0.3],
            },
        ],
        asteroids: {
            count: 120, centre: [0, 0, -1300], spread: [2300, 520, 2000], minRadius: 10, maxRadius: 70, seed: 21,
            clearings: [[260, 90, -1500, 380], [0, 0, 600, 300]],
        },
    },
    cinder: {
        id: 'cinder',
        nameKey: 'sector.cinder',
        playerStart: { position: [300, 120, 2600], facing: [0, 0, -1] },
        sky: { nebulaA: '#5a1408', nebulaB: '#ff7b2e', intensity: 0.65 },
        light: { sunDirection: [-0.6, 0.25, 0.5], sunColor: '#ffd2a8', sunIntensity: 2.8, ambient: 1.0 },
        backdrop: [
            {
                model: 'planets/lavaPlanet-transformed.glb', modelSize: 3.0, direction: [0.35, -0.5, -1], size: 13000,
                rotation: [0.3, 0.8, 0], animation: 'clouds|cloudsAction.001', animationSpeed: 0.2,
            },
        ],
        asteroids: null,
    },
    home: {
        id: 'home',
        nameKey: 'sector.home',
        playerStart: { position: [260, 60, 900], facing: [0, 0, -1] },
        sky: { nebulaA: '#0b1e4a', nebulaB: '#2b6fd6', intensity: 0.35 },
        light: { sunDirection: [0.8, 0.4, 0.5], sunColor: '#ffffff', sunIntensity: 4.1, ambient: 1.1 },
        backdrop: [
            {
                model: 'planets/earth-transformed.glb', modelSize: 12.9, direction: [0.3, -0.25, -1], size: 9000,
                rotation: [0.4, 2.4, 0], animation: 'Take 001', animationSpeed: 0.2,
            },
        ],
        asteroids: null,
    },
});
