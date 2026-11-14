import { useEffect } from 'react';
import { stageOfENV } from '../Settings';
import { enterFullscreen, getFullscreenElement } from '../utils/fullscreen';

const GESTURES = ['pointerup', 'touchend', 'click'];

/**
 * Click (or tap) anywhere on the page to go fullscreen.
 *
 * Listens in the capture phase on the whole document, so it works whatever was clicked, even
 * elements that stop the event from bubbling (game controls, 3D canvases).
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled] default: only in production (stageOfENV === 'prod')
 * @param {boolean} [options.once] true: only the first click of the visit (the site's pages);
 *   false: every click while not fullscreen, so leaving with Esc is undone by the next click (the game)
 * @param {boolean} [options.skipPortrait] leave a portrait screen (a phone held upright) windowed
 */
export default function useClickToFullscreen({ enabled = stageOfENV === 'prod', once = true, skipPortrait = true } = {}) {
    useEffect(() => {
        if (!enabled) return undefined;

        const stop = () => {
            for (const type of GESTURES) document.removeEventListener(type, onGesture, true);
        };
        function onGesture() {
            if (getFullscreenElement()) return;
            if (skipPortrait && window.innerHeight > window.innerWidth) return;
            enterFullscreen();
            if (once) stop();
        }

        for (const type of GESTURES) document.addEventListener(type, onGesture, true);
        return stop;
    }, [enabled, once, skipPortrait]);
}
