import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { bucketURL, stageOfENV } from '../Settings';
import useClickToFullscreen from '../hooks/useClickToFullscreen';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import { SoundEngine } from '../game/audio/SoundEngine.js';
import { graphicsDpr } from '../game/config/graphics.js';
import { InputController } from '../game/input/InputController.js';
import { lockPage } from '../game/input/pageLock.js';
import { startHostHeartbeat } from '../game/net/lobby/hostHeartbeat.js';
import { createLanMultiplayer } from '../game/net/lobby/lanStore.js';
import { isTouchDevice } from '../game/input/device.js';
import GameScene from '../game/scene/GameScene.jsx';
import { canvasAntialias, headsetContextOptions } from '../game/xr/vrState.js';
import { GameSession } from '../game/state/GameSession.js';
import { gameStoreSink, useGameStore, useT } from '../game/state/gameStore.js';
import GameHud from '../game/ui/GameHud.jsx';
import Menus from '../game/ui/Menus.jsx';
import TouchControls from '../game/ui/TouchControls.jsx';
import TutorialOverlay from '../game/ui/TutorialOverlay.jsx';
import '../game/ui/hud.css';

/**
 * The battle spans a cockpit half a metre from the camera to planets hundreds of kilometres
 * away. A logarithmic depth buffer keeps depth precise over that whole range, which is what
 * stops distant hulls and planet cloud layers from flickering through each other.
 */
const GL_OPTIONS = { logarithmicDepthBuffer: true, ...headsetContextOptions() };

/**
 * Builds everything one visit to the game needs. The three objects are plain classes with
 * no React inside; this page only wires them to the DOM and to the 3D scene.
 */
function createGame() {
    const session = new GameSession({ ui: gameStoreSink, settings: useGameStore.getState().settings });
    const input = new InputController({
        onAction: (action) => session.handleAction(action),
        getInvertY: () => session.settings.invertY,
    });
    const sound = new SoundEngine({ assetBaseUrl: bucketURL });
    sound.attach(session);
    // LAN multiplayer plays its matches on the same session; it stays idle until the lobby is opened.
    const lan = createLanMultiplayer(session);
    return { session, input, sound, lan };
}

/** Covers the game on a phone held upright (CSS shows it only in portrait on touch devices). */
function RotateHint() {
    const t = useT();
    return (
        <div className="eod-rotate-hint">
            <span>⟳</span>
            {t('ui.rotateDevice')}
        </div>
    );
}

const GAME_MANIFEST = '/echoes_of_dawn.webmanifest';

/**
 * While the game is open, the page's web-app manifest is the game's own (public/
 * echoes_of_dawn.webmanifest: fullscreen, landscape, starts here) instead of the site's, so
 * "Add to Home Screen" on this page installs the game.
 */
function useGameManifest() {
    useEffect(() => {
        const link = document.querySelector('link[rel="manifest"]');
        if (!link) return undefined;
        const siteManifest = link.getAttribute('href');
        link.setAttribute('href', GAME_MANIFEST);
        return () => link.setAttribute('href', siteManifest);
    }, []);
}

/** "Echoes of Dawn" - a story-driven space combat game set after Project Dawn. */
function EchoesOfDawn() {
    const [game, setGame] = useState(null);
    const inputSurfaceRef = useRef(null);
    const markerCanvasRef = useRef(null);
    const radarCanvasRef = useRef(null);
    const graphics = useGameStore((state) => state.settings.graphics);
    // Any click or tap goes fullscreen - again after Esc - and on phones too, so a game turned
    // sideways fills the screen. On a desktop only in production, like the rest of the site; on
    // a phone always (also when testing a dev build there). Safari on iPhone has no fullscreen
    // for pages at all: there the title screen suggests opening the game from the home screen.
    useGameManifest();
    // The page under the game holds still: no double-tap or pinch zoom, no scrolling, no rubber band.
    useEffect(() => lockPage(), []);
    useClickToFullscreen({ enabled: stageOfENV === 'prod' || isTouchDevice(), once: false, skipPortrait: false });

    useEffect(() => {
        const created = createGame();
        setGame(created);
        // Development aid: inspect or drive the running game from the browser console.
        if (stageOfENV !== 'prod') window.__eod = created;
        // When this device hosts a match, the match must not stop because this page is in the background.
        const stopHeartbeat = startHostHeartbeat(created.session);
        return () => {
            stopHeartbeat();
            created.lan.close();
            created.sound.dispose();
            created.session.dispose();
            useGameStore.setState({ assetsReady: false });
        };
    }, []);

    useEffect(() => {
        if (!game) return undefined;
        game.input.attach(inputSurfaceRef.current);
        // Leaving mid-fight should never cost the player their ship: pause when the tab is hidden,
        // the browser loses focus (another app or window in front) or the page is put away.
        // (A multiplayer match cannot be paused, so there it would only put a menu in the way.)
        const pause = () => { if (!game.session.match) game.session.pause(); };
        const pauseWhenHidden = () => { if (document.hidden) pause(); };
        document.addEventListener('visibilitychange', pauseWhenHidden);
        window.addEventListener('blur', pause);
        window.addEventListener('pagehide', pause);
        return () => {
            game.input.detach();
            document.removeEventListener('visibilitychange', pauseWhenHidden);
            window.removeEventListener('blur', pause);
            window.removeEventListener('pagehide', pause);
        };
    }, [game]);

    return (
        <>
            <Helmet>
                <title>Echoes of Dawn - a Captain Tim space combat story | Tim Bi</title>
                <meta name="description" content="Fly the Kestrel in first person, answer Captain Tim's distress call and fight alongside his fleet in a story-driven 3D space combat game built with React Three Fiber." />
                <meta name="keywords" content="Tim Bi, 毕天元, Echoes of Dawn, space combat game, three.js, react three fiber" />
                <meta property="og:title" content="Echoes of Dawn - a Captain Tim space combat story" />
                <meta property="og:description" content="Somebody heard the distress call. It was you. A story-driven first-person space combat game in Tim Bi's universe." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/echoes_of_dawn" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/echoes_of_dawn" />
                <meta name="author" content="Tim Bi" />
                {/* Opened from the home screen the game runs without browser bars (the only fullscreen an iPhone offers). */}
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="Echoes of Dawn" />
                <link rel="apple-touch-icon" href="/Tim%20Bi%20-%20App.webp" />
            </Helmet>

            <div className="eod-root">
                {game && (
                    <>
                        <div className="eod-canvas-container">
                            {/* No shadow maps (no light casts shadows) and, outside a headset, no canvas antialiasing: the composer does the smoothing. */}
                            <CanvasProvider glOptions={GL_OPTIONS} dpr={graphicsDpr(graphics)} antialias={canvasAntialias()} shadows={false}>
                                <GameScene game={game} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
                            </CanvasProvider>
                        </div>
                        <div ref={inputSurfaceRef} className="eod-input-surface" />
                        <GameHud session={game.session} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
                        <TouchControls input={game.input} session={game.session} />
                        <TutorialOverlay session={game.session} />
                        <Menus session={game.session} lan={game.lan} onStart={() => game.sound.unlock()} />
                        <RotateHint />
                    </>
                )}
            </div>
        </>
    );
}

export default EchoesOfDawn;
