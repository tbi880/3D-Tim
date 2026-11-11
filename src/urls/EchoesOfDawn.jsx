import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { bucketURL, stageOfENV } from '../Settings';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import { SoundEngine } from '../game/audio/SoundEngine.js';
import { InputController } from '../game/input/InputController.js';
import GameScene from '../game/scene/GameScene.jsx';
import { GameSession } from '../game/state/GameSession.js';
import { gameStoreSink, useGameStore } from '../game/state/gameStore.js';
import GameHud from '../game/ui/GameHud.jsx';
import Menus from '../game/ui/Menus.jsx';
import TouchControls from '../game/ui/TouchControls.jsx';
import '../game/ui/hud.css';

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
    return { session, input, sound };
}

/** "Echoes of Dawn" - a first-person space combat story set after Project Dawn. */
function EchoesOfDawn() {
    const [game, setGame] = useState(null);
    const inputSurfaceRef = useRef(null);
    const markerCanvasRef = useRef(null);
    const radarCanvasRef = useRef(null);

    useEffect(() => {
        const created = createGame();
        setGame(created);
        // Development aid: inspect or drive the running game from the browser console.
        if (stageOfENV !== 'prod') window.__eod = created;
        return () => {
            created.sound.dispose();
            created.session.dispose();
            useGameStore.setState({ assetsReady: false });
        };
    }, []);

    useEffect(() => {
        if (!game) return undefined;
        game.input.attach(inputSurfaceRef.current);
        // Leaving the tab mid-fight should never cost the player their ship.
        const pauseWhenHidden = () => { if (document.hidden) game.session.pause(); };
        document.addEventListener('visibilitychange', pauseWhenHidden);
        return () => {
            game.input.detach();
            document.removeEventListener('visibilitychange', pauseWhenHidden);
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
            </Helmet>

            <div className="eod-root">
                {game && (
                    <>
                        <div className="eod-canvas-container">
                            <CanvasProvider>
                                <GameScene game={game} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
                            </CanvasProvider>
                        </div>
                        <div ref={inputSurfaceRef} className="eod-input-surface" />
                        <GameHud session={game.session} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
                        <TouchControls input={game.input} session={game.session} />
                        <Menus session={game.session} onStart={() => game.sound.unlock()} />
                    </>
                )}
            </div>
        </>
    );
}

export default EchoesOfDawn;
