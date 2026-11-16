import * as THREE from 'three';

/**
 * The cabin's ambient light in VR: one colour that follows the ship, shared by everything
 * that shows it - the cabin's light strips and the glow they cast (VRCockpitShell) and the
 * flight sticks in the pilot's hands (VRFlightStick). VRCameraRig updates it once a frame.
 *
 *  - its colour is the power mode's - blue balanced, cyan defense, red attack - and fades
 *    between them;
 *  - with the hull critical it throbs red;
 *  - on the afterburner the pulses along the light strips run faster;
 *  - when the bare hull is hit (shield down) the lights stutter for a moment, as if the
 *    ship's power had been knocked.
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

/** A hit's stutter fades at this rate (1/s); while it lasts the lights drop out this many times a second. */
const DISTURBANCE_DECAY = 2.4;
const STUTTER_RATE = 17;
/** How dark a drop-out is (fraction of normal brightness). */
const STUTTER_LEVEL = 0.2;

const modeColour = AMBIENT_COLOURS.balanced.clone();
let time = 0;
let disturbance = 0;
let stutterUntil = 0;
let stutterDark = false;

export const ambientLight = {
    /** The colour shown this frame. */
    colour: AMBIENT_COLOURS.balanced.clone(),
    /** How far the pulses along the strips have travelled, in metres, kept within one
     * spacing: the pattern repeats there, and small numbers stay exact on the GPU. */
    travel: 0,
    /** Brightness of every cabin light this frame (1 = normal), lower while they stutter. */
    level: 1,

    /** The power takes a knock: the lights stutter. `strength` 0..1 is how badly. */
    disturb(strength) {
        disturbance = Math.min(1, disturbance + strength);
    },

    /** @param hud the game store's `hud` (may be null between flights) */
    update(hud, delta) {
        time += delta;
        modeColour.lerp(AMBIENT_COLOURS[hud?.powerMode] ?? AMBIENT_COLOURS.balanced, 1 - Math.exp(-COLOUR_FOLLOW * delta));
        this.colour.copy(modeColour);
        if (hud?.alive && hud.hull < ALARM_HULL) {
            this.colour.lerp(ALARM_COLOUR, 0.5 - 0.5 * Math.cos(time * ALARM_RATE * Math.PI * 2));
        }
        this.travel = (this.travel + delta * (hud?.boosting ? BOOST_PULSE_SPEED : PULSE_SPEED)) % PULSE_SPACING;

        disturbance = Math.max(0, disturbance - DISTURBANCE_DECAY * delta);
        if (time >= stutterUntil) {
            // Irregular: each stretch of light or dark lasts a random fraction of the beat.
            stutterUntil = time + (0.3 + Math.random()) / STUTTER_RATE;
            stutterDark = Math.random() < disturbance;
        }
        this.level = disturbance > 0.02 && stutterDark ? STUTTER_LEVEL + (1 - STUTTER_LEVEL) * (1 - disturbance) : 1;
    },
};

/**
 * Gives a baked model's material its self light: a light map of one white texel, which is
 * light that needs no light in the scene. Returns a function that takes it away again.
 *
 * It also takes the material out of reach of the scene's point lights. Those are the battle's
 * flashes (explosions, a ship dropping out of warp), always mounted so that no shader has to
 * be rebuilt when one goes off, and so worked out for every pixel of every lit surface even
 * while they are dark. The cabin fills half of each eye's picture and none of them ever
 * shines into it: its shader leaves them out (the sun and the sky's reflections stay).
 */
export function addSelfLight(material) {
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    material.lightMap = white;
    material.lightMapIntensity = SELF_LIGHT;
    material.onBeforeCompile = withoutPointLights;
    material.needsUpdate = true;
    return () => {
        material.lightMap = null;
        material.needsUpdate = true;
        white.dispose();
    };
}

/** The line in three.js's lighting code that starts the loop over the point lights. */
const POINT_LIGHT_LOOP = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';

/** `onBeforeCompile`: the standard lighting code with the point-light loop switched off. */
function withoutPointLights(shader) {
    const lighting = THREE.ShaderChunk.lights_fragment_begin;
    // Should a later three.js word that line differently, the material simply stays as it was.
    if (!lighting.includes(POINT_LIGHT_LOOP)) return;
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lighting.replace(POINT_LIGHT_LOOP, '#if 0'));
}
