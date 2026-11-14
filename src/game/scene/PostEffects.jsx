import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, ChromaticAberration, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Vector2 } from 'three';
import { useComposerMultisampling } from '../../hooks/useComposerMultisampling';
import { GRAPHICS } from '../config/graphics.js';
import { useGameStore } from '../state/gameStore.js';
import ManagedEffectComposer from '../../modelComponents/ManagedEffectComposer';

/** Colour fringing (as a fraction of the screen) at full warp and under afterburner. */
const WARP_ABERRATION = 0.012;
const BOOST_ABERRATION = 0.0018;

/**
 * Bloom makes beams, engines and explosions glow (their colours are deliberately brighter
 * than 1.0), then the image is tone-mapped back into displayable range. During a warp jump
 * the edges of the screen smear into colour fringes.
 */
export default function PostEffects({ session }) {
    // The preset's MSAA, still capped by the iOS memory guard.
    const graphics = useGameStore((state) => state.settings.graphics);
    const multisampling = Math.min(GRAPHICS[graphics].multisampling, useComposerMultisampling());
    // The effect keeps a reference to this vector, so updating it in place is enough.
    const aberrationOffset = useMemo(() => new Vector2(0, 0), []);

    useFrame(() => {
        const player = session.world.player;
        if (!player) return;
        const amount = session.world.warpFactor * WARP_ABERRATION + (player.boosting ? BOOST_ABERRATION : 0);
        aberrationOffset.set(amount, amount);
    });

    return (
        <ManagedEffectComposer multisampling={multisampling}>
            <Bloom mipmapBlur intensity={0.85} luminanceThreshold={1.0} luminanceSmoothing={0.25} />
            <ChromaticAberration offset={aberrationOffset} radialModulation modulationOffset={0.2} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette eskil={false} offset={0.18} darkness={0.5} />
        </ManagedEffectComposer>
    );
}
