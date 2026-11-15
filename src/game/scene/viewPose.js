import { Quaternion, Vector3 } from 'three';

/**
 * Where the viewer's eye is this frame, in world space, for effects that face or follow it
 * (sky dome, dust, billboards). PlayerCamera writes it every frame before the views run.
 *
 * Outside VR this is simply the camera. In VR the scene's camera is the headset's, whose
 * `position` / `quaternion` are relative to the cockpit seat rather than to the world, so
 * effects read the eye from here instead of from `state.camera`.
 */
export const viewPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    /** Vertical field of view (degrees) and the height in pixels of one rendered view. */
    fov: 68,
    pixelHeight: 1080,
};
