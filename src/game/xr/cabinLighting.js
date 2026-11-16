import * as THREE from 'three';

/**
 * The cabin's ambient light in VR: one colour that follows the ship, shared by everything
 * that shows it - the cabin's light strips and the glow they cast (VRCockpitShell) and the
 * flight sticks in the pilot's hands (VRFlightStick). VRCameraRig updates it once a frame.
 *
 *  - its colour is the power mode's - blue balanced, cyan defense, red attack - and fades
 *    between them;
 *  - with the hull critical it throbs red;
 *  - on the afterburner the pulses along the light strips run faster.
 */

/** Ambient-light colours per power mode. */
const AMBIENT_COLOURS = Object.freeze({
    balanced: new THREE.Color('#3f7bff'),
    defense: new THREE.Color('#25d6d0'),
    attack: new THREE.Color('#ff3346'),
});
const ALARM_COLOUR = new THREE.Color('#ff2a2a');
/** Below this hull fraction the cabin throbs red, this many times a second. */
const ALARM_HULL = 0.3;
const ALARM_RATE = 1.4;
/** How fast the colour follows a mode change (1/s). */
const COLOUR_FOLLOW = 3.5;
/** Travelling pulses along the light strips: metres apart, metres per second. */
export const PULSE_SPACING = 2.6;
const PULSE_SPEED = 0.9;
const BOOST_PULSE_SPEED = 3.2;

/** Brightness of the light strips (they are not tone mapped, so 1 = full colour). */
export const LINE_BRIGHTNESS = 0.9;
/** Brightness of the glow the lights cast on the models (their baked emissive maps). */
export const GLOW_BRIGHTNESS = 1.6;
/**
 * A faint light of its own on every surface, in the surface's own colour: a headset shows
 * near-black as black, and the sectors' ambient light is deliberately small.
 */
const SELF_LIGHT = 0.7;

const modeColour = AMBIENT_COLOURS.balanced.clone();
let time = 0;

export const ambientLight = {
    /** The colour shown this frame. */
    colour: AMBIENT_COLOURS.balanced.clone(),
    /** How far the pulses along the strips have travelled, in metres, kept within one
     * spacing: the pattern repeats there, and small numbers stay exact on the GPU. */
    travel: 0,

    /** @param hud the game store's `hud` (may be null between flights) */
    update(hud, delta) {
        time += delta;
        modeColour.lerp(AMBIENT_COLOURS[hud?.powerMode] ?? AMBIENT_COLOURS.balanced, 1 - Math.exp(-COLOUR_FOLLOW * delta));
        this.colour.copy(modeColour);
        if (hud?.alive && hud.hull < ALARM_HULL) {
            this.colour.lerp(ALARM_COLOUR, 0.5 - 0.5 * Math.cos(time * ALARM_RATE * Math.PI * 2));
        }
        this.travel = (this.travel + delta * (hud?.boosting ? BOOST_PULSE_SPEED : PULSE_SPEED)) % PULSE_SPACING;
    },
};

/**
 * Gives a baked model's material its self light: a light map of one white texel, which is
 * light that needs no light in the scene. Returns a function that takes it away again.
 */
export function addSelfLight(material) {
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    material.lightMap = white;
    material.lightMapIntensity = SELF_LIGHT;
    material.needsUpdate = true;
    return () => {
        material.lightMap = null;
        material.needsUpdate = true;
        white.dispose();
    };
}
