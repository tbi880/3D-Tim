import { Suspense, useState } from 'react';
import Loader from '../../pages/Loader';
import { SuspenseGate, createSuspenseGate } from '../../utils/createSuspenseGate';
import { useGameStore, useT } from '../state/gameStore.js';
import AsteroidField from './AsteroidField.jsx';
import BeamsLayer from './BeamsLayer.jsx';
import ExplosionsLayer from './ExplosionsLayer.jsx';
import GameLoop from './GameLoop.jsx';
import HudCanvasBridge from './HudCanvasBridge.jsx';
import PlayerCamera from './PlayerCamera.jsx';
import PostEffects from './PostEffects.jsx';
import ProjectilesLayer from './ProjectilesLayer.jsx';
import SectorBackdrop from './SectorBackdrop.jsx';
import ShipsLayer from './ShipsLayer.jsx';
import { ShipModelPreloader } from './models/ShipModel.jsx';
import SpaceDust from './SpaceDust.jsx';

const markAssetsReady = () => useGameStore.setState({ assetsReady: true });

/**
 * Root of the 3D scene (rendered inside the site's CanvasProvider).
 *
 * Every component here is an observer of `game.session.world`: GameLoop advances the
 * simulation, the layers copy its state into three.js objects each frame.
 */
export default function GameScene({ game, markerCanvasRef, radarCanvasRef }) {
    const [gate] = useState(() => createSuspenseGate());
    const t = useT();
    const { session } = game;

    return (
        <Suspense
            fallback={(
                <Loader
                    isIntroNeeded={false}
                    extraContent={[t('ui.title'), t('ui.tagline'), t('ui.loading')]}
                    onFadeComplete={() => gate.resolve()}
                    onFinished={markAssetsReady}
                />
            )}
        >
            <SuspenseGate gate={gate} />
            <ShipModelPreloader />
            <GameLoop game={game} />
            <PlayerCamera session={session} />
            <SectorBackdrop />
            <AsteroidField session={session} />
            {/* Late-loading models must never bring the full-screen loader back. */}
            <Suspense fallback={null}>
                <ShipsLayer session={session} />
            </Suspense>
            <ProjectilesLayer session={session} />
            <BeamsLayer session={session} />
            <ExplosionsLayer session={session} />
            <SpaceDust session={session} />
            <HudCanvasBridge game={game} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
            <PostEffects session={session} />
        </Suspense>
    );
}
