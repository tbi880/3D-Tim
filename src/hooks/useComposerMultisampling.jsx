import { useThree } from "@react-three/fiber";
import { isIOSDevice } from "../utils/deviceProfile";

// EffectComposer defaults to 8x MSAA (the GPU clamps it to 4x) on a half-float
// colour + depth buffer, i.e. ~48 bytes per screen pixel. On an iPad at DPR 1.5 that
// buffer alone is over 100 MB of the page's iOS memory budget. Above this pixel
// count on iOS we skip MSAA; the high pixel ratio already hides most jaggies.
const IOS_MSAA_PIXEL_BUDGET = 1_000_000;

export function useComposerMultisampling() {
    const pixels = useThree((state) => state.size.width * state.size.height * state.viewport.dpr * state.viewport.dpr);
    if (!isIOSDevice) return 8;
    return pixels > IOS_MSAA_PIXEL_BUDGET ? 0 : 8;
}
