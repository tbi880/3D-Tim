/**
 * Sectors are the places the story visits. Each one describes its backdrop (which of the
 * site's existing GLB models hang in the sky), its lighting mood and optional asteroids.
 *
 * Backdrop objects are real places: a planet has its true radius and sits tens of thousands
 * of kilometres from the battlefield, so flying around the sector barely shifts it against
 * the stars (see SectorBackdrop for how something that far away is drawn).
 *   direction   - where in the sky it is, seen from the sector's origin (need not be normalised)
 *   radiusKm    - the body's radius
 *   distanceKm  - from the sector's origin to the body's centre
 *                 (apparent diameter = 2 * asin(radiusKm / distanceKm); Earth from 12,000 km is 64 deg)
 *   modelSize   - the model's own diameter in its file, used to normalise the scale
 *   brightness  - optional, dims a model whose colours wash out at this size (1 = as authored)
 *   animationSpeed - playback rate of the model's own animation; a planet's clouds should
 *                 take minutes to move visibly, so these are small
 *
 * light.ambient is deliberately small: most fill light is the sky itself, reflected off the
 * hulls (SectorBackdrop renders the nebula colours and the sun into an environment map).
 *
 * asteroids.clearings lists `[x, y, z, radius]` spheres that are kept free of rocks, so
 * nothing the story places (the player, a buoy, a cruiser) starts inside one.
 */
export const SECTORS = Object.freeze({
    collapse: {
        id: 'collapse',
        nameKey: 'sector.collapse',
        playerStart: { position: [0, 0, 900], facing: [0, 0, -1] },
        sky: { nebulaA: '#1b2a6b', nebulaB: '#7a2bd6', intensity: 0.55 },
        light: { sunDirection: [-0.4, 0.5, -0.8], sunColor: '#cfd9ff', sunIntensity: 3.0, ambient: 0.2 },
        backdrop: [
            {
                model: 'blackhole-transformed.glb', modelSize: 6.1, direction: [-0.25, 0.14, -1], radiusKm: 40_000, distanceKm: 137_000,
                rotation: [0.35, 0, 0.2], animation: 'Take 001', animationSpeed: 0.12,
            },
            {
                model: 'strangest_star-transformed.glb', modelSize: 43, direction: [-0.25, 0.14, -1], radiusKm: 600_000, distanceKm: 1_165_000,
                rotation: [0.35, 0, 0.2], animation: 'Animation', animationSpeed: 0.08,
            },
        ],
        asteroids: {
            count: 90, centre: [0, -40, -1700], spread: [1900, 520, 1900], minRadius: 8, maxRadius: 48, seed: 7,
            clearings: [[0, -30, -1600, 280], [0, 0, 0, 300]],
        },
    },
    veil: {
        id: 'veil',
        nameKey: 'sector.veil',
        playerStart: { position: [0, 0, 1400], facing: [0, 0, -1] },
        sky: { nebulaA: '#3a1466', nebulaB: '#d4418e', intensity: 0.8 },
        light: { sunDirection: [0.7, 0.35, 0.4], sunColor: '#f3d6ff', sunIntensity: 3.3, ambient: 0.2 },
        backdrop: [
            {
                model: 'planets/purplePlanet-transformed.glb', modelSize: 2.07, direction: [0.55, -0.2, -1], radiusKm: 9_000, distanceKm: 22_000, brightness: 0.5,
                rotation: [0.2, 0.5, 0], animation: 'Take 01', animationSpeed: 0.015,
            },
            {
                model: 'planets/jupiter-transformed.glb', modelSize: 3.85, direction: [-1, 0.45, 0.6], radiusKm: 70_000, distanceKm: 670_000, brightness: 0.6,
                rotation: [0.1, 0, 0.3],
            },
        ],
        asteroids: {
            count: 170, centre: [0, 0, -1500], spread: [3000, 650, 2600], minRadius: 10, maxRadius: 80, seed: 21,
            clearings: [[300, 100, -2000, 520], [0, 0, 1100, 300]],
        },
    },
    graveyard: {
        id: 'graveyard',
        nameKey: 'sector.graveyard',
        playerStart: { position: [0, 80, 2600], facing: [0, 0, -1] },
        sky: { nebulaA: '#0d3a4a', nebulaB: '#3fb6a8', intensity: 0.5 },
        light: { sunDirection: [0.3, 0.6, 0.7], sunColor: '#e6f4ff', sunIntensity: 3.2, ambient: 0.19 },
        backdrop: [
            {
                model: 'planets/jupiter-transformed.glb', modelSize: 3.85, direction: [-0.8, -0.5, -1], radiusKm: 70_000, distanceKm: 140_000, brightness: 0.42,
                rotation: [0.25, 0.4, 0.15],
            },
        ],
        asteroids: {
            count: 150, centre: [0, 0, -400], spread: [3600, 500, 3600], minRadius: 8, maxRadius: 60, seed: 33,
            clearings: [[0, 80, 2600, 320], [-1500, 60, 600, 380], [1700, -80, -900, 380], [-300, 120, -2600, 520]],
        },
    },
    forge: {
        id: 'forge',
        nameKey: 'sector.forge',
        playerStart: { position: [900, 500, 5200], facing: [-0.12, -0.02, -1] },
        sky: { nebulaA: '#4a0d1c', nebulaB: '#ff5a3c', intensity: 0.6 },
        light: { sunDirection: [-0.5, 0.4, 0.6], sunColor: '#ffe0cc', sunIntensity: 3.2, ambient: 0.19 },
        backdrop: [
            {
                model: 'planets/mars-transformed.glb', modelSize: 5.5, direction: [0.8, -0.2, -1], radiusKm: 3_390, distanceKm: 8_000,
                rotation: [0, 0.6, 0.2], brightness: 0.8,
            },
        ],
        asteroids: null,
    },
    cinder: {
        id: 'cinder',
        nameKey: 'sector.cinder',
        playerStart: { position: [700, 300, 4200], facing: [-0.1, -0.05, -1] },
        sky: { nebulaA: '#5a1408', nebulaB: '#ff7b2e', intensity: 0.65 },
        light: { sunDirection: [-0.6, 0.25, 0.5], sunColor: '#ffd2a8', sunIntensity: 2.8, ambient: 0.2 },
        backdrop: [
            {
                model: 'planets/lavaPlanet-transformed.glb', modelSize: 3.0, direction: [0.3, -0.75, -1], radiusKm: 7_000, distanceKm: 11_500, brightness: 0.55,
                rotation: [0.3, 0.8, 0], animation: 'clouds|cloudsAction.001', animationSpeed: 0.02,
            },
        ],
        asteroids: null,
    },
    home: {
        id: 'home',
        nameKey: 'sector.home',
        playerStart: { position: [700, 260, 2600], facing: [-0.15, -0.05, -1] },
        sky: { nebulaA: '#0b1e4a', nebulaB: '#2b6fd6', intensity: 0.35 },
        light: { sunDirection: [0.8, 0.4, 0.5], sunColor: '#ffffff', sunIntensity: 3.3, ambient: 0.24 },
        backdrop: [
            {
                model: 'planets/earth-transformed.glb', modelSize: 12.9, direction: [0.25, -0.55, -1], radiusKm: 6_371, distanceKm: 11_000,
                rotation: [0.4, 2.4, 0], animation: 'Take 001', animationSpeed: 0.015,
            },
        ],
        asteroids: null,
    },
});
