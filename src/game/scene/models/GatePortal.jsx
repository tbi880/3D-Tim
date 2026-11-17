import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTION } from '../../config/gameConfig.js';

/**
 * The field across a stargate's opening: one disc, drawn by a shader, facing both ways.
 *
 * What it shows is the game mode's to say (World `gateField`):
 *   charge - asleep it is a faint film and a slow chase of lights round the rim; charged,
 *            the film thickens, arcs crawl in from the rim and the lights race
 *   open   - the way through opens from the middle outwards: a bright whirlpool
 *   pulse  - a ship has just gone through: a ring of light runs out to the rim
 *   shut   - it is dying: everything gutters and goes dark
 * and it wears the colour of the side that holds it.
 *
 * It only adds light (no depth is written), so ships can be seen flying into it and the
 * stars show through whatever is not lit.
 */

/** The field's colour for each side that can hold the gate, and its own when nobody does. */
const FIELD_COLORS = Object.freeze({
    [FACTION.DAWN]: new THREE.Color('#4fc3ff'),
    [FACTION.UMBRA]: new THREE.Color('#c45cff'),
    [FACTION.PIRATE]: new THREE.Color('#ffae42'),
});
const OWN_COLOR = new THREE.Color('#9fe8ff');
/** How quickly the colour follows a change of holder (1/s). */
const TINT_FOLLOW = 2;

const vertexShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vPoint;
    void main() {
        // -1..1 across the opening.
        vPoint = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

const fragmentShader = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float time;
    uniform float charge;
    uniform float open;
    uniform float shut;
    uniform float pulse;
    uniform vec3 tint;
    varying vec2 vPoint;

    float hash( vec2 p ) {
        return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    }
    float noise( vec2 p ) {
        vec2 cell = floor( p );
        vec2 f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( hash( cell ), hash( cell + vec2( 1.0, 0.0 ) ), f.x ),
                    mix( hash( cell + vec2( 0.0, 1.0 ) ), hash( cell + vec2( 1.0, 1.0 ) ), f.x ), f.y );
    }
    float clouds( vec2 p ) {
        return 0.55 * noise( p ) + 0.3 * noise( p * 2.1 + 7.3 ) + 0.15 * noise( p * 4.3 + 1.7 );
    }

    void main() {
        #include <logdepthbuf_fragment>
        float r = length( vPoint );
        if ( r > 1.0 ) discard;
        float angle = atan( vPoint.y, vPoint.x );
        float alive = 1.0 - shut;
        // A dying field stutters before it goes.
        float stutter = mix( 1.0, step( 0.35, noise( vec2( time * 23.0, 3.0 ) ) ), smoothstep( 0.0, 0.3, shut ) * alive );

        // The film: slow weather that turns round the middle, thicker towards the rim.
        float turn = time * 0.12;
        vec2 drift = vec2( cos( angle + turn ), sin( angle + turn ) ) * r * 3.2;
        float weather = clouds( drift + vec2( 0.0, time * 0.05 ) );
        float film = charge * ( 0.05 + 0.5 * weather * weather ) * ( 0.35 + 0.65 * r * r );
        // Arcs crawling in from the rim once it is charged.
        float arcs = pow( clouds( vec2( angle * 5.0, r * 9.0 - time * 1.6 ) ), 4.0 ) * smoothstep( 0.35, 1.0, r ) * charge * charge * 2.4;

        // The way through: a whirlpool that has opened as far as "reach", brightest in the middle.
        float reach = open * 1.08;
        float inside = ( 1.0 - smoothstep( reach - 0.14, reach, r ) ) * step( 0.001, open );
        float arms = 0.5 + 0.5 * sin( 5.0 * angle + 7.5 / ( r + 0.16 ) - time * 3.2 );
        float grain = clouds( vec2( angle * 3.0 + 4.0 / ( r + 0.2 ) - time * 1.1, r * 6.0 - time * 0.9 ) );
        float core = exp( -r * r * 9.0 );
        float pool = inside * ( 0.22 + 0.85 * arms * grain + 3.2 * core );
        // Its edge as it opens (and as it closes): a hard bright line.
        float edge = exp( -pow( ( r - reach ) * 20.0, 2.0 ) ) * step( 0.001, open ) * ( 1.0 - smoothstep( 0.9, 1.08, reach ) ) * 3.0;

        // A ship went through: a ring runs out from the middle, and the middle flares.
        float ripple = exp( -pow( ( r - ( 1.0 - pulse ) ) * 13.0, 2.0 ) ) * pulse * 2.6 + pulse * pulse * exp( -r * r * 14.0 ) * 4.0;

        // The lights round the rim: a slow chase asleep, racing when charged, all on when open.
        float band = smoothstep( 0.955, 0.968, r ) * ( 1.0 - smoothstep( 0.988, 1.0, r ) );
        float chase = fract( angle / 6.2831853 * 48.0 - time * ( 0.25 + 2.2 * charge ) );
        float lamps = band * mix( step( 0.62, chase ), 1.0, open ) * ( 0.35 + 1.9 * charge );

        vec3 hot = mix( tint, vec3( 1.0 ), 0.55 );
        vec3 colour = tint * ( film + arcs + lamps ) + mix( tint, hot, 0.5 + 0.5 * core ) * pool + hot * ( edge + ripple );
        gl_FragColor = vec4( colour * alive * stutter, 1.0 );
    }
`;

/**
 * @param {object} props
 * @param {number} props.radius metres from the gate's axis to the edge of its opening
 * @param {import('../../state/GameSession.js').GameSession} props.session
 */
export default function GatePortal({ radius, session }) {
    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 }, charge: { value: 0 }, open: { value: 0 }, shut: { value: 0 }, pulse: { value: 0 },
            tint: { value: OWN_COLOR.clone() },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    }), []);

    useEffect(() => () => material.dispose(), [material]);

    useFrame(({ clock }) => {
        const { uniforms } = material;
        const field = session.world.gateField;
        uniforms.time.value = clock.elapsedTime;
        uniforms.charge.value = field.charge;
        uniforms.open.value = field.open;
        uniforms.shut.value = field.shut;
        uniforms.pulse.value = field.pulse;
        uniforms.tint.value.lerp(FIELD_COLORS[field.faction] ?? OWN_COLOR, 1 - Math.exp(-TINT_FOLLOW * session.effectsDelta));
    });

    return (
        <mesh material={material} renderOrder={2}>
            <circleGeometry args={[radius, 96]} />
        </mesh>
    );
}
