import { Suspense, useState } from 'react';
import { XR } from '@react-three/xr';
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
import { PlayerShipLoader, ShipModelPreloader } from './models/ShipModel.jsx';
import SpaceDust from './SpaceDust.jsx';
import WarpArrivalsLayer from './WarpArrivalsLayer.jsx';
import VRCameraRig from '../xr/VRCameraRig.jsx';
import { getXRStore, useVRActive } from '../xr/vrState.js';

const markAssetsReady = () => useGameStore.setState({ assetsReady: true });

/**
 * Root of the 3D scene (rendered inside the site's CanvasProvider).
 *
 * Every component here is an observer of `game.session.world`: GameLoop advances the
 * simulation, the layers copy its state into three.js objects each frame.
 *
 * Wrapped in the WebXR context so the same scene can be shown in a VR headset. In VR there is
 * no post-processing: the composer cannot draw in stereo, and its full-screen passes are the
 * most expensive part of a frame. The renderer's own ACES tone mapping takes over there.
 */
export default function GameScene({ game, markerCanvasRef, radarCanvasRef }) {
    const [gate] = useState(() => createSuspenseGate());
    const t = useT();
    const { session } = game;
    const vrActive = useVRActive();

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
            <XR store={getXRStore()}>
                <SuspenseGate gate={gate} />
                <ShipModelPreloader />
                <GameLoop game={game} />
                <PlayerCamera session={session}>
                    <VRCameraRig game={game} />
                </PlayerCamera>
                <SectorBackdrop />
                <AsteroidField session={session} />
                {/* Late-loading models must never bring the full-screen loader back. */}
                <Suspense fallback={null}>
                    <ShipsLayer session={session} />
                </Suspense>
                <PlayerShipLoader />
                <ProjectilesLayer session={session} />
                <BeamsLayer session={session} />
                <ExplosionsLayer session={session} />
                <WarpArrivalsLayer session={session} />
                <SpaceDust session={session} />
                <HudCanvasBridge game={game} markerCanvasRef={markerCanvasRef} radarCanvasRef={radarCanvasRef} />
                {!vrActive && <PostEffects session={session} />}
            </XR>
        </Suspense>
    );
}
