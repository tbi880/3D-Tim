import { Vector3 } from 'three';

/**
 * What being under fire does to the pilot's surroundings: worked out once a frame by
 * PlayerCamera, read by whatever shows it (the flat view's camera shake, the VR cabin's
 * shudder, the instrument display that rides with the cabin).
 */
export const playerFeedback = {
    /** 0..1: how hard a sustained beam from a larger ship is bearing on the ship right now (eased). */
    beamRumble: 0,
    /**
     * VR only: how far the cabin has shuddered out of place this frame, in metres along the
     * seat's axes. In a headset the view itself must never shake (that makes people sick),
     * so there the cabin shakes round the pilot instead and the stars stay still.
     */
    cabinShake: new Vector3(),
};

/** Ships whose beams are heavy enough to be felt: everything larger than a fighter. */
const HEAVY_KINDS = new Set(['capital', 'station', 'module']);
const SUSTAINED_BEAMS = new Set(['beam', 'cannon']);

/** Whether a sustained beam from a medium or large ship is on `ship` this frame. */
export function underHeavyBeam(world, ship) {
    return world.beams.some((beam) => beam.to === ship && SUSTAINED_BEAMS.has(beam.kind) && HEAVY_KINDS.has(beam.from?.cls.kind));
}

/** Whether a HIT event is damage to the bare hull (shield down) of the ship this device flies. */
export function isHullHitOnPlayer(world, { target, shield, amount }) {
    return Boolean(target) && target === world.player && !shield && amount > 0;
}
