import * as THREE from 'three';
import { FACTION } from '../../config/gameConfig.js';
import { forwardOf } from '../../core/math.js';
import { WARP_IN_DISTANCE, arrivalHeft, warpDisplacement } from './warpPath.js';

/**
 * What it looks like when a ship drops out of warp near you.
 *
 * Arrival happens in two acts, and the bigger the hull the longer and louder each one is:
 *
 *  1. Inbound (while `ship.warpTimer` runs down). The hull is a streak racing in and braking
 *     hard (ShipsLayer stretches it). Behind it burns a WAKE - a tapering tube of hot light,
 *     pulsing as it goes - and at the spot where it will stop a BEACON gathers: a pinpoint
 *     that swells into a glint with a long horizontal streak, so you know where to look.
 *
 *  2. Landing. A FLARE (a wide, short-lived glint) goes off. The warp BUBBLE - a shell around
 *     the hull, stretched long along the direction of travel - snaps down onto the hull and
 *     then sheds its energy as a bright band that sweeps from bow to stern. Big ships also
 *     push out a SHOCK wave across their path, briefly light up their surroundings, and add
 *     a jolt of camera shake / colour fringing if you are close (see `arrivalShock`).
 *
 * Everything is pooled: a fixed set of meshes and materials is made once, so arrivals never
 * allocate or compile shaders mid-battle. When more ships arrive at once than there are
 * slots, the smallest ones go without (they still get the basic flash from ExplosionsLayer).
 * Every shader clamps its pow() bases and screens out NaN (see ExhaustPlume.js for why).
 */

export const MAX_ARRIVALS = 10;

const ARRIVAL_COLORS = Object.freeze({
    [FACTION.DAWN]: new THREE.Color('#8fd8ff'),
    [FACTION.UMBRA]: new THREE.Color('#d47cff'),
    [FACTION.NEUTRAL]: new THREE.Color('#e4eeff'),
});

/** Billboards are capped so a station-sized arrival does not white out the whole view. */
const MAX_GLINT_HEIGHT = 2400;
const MAX_SHOCK_SIZE = 9000;

/**
 * Shared "how hard did that just hit" pulse (0..1) from big ships landing near the player.
 * PostEffects turns it into a brief colour fringe; it decays on its own.
 */
export const arrivalShock = { value: 0 };

// ---- Shaders -----------------------------------------------------------------------------

const BILLBOARD_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vP;
    void main() {
        vP = position.xy * 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
    }
`;

/** A glint: round hot core, long horizontal streak, faint vertical spike. `aspect` = width / height of the quad. */
const GLINT_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float strength;
    uniform float aspect;
    uniform float time;
    varying vec2 vP;
    void main() {
        #include <logdepthbuf_fragment>
        float ax = abs( vP.x );
        float ay = abs( vP.y );
        float r = length( vec2( vP.x * aspect, vP.y ) );
        float core = pow( clamp( 1.0 - r, 0.0, 1.0 ), 3.0 );
        float streak = exp( -ay * ay * 70.0 ) * pow( clamp( 1.0 - ax, 0.0, 1.0 ), 2.0 );
        float spikeX = ax * aspect;
        float spike = exp( -spikeX * spikeX * 120.0 ) * pow( clamp( 1.0 - ay, 0.0, 1.0 ), 3.0 ) * 0.35;
        float shimmer = 0.85 + 0.15 * sin( time * 31.0 + ax * 23.0 );
        float glow = core * 1.6 + streak * shimmer + spike;
        vec3 colour = mix( tint, vec3( 1.0 ), clamp( core * 1.3 + streak * 0.25, 0.0, 1.0 ) );
        gl_FragColor = vec4( colour * glow * strength, 1.0 );
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

/** The wake: a unit tube along +Z (0 = head, 1 = tail), drawn as a glowing volume that tapers away. */
const WAKE_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform float taper;
    varying float vAlong;
    varying float vFacing;
    void main() {
        float along = position.z;
        vec3 local = vec3( position.xy * ( 1.0 - taper * along ), along );
        vec4 mvPosition = modelViewMatrix * vec4( local, 1.0 );
        vec3 outward = normalize( normalMatrix * vec3( position.xy, 0.0 ) );
        vFacing = abs( dot( outward, normalize( vec3( 0.0, 0.0, 1e-5 ) - mvPosition.xyz ) ) );
        vAlong = along;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const WAKE_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float strength;
    uniform float time;
    uniform float seed;
    varying float vAlong;
    varying float vFacing;
    void main() {
        #include <logdepthbuf_fragment>
        float a = clamp( vAlong, 0.0, 1.0 );
        float f = clamp( vFacing, 0.0, 1.0 );
        float body = pow( f, 2.5 );
        float hot = pow( f, 12.0 );
        float fade = pow( 1.0 - a, 1.6 ) * smoothstep( 0.0, 0.015, a );
        // Knots of brightness running down the wake.
        float pulses = 0.72 + 0.28 * sin( a * 90.0 - time * 55.0 + seed ) * sin( a * 23.0 + time * 17.0 + seed * 3.0 );
        vec3 colour = mix( tint, vec3( 1.0 ), clamp( hot * 1.5 + ( 1.0 - a ) * 0.25, 0.0, 1.0 ) );
        gl_FragColor = vec4( colour * ( body * 0.9 + hot * 2.0 ) * fade * pulses * strength, 1.0 );
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

/** The warp bubble: a shell around the hull, bright at its outline, with a band sweeping bow (z = -1) to stern. */
const BUBBLE_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vNormalView;
    varying vec3 vToCamera;
    varying float vZ;
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vNormalView = normalMatrix * normal;
        vToCamera = vec3( 0.0, 0.0, 1e-5 ) - mvPosition.xyz;
        vZ = position.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
    }
`;

