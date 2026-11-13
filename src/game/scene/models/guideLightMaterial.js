import * as THREE from 'three';

/**
 * The guide lights of Lantern Station (tools/game-models/station/build_station.py): two lanes
 * of beacons running out from the dock mouths, plus steady lamps framing each mouth.
 *
 * Every lamp and housing is one mesh with one material, so the whole light show is a single
 * draw call and costs no CPU: the blinking is worked out per pixel from the time and from
 * what the model stores in each vertex colour.
 *
 *   R  where the lamp sits along its lane, 0 at the dock mouth .. 1 at the far end
 *   G  1 = departure lane, 0 = arrival lane, 0.5 = steady marker
 *   B  1 = lamp, 0 = the dark housing it sits in
 *
 * Pulses run outwards along the departure lane and inwards along the arrival lane, so the
 * lights always show which way to fly. Lamps are brighter than white so the bloom pass
 * makes them glow.
 */

export const GUIDE_LIGHTS = Object.freeze({
    departureColor: '#bfe6ff',
    arrivalColor: '#ffb04a',
    markerColor: '#7dffb3',
    housingColor: '#14161b',
    /** Pulses on a lane at any moment. */
    pulsesPerLane: 2,
    /** Lanes per second each pulse covers (0.45 = mouth to end in about two seconds). */
    pulseSpeed: 0.45,
    /** Brightness of a lamp between pulses, and at the crest of one. */
    idleBrightness: 0.35,
    pulseBrightness: 5.5,
    markerBrightness: 2.4,
});

export function createGuideLightMaterial() {
    const settings = GUIDE_LIGHTS;
    return new THREE.ShaderMaterial({
        name: 'guideLight',
        vertexColors: true,
        toneMapped: false,
        uniforms: {
            time: { value: 0 },
            departureColor: { value: new THREE.Color(settings.departureColor) },
            arrivalColor: { value: new THREE.Color(settings.arrivalColor) },
            markerColor: { value: new THREE.Color(settings.markerColor) },
            housingColor: { value: new THREE.Color(settings.housingColor) },
        },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec3 vCode;
            void main() {
                vCode = color.rgb;
                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                #include <logdepthbuf_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            uniform float time;
            uniform vec3 departureColor;
            uniform vec3 arrivalColor;
            uniform vec3 markerColor;
            uniform vec3 housingColor;
            varying vec3 vCode;
            const float PULSES = ${settings.pulsesPerLane.toFixed(1)};
            const float SPEED = ${(settings.pulseSpeed * settings.pulsesPerLane).toFixed(3)};
            void main() {
                #include <logdepthbuf_fragment>
                if ( vCode.b < 0.5 ) {
                    gl_FragColor = vec4( housingColor, 1.0 );
                    return;
                }
                float phase = vCode.r;
                float lane = vCode.g;
                vec3 colour;
                float brightness;
                if ( abs( lane - 0.5 ) < 0.25 ) {
                    // Dock mouth frame: steady, breathing slowly.
                    colour = markerColor;
                    brightness = ${settings.markerBrightness.toFixed(2)} * ( 0.8 + 0.2 * sin( time * 1.3 ) );
                } else {
                    // Time since a pulse front last passed this lamp, as a fraction of the gap
                    // between pulses: the lamp flashes on as the front arrives and fades behind
                    // it. The sign of the phase term sets which way the fronts travel
                    // (outwards on departure, inwards on arrival).
                    float outwards = lane > 0.5 ? 1.0 : -1.0;
                    float since = fract( time * SPEED - outwards * phase * PULSES );
                    float pulse = pow( 1.0 - since, 14.0 );
                    colour = lane > 0.5 ? departureColor : arrivalColor;
                    brightness = ${settings.idleBrightness.toFixed(2)} + ${settings.pulseBrightness.toFixed(2)} * pulse;
                }
                gl_FragColor = vec4( colour * brightness, 1.0 );
            }
        `,
    });
}
