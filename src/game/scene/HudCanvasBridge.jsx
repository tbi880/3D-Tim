import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PHASE } from '../state/GameSession.js';
import { drawMarkers, drawRadar } from '../ui/markerRenderer.js';
import { vr } from '../xr/vrState.js';

const MAX_CANVAS_DPR = 2;
/** The radar changes slowly; redrawing it every third frame is plenty. */
const RADAR_FRAME_INTERVAL = 3;

function prepareCanvas(canvas, cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

/**
 * Lives inside the 3D canvas so it has the camera, and paints the 2D overlay canvases that
 * live in the DOM HUD (target brackets, reticle, radar).
 */
export default function HudCanvasBridge({ game, markerCanvasRef, radarCanvasRef }) {
    const frame = useRef(0);

    useFrame(({ camera, size }) => {
        const { session, input } = game;
        const markerCanvas = markerCanvasRef.current;
        if (!markerCanvas) return;
        const ctx = prepareCanvas(markerCanvas, size.width, size.height);
        // In VR the markers are drawn on the headset's HUD (xr/VRHud.jsx) instead.
        if (session.phase !== PHASE.PLAYING || vr.active) {
            ctx.clearRect(0, 0, size.width, size.height);
            return;
        }
        // This runs before the renderer refreshes the camera matrices for the new frame.
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        drawMarkers(ctx, session, camera, size.width, size.height, input.controls);

        frame.current += 1;
        const radarCanvas = radarCanvasRef.current;
        if (radarCanvas && frame.current % RADAR_FRAME_INTERVAL === 0) {
            const radarSize = radarCanvas.clientWidth;
            drawRadar(prepareCanvas(radarCanvas, radarSize, radarSize), session, radarSize);
        }
    });

    return null;
}