const BUBBLE_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float strength;
    uniform float time;
    uniform float sweep;
    varying vec3 vNormalView;
    varying vec3 vToCamera;
    varying float vZ;
    void main() {
        #include <logdepthbuf_fragment>
        float facing = clamp( abs( dot( normalize( vNormalView ), normalize( vToCamera ) ) ), 0.0, 1.0 );
        float rim = pow( 1.0 - facing, 3.0 );
        float z = clamp( vZ * 0.5 + 0.5, 0.0, 1.0 );
        float offset = ( z - sweep ) * 7.0;
        float band = exp( -offset * offset );
        float ripples = 0.6 + 0.4 * sin( z * 38.0 - time * 24.0 );
        float glow = rim * ( 0.5 + ripples * 0.7 ) + band * ( 0.25 + rim ) * 1.4;
        vec3 colour = mix( tint, vec3( 1.0 ), clamp( band * 0.8 + rim * rim * 0.5, 0.0, 1.0 ) );
        gl_FragColor = vec4( colour * glow * strength, 1.0 );
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

/** The shock wave: a ragged ring on a quad lying across the ship's path. `radius` / `width` are in quad units (edge = 1). */
const SHOCK_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 tint;
    uniform float strength;
    uniform float radius;
    uniform float width;
    uniform float time;
    uniform float seed;
    varying vec2 vP;
    void main() {
        #include <logdepthbuf_fragment>
        float r = length( vP );
        float angle = atan( vP.y, vP.x + 1e-6 );
        float wobble = radius * ( 0.012 * sin( angle * 9.0 + seed + time * 1.5 ) + 0.007 * sin( angle * 23.0 - seed * 2.0 ) );
        float d = ( r - radius - wobble ) / max( width, 1e-3 );
        float ring = exp( -d * d );
        float inside = ( 1.0 - smoothstep( 0.0, max( radius, 1e-3 ), r ) ) * 0.15;
        float edge = 1.0 - smoothstep( 0.9, 1.0, r );
        vec3 colour = mix( tint, vec3( 1.0 ), ring * 0.5 );
        gl_FragColor = vec4( colour * ( ring + inside ) * edge * strength, 1.0 );
        if ( any( isnan( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );
    }
`;

// ---- Helpers ---------------------------------------------------------------------------

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;
const smooth = (edge0, edge1, x) => {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
};

function effectMaterial(vertexShader, fragmentShader, uniforms, side = THREE.FrontSide) {
    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side,
        blending: THREE.AdditiveBlending,
    });
}

const scratchForward = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

/** One arrival's worth of meshes and its state. */
class ArrivalSlot {
    constructor(geometries) {
        this.color = new THREE.Color();
        const seed = Math.random() * 100;
        const glintUniforms = () => ({ tint: { value: this.color }, strength: { value: 0 }, aspect: { value: 4 }, time: { value: 0 } });

        this.wake = new THREE.Mesh(geometries.tube, effectMaterial(WAKE_VERTEX, WAKE_FRAGMENT, {
            tint: { value: this.color }, strength: { value: 0 }, time: { value: 0 }, seed: { value: seed }, taper: { value: 0.75 },
        }));
        this.beacon = new THREE.Mesh(geometries.quad, effectMaterial(BILLBOARD_VERTEX, GLINT_FRAGMENT, glintUniforms()));
        this.flare = new THREE.Mesh(geometries.quad, effectMaterial(BILLBOARD_VERTEX, GLINT_FRAGMENT, glintUniforms()));
        this.bubble = new THREE.Mesh(geometries.sphere, effectMaterial(BUBBLE_VERTEX, BUBBLE_FRAGMENT, {
            tint: { value: this.color }, strength: { value: 0 }, time: { value: 0 }, sweep: { value: 0 },
        }));
        this.shock = new THREE.Mesh(geometries.quad, effectMaterial(BILLBOARD_VERTEX, SHOCK_FRAGMENT, {
            tint: { value: this.color }, strength: { value: 0 }, radius: { value: 0 }, width: { value: 0.04 }, time: { value: 0 }, seed: { value: seed },
        }, THREE.DoubleSide));
        this.meshes = [this.wake, this.beacon, this.flare, this.bubble, this.shock];
        for (const mesh of this.meshes) {
            mesh.visible = false;
            mesh.renderOrder = 3;
        }
        this.reset();
    }

    reset() {
        this.ship = null;
        this.phase = 'idle';
        this.t = 0;
        this.age = 0;
        this.heft = 0;
        this.trail = 0;
        for (const mesh of this.meshes) mesh.visible = false;
    }

    get busy() {
        return this.phase !== 'idle';
    }

    start(ship) {
        this.ship = ship;
        this.phase = 'inbound';
        this.t = 0;
        this.age = 0;
        this.heft = arrivalHeft(ship);
        this.size = Math.max(4, ship.boundingRadius);
        this.trail = 0;
        this.color.copy(ARRIVAL_COLORS[ship.faction] ?? ARRIVAL_COLORS[FACTION.NEUTRAL]);
        // Half-size of the bubble along the ship's x, y, z.
        this.extent = ship.halfExtents
            ? ship.halfExtents.clone().multiplyScalar(1.35)
            : new THREE.Vector3(1, 1, 1).multiplyScalar(ship.radius * 1.35);
        // Wide enough to sheath the streaking hull, so big ships arrive wrapped in light.
        this.wakeWidth = ship.halfExtents ? Math.max(ship.halfExtents.x, ship.halfExtents.y) * 1.15 : Math.max(1.5, ship.radius * 0.35);
        const heft = this.heft;
        this.bubbleLife = 0.9 + heft * 2.2;
        this.flareLife = 0.35 + heft * 0.8;
        this.wakeLife = 0.8 + heft * 1.8;
        this.shockLife = heft > 0.3 ? 1.0 + heft * 2.0 : 0;
        this.totalLife = Math.max(this.bubbleLife, this.flareLife, this.wakeLife, this.shockLife);
    }

    /** The moment the ship comes to rest. */
    land(onLand) {
        this.phase = 'landed';
        this.t = 0;
        this.landedTrail = this.trail;
        this.beacon.visible = false;
        onLand?.(this);
    }

    /** @returns {boolean} still running */
    update(dt, time, camera, onLand) {
        const ship = this.ship;
        this.age += dt;
        for (const mesh of this.meshes) {
            if (mesh.material.uniforms.time) mesh.material.uniforms.time.value = time;
        }

        if (this.phase === 'inbound') {
            // Removed before it landed (jumped away, scene changed): just stop.
            if (!ship.alive) { this.reset(); return false; }
            if (ship.warpTimer <= 0) this.land(onLand);
            else {
                this.updateInbound(camera);
                return true;
            }
        }

        this.t += dt;
        if (this.t >= this.totalLife) { this.reset(); return false; }
        this.updateLanded(camera);
        return true;
    }

    updateInbound(camera) {
        const ship = this.ship;
        const heft = this.heft;
        const progress = clamp01(1 - ship.warpTimer / ship.warpDuration);
        const displacement = warpDisplacement(ship);
        forwardOf(ship.quaternion, scratchForward);

        // Wake: from the streaking hull back along the way it came.
        const travelled = (1 - Math.abs(displacement)) * WARP_IN_DISTANCE;
        this.trail = Math.min(travelled, 1200 + this.size * 14, WARP_IN_DISTANCE);
        const wake = this.wake;
        wake.visible = this.trail > 1;
        wake.position.copy(ship.position).addScaledVector(scratchForward, displacement * WARP_IN_DISTANCE);
        wake.quaternion.copy(ship.quaternion);
        wake.scale.set(this.wakeWidth, this.wakeWidth, Math.max(1, this.trail));
        wake.material.uniforms.strength.value = (1.8 + heft * 1.4) * smooth(0, 0.08, progress);

        // Beacon: gathers where the ship will stop.
        const beacon = this.beacon;
        const glow = smooth(0.15, 1, progress);
        beacon.visible = glow > 0.001;
        const height = Math.min(MAX_GLINT_HEIGHT, Math.max(30, this.size * 2.2)) * (0.35 + 0.65 * glow);
        const aspect = 4 + heft * 3;
        beacon.position.copy(ship.position);
        beacon.quaternion.copy(camera.quaternion);
        beacon.scale.set(height * aspect, height, 1);
        beacon.material.uniforms.aspect.value = aspect;
        beacon.material.uniforms.strength.value = glow * glow * (0.7 + heft * 1.8);
    }

    updateLanded(camera) {
        const ship = this.ship;
        const heft = this.heft;
        const t = this.t;
        // The ship may be gone already (destroyed straight away); the light show finishes where it landed.
        const anchor = ship.position;

        // Wake: drains into the hull and fades.
        const wakeProgress = clamp01(t / this.wakeLife);
        const wake = this.wake;
        wake.visible = wakeProgress < 1 && this.landedTrail > 1;
        if (wake.visible) {
            const length = Math.max(1, this.landedTrail * (1 - easeOutCubic(wakeProgress)) * 0.6 + this.size * 0.5);
            const width = this.wakeWidth * (1 + wakeProgress * 0.6);
            wake.position.copy(anchor);
            wake.quaternion.copy(ship.quaternion);
            wake.scale.set(width, width, length);
            wake.material.uniforms.strength.value = (1.8 + heft * 1.4) * (1 - wakeProgress) ** 2;
        }

        // Flare: the bang of arrival.
        const flareProgress = clamp01(t / this.flareLife);
        const flare = this.flare;
        flare.visible = flareProgress < 1;
        if (flare.visible) {
            const height = Math.min(MAX_GLINT_HEIGHT, Math.max(30, this.size * 1.2)) * (1 + 0.35 * flareProgress);
            const aspect = 5 + heft * 3;
            flare.position.copy(anchor);
            flare.quaternion.copy(camera.quaternion);
            flare.scale.set(height * aspect, height, 1);
            flare.material.uniforms.aspect.value = aspect;
            flare.material.uniforms.strength.value = (2.2 + heft * 2.5) * (1 - flareProgress) ** 2.5;
        }

        // Bubble: snaps down onto the hull, then sheds a band of light bow to stern.
        const bubbleProgress = clamp01(t / this.bubbleLife);
        const bubble = this.bubble;
        bubble.visible = bubbleProgress < 1;
        if (bubble.visible) {
            const collapse = easeOutCubic(t / 0.3);
            const radial = 1.4 + (1 - 1.4) * collapse;
            const stretch = 2.6 + (1 - 2.6) * collapse;
            bubble.position.copy(anchor);
            bubble.quaternion.copy(ship.quaternion);
            bubble.scale.set(this.extent.x * radial, this.extent.y * radial, this.extent.z * stretch);
            const uniforms = bubble.material.uniforms;
            uniforms.sweep.value = -0.15 + bubbleProgress * 1.35;
            const fadeIn = 0.6 + 0.4 * collapse;
            uniforms.strength.value = (0.8 + heft * 0.8) * fadeIn * (1 - bubbleProgress) ** 1.6;
        }

        // Shock wave across the ship's path (larger ships only).
        const shock = this.shock;
        const shockProgress = this.shockLife > 0 ? clamp01(t / this.shockLife) : 1;
        shock.visible = shockProgress < 1;
        if (shock.visible) {
            const size = Math.min(MAX_SHOCK_SIZE, this.size * (3 + heft * 3));
            shock.position.copy(anchor);
            shock.quaternion.copy(ship.quaternion);
            shock.scale.set(size * 2, size * 2, 1);
            const uniforms = shock.material.uniforms;
            uniforms.radius.value = 0.06 + 0.84 * easeOutCubic(shockProgress);
            uniforms.width.value = 0.015 + 0.03 * shockProgress;
            uniforms.strength.value = (0.4 + heft * 0.5) * (1 - shockProgress) ** 2;
        }
    }

    dispose() {
        for (const mesh of this.meshes) mesh.material.dispose();
    }
}

/**
 * All the arrival effects in one THREE.Group: add `group` to the scene, call `start(ship)`
 * when a ship begins its warp-in and `update(...)` every frame. Landing is detected from the
 * ship itself (its warp timer running out), so the two can never get out of step.
 */
export class WarpArrivalEffects {
    constructor() {
        this.geometries = {
            tube: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
            quad: new THREE.PlaneGeometry(1, 1),
            sphere: new THREE.SphereGeometry(1, 32, 20),
        };
        this.group = new THREE.Group();
        // One light for the whole pool, always in the scene (at zero) so the light count never changes.
        this.light = new THREE.PointLight('#ffffff', 0, 1, 2);
        this.lightState = { life: 0, maxLife: 1, peak: 0 };
        this.group.add(this.light);
        this.slots = Array.from({ length: MAX_ARRIVALS }, () => new ArrivalSlot(this.geometries));
        for (const slot of this.slots) slot.meshes.forEach((mesh) => this.group.add(mesh));
        this.time = 0;
        this.player = null;
        this.onLand = (slot) => this.handleLanding(slot);
    }

    /** A ship has started its warp-in. Small craft give way to large ones when every slot is in use. */
    start(ship) {
        if (!ship?.cls?.model) return;
        if (this.slots.some((slot) => slot.ship === ship && slot.busy)) return;
        let slot = this.slots.find((candidate) => !candidate.busy);
        if (!slot) {
            const heft = arrivalHeft(ship);
            // The least important running effect: smallest ship, and of those the furthest along.
            slot = this.slots.reduce((weakest, candidate) => {
                if (candidate.heft !== weakest.heft) return candidate.heft < weakest.heft ? candidate : weakest;
                return candidate.age > weakest.age ? candidate : weakest;
            });
            if (slot.heft > heft) return;
            slot.reset();
        }
        slot.start(ship);
    }

    handleLanding(slot) {
        const heft = slot.heft;
        const ship = slot.ship;
        if (heft > 0.3) {
            // Light up the neighbourhood for a moment (inverse-square: intensity grows with reach squared).
            const reach = Math.min(6000, slot.size * 4);
            const state = this.lightState;
            if (state.life <= 0 || reach >= this.light.distance * 0.8) {
                this.light.position.copy(ship.position);
                this.light.color.copy(slot.color).lerp(WHITE, 0.5);
                this.light.distance = reach;
                Object.assign(state, { life: 1.2, maxLife: 1.2, peak: 4 * (reach / 4.4) ** 2 });
            }
        }
        const player = this.player;
        if (player?.alive) {
            const distance = player.position.distanceTo(ship.position);
            const near = clamp01(1 - distance / (slot.size * 12 + 1500));
            arrivalShock.value = Math.max(arrivalShock.value, heft * near);
        }
    }

    /** After a jump: effects of ships that did not come along must not hang in the new sky. */
    dropDeparted() {
        for (const slot of this.slots) {
            if (slot.busy && !slot.ship.alive) slot.reset();
        }
    }

    /** Forget everything (new game / reload). */
    clear() {
        for (const slot of this.slots) slot.reset();
        this.lightState.life = 0;
        this.light.intensity = 0;
        arrivalShock.value = 0;
    }

    update(dt, camera, player) {
        this.player = player;
        if (dt <= 0) return;
        this.time += dt;
        for (const slot of this.slots) {
            if (slot.busy) slot.update(dt, this.time, camera, this.onLand);
        }
        const state = this.lightState;
        state.life = Math.max(0, state.life - dt);
        this.light.intensity = state.life > 0 ? state.peak * (state.life / state.maxLife) ** 2 : 0;
        arrivalShock.value *= Math.exp(-dt * 3.5);
        if (arrivalShock.value < 0.002) arrivalShock.value = 0;
    }

    dispose() {
        for (const slot of this.slots) slot.dispose();
        Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    }
}
