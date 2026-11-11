import { Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useComposerMultisampling } from '../../hooks/useComposerMultisampling';
import ManagedEffectComposer from '../../modelComponents/ManagedEffectComposer';

/**
 * Bloom makes beams, engines and explosions glow (their colours are deliberately brighter
 * than 1.0), then the image is tone-mapped back into displayable range.
 */
export default function PostEffects() {
    const multisampling = useComposerMultisampling();
    return (
        <ManagedEffectComposer multisampling={multisampling}>
            <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.9} luminanceSmoothing={0.25} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette eskil={false} offset={0.18} darkness={0.5} />
        </ManagedEffectComposer>
    );
}
