import * as THREE from 'three';

/**
 * Photon torpedo visuals: the warhead itself, its plasma wake, the launch flash and the
 * impact burst. Everything is drawn with three draw calls, whatever is on screen:
 *
 *   sprites - camera-facing quads (one instanced mesh). A per-instance `type` picks the look:
 *             0 the warhead (white-hot core, coloured corona, slowly turning star spikes),
 *             1 launch flash, 2 impact flash, 3 shock ring.
 *   trails  - one ribbon per torpedo, built from the positions it passed through and turned
 *             to face the camera in the vertex shader. It runs white-hot behind the warhead,
 *             cools to the faction colour, widens and fades as it ages. When a torpedo dies
 *             its wake stays behind and fades out on its own.
 *   shells  - an expanding plasma sphere at each impact, bright at its rim (fresnel).
 *
 * The simulation knows nothing about this: launches and impacts are found by watching
 * torpedoes appear in and disappear from `world.projectiles`. A torpedo that leaves the list
 * still alive was cleared away (sector change, restart) and leaves no burst.
 *
 * Every shader clamps the bases of its pow() calls and drops NaN pixels, so the bloom pass
 * can never smear an invalid value over the screen.
 */

const MAX_TORPEDOES = 80;
const MAX_BURSTS = 128;
const MAX_SPRITES = MAX_TORPEDOES + MAX_BURSTS;
const MAX_SHELLS = 24;
const MAX_TRAILS = 112;
/** Recorded points per wake (plus the live head). */
const TRAIL_POINTS = 40;
/** How long one point of the wake lasts. */
const TRAIL_SECONDS = 0.55;

const TYPE_CORE = 0;
const TYPE_LAUNCH = 1;
const TYPE_IMPACT = 2;
const TYPE_RING = 3;

const WHITE = new THREE.Color(1, 1, 1);
const colorCache = new Map();
function parseColor(hex) {
    if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
    return colorCache.get(hex);
}

/* Writing straight into typed arrays: this runs for thousands of vertices a frame and must not allocate. */
function write3(array, offset, a, b, c) {
    array[offset] = a;
    array[offset + 1] = b;
    array[offset + 2] = c;
}

function write4(array, offset, a, b, c, d) {
    array[offset] = a;
    array[offset + 1] = b;
    array[offset + 2] = c;
    array[offset + 3] = d;
}

const NAN_GUARD = /* glsl */ `if ( any( isnan( gl_FragColor ) ) || any( isinf( gl_FragColor ) ) ) gl_FragColor = vec4( 0.0 );`;

/* ------------------------------------------------------------------------------------------ */
/* Sprites                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const SPRITE_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform float uTime;
    attribute vec3 aOffset;
    attribute vec4 aParams;   // width (m), progress 0..1, type, seed 0..1
    attribute vec3 aColor;
    varying vec2 vCorner;
    varying vec4 vParams;
    varying vec3 vColor;
    varying float vNear;
    void main() {
        vec4 mv = modelViewMatrix * vec4( aOffset, 1.0 );
        float width = aParams.x;
        float type = aParams.z;
        // The warhead's star slowly turns; flashes keep a random fixed angle.
        float angle = aParams.w * 6.2831853 + ( type < 0.5 ? uTime * 1.7 : 0.0 );
        float c = cos( angle );
        float s = sin( angle );
        vec2 corner = position.xy * 2.0;
        vec2 turned = vec2( corner.x * c - corner.y * s, corner.x * s + corner.y * c );
        float dist = length( mv.xyz );
        // Flashes sit on a hull; pull them a little towards the camera so the hull does not cut them in half.
        if ( type > 0.5 && dist > 1e-3 ) mv.xyz -= mv.xyz / dist * min( width * 0.3, dist * 0.5 );
        mv.xy += turned * 0.5 * width;
        // A sprite much wider than its distance would fill the screen (your own launch, a hit on
        // your own ship): dim it instead of blinding the player.
        vNear = mix( 0.12, 1.0, smoothstep( width * 0.35, width * 2.2, dist ) );
        vCorner = corner;
        vParams = aParams;
        vColor = aColor;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
    }
`;

const SPRITE_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform float uTime;
    varying vec2 vCorner;
    varying vec4 vParams;
    varying vec3 vColor;
    varying float vNear;

    /** Four thin rays along the quad's axes. */
    float spikes( vec2 c, float thinness ) {
        vec2 a = abs( c );
        float h = pow( max( 0.0, 1.0 - a.y * thinness ), 2.0 ) * pow( max( 0.0, 1.0 - a.x ), 1.5 );
        float v = pow( max( 0.0, 1.0 - a.x * thinness ), 2.0 ) * pow( max( 0.0, 1.0 - a.y ), 1.5 );
        return h + v;
    }

    void main() {
        #include <logdepthbuf_fragment>
        vec2 c = vCorner;
        float r = length( c );
        float p = clamp( vParams.y, 0.0, 1.0 );
        float type = vParams.z;
        float seed = vParams.w;
        float edge = 1.0 - r;
        vec3 colour;
        if ( type < 0.5 ) {
            // The warhead: a white-hot point inside a coloured corona, gently flickering.
            float flicker = 0.84 + 0.1 * sin( uTime * 37.0 + seed * 50.0 ) + 0.06 * sin( uTime * 91.0 + seed * 13.0 );
            float core = exp( -r * r * 55.0 );
            float corona = pow( max( 0.0, edge ), 3.2 );
            colour = vec3( 1.0 ) * core * 4.0 + vColor * ( corona * 1.5 + spikes( c, 16.0 ) * 1.2 );
            colour *= flicker;
        } else if ( type < 1.5 ) {
            // Launch: a hard, short flash with long rays.
            float k = pow( 1.0 - p, 2.0 );
            float core = exp( -r * r * 30.0 );
            float glow = pow( max( 0.0, edge ), 2.5 );
            colour = ( vec3( 1.0 ) * core * 3.0 + vColor * ( glow * 1.1 + spikes( c, 22.0 ) * 2.2 ) ) * k;
        } else if ( type < 2.5 ) {
            // Impact: blinding at first, the core shrinking as the light spreads out.
            float k = pow( 1.0 - p, 1.6 );
            float core = exp( -r * r * ( 16.0 + 70.0 * p ) );
            float glow = pow( max( 0.0, edge ), 2.0 );
            colour = ( vec3( 1.0 ) * core * 5.0 + vColor * ( glow * 1.3 + spikes( c, 26.0 ) * 2.4 ) ) * k;
        } else {
            // Shock ring: races out and slows, uneven like a real blast front.
            float radius = 0.92 * ( 1.0 - pow( 1.0 - p, 3.0 ) );
            float w = 0.028 + 0.06 * p;
            float d = ( r - radius ) / w;
            float ring = exp( -d * d );
            float angle = atan( c.y, c.x + 1e-6 );
            float wobble = 0.68 + 0.32 * sin( angle * 7.0 + seed * 40.0 ) * sin( angle * 3.0 - seed * 17.0 );
            colour = mix( vec3( 1.0 ), vColor, smoothstep( 0.0, 0.35, p ) ) * ring * wobble * pow( 1.0 - p, 1.5 ) * 1.6;
        }
        colour *= step( r, 1.0 ) * vNear;
        gl_FragColor = vec4( max( colour, vec3( 0.0 ) ), 1.0 );
        ${NAN_GUARD}
    }
`;

class SpriteBatch {
    constructor(capacity) {
        this.capacity = capacity;
        this.count = 0;
        const plane = new THREE.PlaneGeometry(1, 1);
        this.geometry = new THREE.InstancedBufferGeometry();
        this.geometry.index = plane.index;
        this.geometry.setAttribute('position', plane.getAttribute('position'));
        this.offsets = this.addAttribute('aOffset', 3);
        this.params = this.addAttribute('aParams', 4);
        this.colors = this.addAttribute('aColor', 3);
        this.attributes = [this.offsets, this.params, this.colors];
        this.geometry.instanceCount = 0;
        this.uniforms = { uTime: { value: 0 } };
        this.material = new THREE.ShaderMaterial({
            vertexShader: SPRITE_VERTEX,
            fragmentShader: SPRITE_FRAGMENT,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;
    }

    addAttribute(name, size) {
        const attribute = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
        attribute.setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute(name, attribute);
        return attribute;
    }

    begin() {
        this.count = 0;
    }

    push(position, width, progress, type, seed, color) {
        if (this.count >= this.capacity) return;
        const i = this.count++;
        write3(this.offsets.array, i * 3, position.x, position.y, position.z);
        write4(this.params.array, i * 4, width, progress, type, seed);
        write3(this.colors.array, i * 3, color.r, color.g, color.b);
    }

    end(time) {
        this.geometry.instanceCount = this.count;
        this.mesh.visible = this.count > 0;
        this.uniforms.uTime.value = time;
        if (this.count === 0) return;
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, this.count * attribute.itemSize);
            attribute.needsUpdate = true;
        }
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}

/* ------------------------------------------------------------------------------------------ */
/* Trails                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const TRAIL_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 aTangent;
    attribute vec4 aInfo;     // side (-1 / 1), age 0 (head) .. 1 (gone), width (m), seed
    attribute vec3 aColor;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vSeed;
    void main() {
        float age = clamp( aInfo.y, 0.0, 1.0 );
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vec3 tangent = mat3( modelViewMatrix ) * aTangent;
        // Sideways = across the path and across the line of sight, so the ribbon always faces us.
        vec3 side = cross( tangent, mv.xyz );
        float len = length( side );
        side = len > 1e-6 ? side / len : vec3( 1.0, 0.0, 0.0 );
        // The wake spreads out as the plasma cools.
        float width = aInfo.z * mix( 0.55, 1.9, sqrt( age ) );
        mv.xyz += side * aInfo.x * width;
        vUv = vec2( age, aInfo.x );
        vColor = aColor;
        vSeed = aInfo.w;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
    }
`;

const TRAIL_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vSeed;
    void main() {
        #include <logdepthbuf_fragment>
        float age = clamp( vUv.x, 0.0, 1.0 );
        float across = clamp( abs( vUv.y ), 0.0, 1.0 );
        float life = pow( 1.0 - age, 1.5 );
        float body = pow( 1.0 - across, 1.7 );
        float core = pow( 1.0 - across, 7.0 ) * pow( 1.0 - age, 3.0 );
        // Bright knots of plasma shed by the warhead, drifting back along the wake.
        float knots = 0.72 + 0.28 * sin( age * 46.0 - uTime * 24.0 + vSeed * 31.0 );
        // Faint twisting filaments so the wake is not a flat stripe.
        float strands = 0.8 + 0.2 * sin( vUv.y * 5.0 + age * 17.0 + uTime * 6.0 + vSeed * 7.0 );
        vec3 hot = mix( vec3( 1.0 ), vColor, smoothstep( 0.0, 0.3, age ) );
        vec3 colour = hot * body * life * knots * strands * 1.7 + vec3( 1.0 ) * core * 2.4;
        gl_FragColor = vec4( max( colour, vec3( 0.0 ) ), 1.0 );
        ${NAN_GUARD}
    }
`;

const VERTS_PER_TRAIL = (TRAIL_POINTS + 1) * 2;

class TrailBatch {
    constructor(capacity) {
        this.capacity = capacity;
        const vertexCount = capacity * VERTS_PER_TRAIL;
        this.positions = new Float32Array(vertexCount * 3);
        this.tangents = new Float32Array(vertexCount * 3);
        this.info = new Float32Array(vertexCount * 4);
        this.colors = new Float32Array(vertexCount * 3);
        this.indices = new Uint16Array(capacity * TRAIL_POINTS * 6);
        this.geometry = new THREE.BufferGeometry();
        this.attributes = [
            this.attribute('position', this.positions, 3),
            this.attribute('aTangent', this.tangents, 3),
            this.attribute('aInfo', this.info, 4),
            this.attribute('aColor', this.colors, 3),
        ];
        this.index = new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setIndex(this.index);
        this.geometry.setDrawRange(0, 0);
        this.uniforms = { uTime: { value: 0 } };
        this.material = new THREE.ShaderMaterial({
            vertexShader: TRAIL_VERTEX,
            fragmentShader: TRAIL_FRAGMENT,
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.vertexCount = 0;
        this.indexCount = 0;
    }

    attribute(name, array, size) {
        const attribute = new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute(name, attribute);
        return attribute;
    }

    begin() {
        this.vertexCount = 0;
        this.indexCount = 0;
    }

    /**
     * Adds one wake. `points` runs from the head backwards: [x, y, z, age 0..1] per point.
     */
    push(points, length, width, seed, color) {
        if (length < 2) return;
        const first = this.vertexCount;
        let tx = 0;
        let ty = 0;
        let tz = -1;
        for (let i = 0; i < length; i++) {
            const point = points[i];
            // Tangent from the neighbours (one-sided at the ends). Two points can coincide
            // (the head right after a sample); then the previous direction is kept.
            const ahead = points[Math.max(0, i - 1)];
            const behind = points[Math.min(length - 1, i + 1)];
            const ax = ahead[0] - behind[0];
            const ay = ahead[1] - behind[1];
            const az = ahead[2] - behind[2];
            if (ax * ax + ay * ay + az * az > 1e-8) {
                tx = ax;
                ty = ay;
                tz = az;
            }
            for (let side = -1; side <= 1; side += 2) {
                const v = this.vertexCount++;
                write3(this.positions, v * 3, point[0], point[1], point[2]);
                write3(this.tangents, v * 3, tx, ty, tz);
                write4(this.info, v * 4, side, point[3], width, seed);
                write3(this.colors, v * 3, color.r, color.g, color.b);
            }
        }
        for (let i = 0; i < length - 1; i++) {
            const a = first + i * 2;
            const k = this.indexCount;
            const indices = this.indices;
            indices[k] = a;
            indices[k + 1] = a + 1;
            indices[k + 2] = a + 2;
            indices[k + 3] = a + 1;
            indices[k + 4] = a + 3;
            indices[k + 5] = a + 2;
            this.indexCount += 6;
        }
    }

    end(time) {
        this.uniforms.uTime.value = time;
        this.geometry.setDrawRange(0, this.indexCount);
        this.mesh.visible = this.indexCount > 0;
        if (this.indexCount === 0) return;
        for (const attribute of this.attributes) {
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, this.vertexCount * attribute.itemSize);
            attribute.needsUpdate = true;
        }
        this.index.clearUpdateRanges();
        this.index.addUpdateRange(0, this.indexCount);
        this.index.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}

/** The recorded path of one torpedo. */
class Wake {
    constructor() {
        this.points = Array.from({ length: TRAIL_POINTS + 1 }, () => [0, 0, 0, 0]);
        /** Ring buffer of recorded points: x, y, z, time recorded. */
        this.history = Array.from({ length: TRAIL_POINTS }, () => [0, 0, 0, 0]);
        this.reset();
    }

    reset() {
        this.active = false;
        this.attached = false;
        this.head = 0;
        this.size = 0;
        this.width = 1;
        this.spacing = 1;
        this.seed = 0;
        this.color = WHITE;
        this.headPosition = null;
    }

    start(position, radius, color, now) {
        this.reset();
        this.active = true;
        this.attached = true;
        this.width = radius * 1.25;
        this.spacing = Math.max(1.5, radius * 1.1);
        this.seed = Math.random();
        this.color = color;
        this.headPosition = position;
        this.record(position, now);
    }

    record(position, now) {
        // Points closer together than `spacing` add nothing; the live head fills the gap.
        if (this.size > 0) {
            const newest = this.history[(this.head - 1 + TRAIL_POINTS) % TRAIL_POINTS];
            const sx = position.x - newest[0];
            const sy = position.y - newest[1];
            const sz = position.z - newest[2];
            if (sx * sx + sy * sy + sz * sz < this.spacing * this.spacing) return;
        }
        const slot = this.history[this.head];
        slot[0] = position.x;
        slot[1] = position.y;
        slot[2] = position.z;
        slot[3] = now;
        this.head = (this.head + 1) % TRAIL_POINTS;
        this.size = Math.min(TRAIL_POINTS, this.size + 1);
    }

    /** Fills `points` (head first) and returns how many; drops points that have aged out. */
    build(now) {
        let count = 0;
        // An attached wake ends at its torpedo's current position.
        const headPosition = this.attached ? this.headPosition : null;
        if (headPosition) {
            const p = this.points[count++];
            p[0] = headPosition.x;
            p[1] = headPosition.y;
            p[2] = headPosition.z;
            p[3] = 0;
        }
        let kept = 0;
        for (let i = 0; i < this.size; i++) {
            const h = this.history[(this.head - 1 - i + TRAIL_POINTS * 2) % TRAIL_POINTS];
            const age = (now - h[3]) / TRAIL_SECONDS;
            if (age >= 1) break;
            const p = this.points[count++];
            p[0] = h[0];
            p[1] = h[1];
            p[2] = h[2];
            p[3] = Math.max(0, age);
            kept += 1;
        }
        this.size = kept;
        if (!this.attached && kept === 0) this.active = false;
        return count;
    }
}

/* ------------------------------------------------------------------------------------------ */
/* Impact shells                                                                               */
/* ------------------------------------------------------------------------------------------ */

const SHELL_VERTEX = /* glsl */ `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 aShell;   // progress 0..1, seed
    attribute vec3 aColor;
    varying vec3 vNormalView;
    varying vec3 vToCamera;
    varying vec3 vLocal;
    varying vec2 vShell;
    varying vec3 vColor;
    void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        vNormalView = mat3( modelViewMatrix ) * mat3( instanceMatrix ) * normal;
        vToCamera = -mv.xyz;
        vLocal = position;
        vShell = aShell;
        vColor = aColor;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
    }
`;

const SHELL_FRAGMENT = /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    varying vec3 vNormalView;
    varying vec3 vToCamera;
    varying vec3 vLocal;
    varying vec2 vShell;
    varying vec3 vColor;
    void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize( vNormalView + vec3( 0.0, 0.0, 1e-6 ) );
        vec3 v = normalize( vToCamera + vec3( 0.0, 0.0, 1e-5 ) );
        float facing = clamp( abs( dot( n, v ) ), 0.0, 1.0 );
        float rim = pow( 1.0 - facing, 2.4 );
        float p = clamp( vShell.x, 0.0, 1.0 );
        float seed = vShell.y;
        // Rippling bands of plasma crawling over the surface.
        float ripple = 0.65 + 0.35 * sin( vLocal.x * 7.0 + vLocal.y * 5.0 - vLocal.z * 6.0 + seed * 40.0 - p * 22.0 );
        float k = pow( 1.0 - p, 2.2 );
        vec3 hot = mix( vec3( 1.0 ), vColor, smoothstep( 0.0, 0.35, p ) );
        vec3 colour = hot * ( rim * 2.0 + facing * 0.08 ) * ripple * k;
        gl_FragColor = vec4( max( colour, vec3( 0.0 ) ), 1.0 );
        ${NAN_GUARD}
    }
`;

class ShellBatch {
    constructor(capacity) {
        this.capacity = capacity;
        this.count = 0;
        this.geometry = new THREE.SphereGeometry(1, 20, 14);
        this.shell = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
        this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('aShell', this.shell);
        this.geometry.setAttribute('aColor', this.colors);
        this.material = new THREE.ShaderMaterial({
            vertexShader: SHELL_VERTEX,
            fragmentShader: SHELL_FRAGMENT,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        this.mesh.count = 0;
        this.matrix = new THREE.Matrix4();
    }

    begin() {
        this.count = 0;
    }

    push(position, radius, progress, seed, color) {
        if (this.count >= this.capacity) return;
        const i = this.count++;
        this.matrix.makeScale(radius, radius, radius).setPosition(position);
        this.mesh.setMatrixAt(i, this.matrix);
        this.shell.array[i * 2] = progress;
        this.shell.array[i * 2 + 1] = seed;
        write3(this.colors.array, i * 3, color.r, color.g, color.b);
    }

    end() {
        this.mesh.count = this.count;
        this.mesh.visible = this.count > 0;
        if (this.count === 0) return;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.shell.needsUpdate = true;
        this.colors.needsUpdate = true;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose();
    }
}

/* ------------------------------------------------------------------------------------------ */
/* The whole effect                                                                            */
/* ------------------------------------------------------------------------------------------ */

/** A short-lived flash, ring or shell. */
class Burst {
    constructor() {
        this.kind = 'sprite';
        this.type = TYPE_IMPACT;
        this.position = new THREE.Vector3();
        this.color = WHITE;
        this.size = 1;
        this.life = 0;
        this.maxLife = 1;
        this.delay = 0;
        this.seed = 0;
    }
}

export class TorpedoEffects {
    constructor() {
        this.sprites = new SpriteBatch(MAX_SPRITES);
        this.trails = new TrailBatch(MAX_TRAILS);
        this.shells = new ShellBatch(MAX_SHELLS);
        this.group = new THREE.Group();
        this.group.add(this.trails.mesh, this.shells.mesh, this.sprites.mesh);

        this.wakes = Array.from({ length: MAX_TRAILS }, () => new Wake());
        this.bursts = Array.from({ length: MAX_BURSTS }, () => new Burst());
        this.burstCursor = 0;
        /** id -> { projectile, wake, seed, frame } */
        this.tracked = new Map();
        this.frame = 0;
        this.clock = 0;
        /** The first update after a reset adopts torpedoes already in flight without a launch flash. */
        this.primed = false;
    }

    /** Forgets everything at once (sector change): nothing from the old sky lingers. */
    reset() {
        this.tracked.clear();
        for (const wake of this.wakes) wake.reset();
        for (const burst of this.bursts) burst.life = 0;
        this.primed = false;
    }

    addBurst(kind, type, position, size, life, color, delay = 0) {
        const burst = this.bursts[this.burstCursor];
        this.burstCursor = (this.burstCursor + 1) % MAX_BURSTS;
        burst.kind = kind;
        burst.type = type;
        burst.position.copy(position);
        burst.color = color;
        burst.size = size;
        burst.life = life;
        burst.maxLife = life;
        burst.delay = delay;
        burst.seed = Math.random();
    }

    launch(projectile, color) {
        const r = projectile.radius;
        this.addBurst('sprite', TYPE_LAUNCH, projectile.position, r * 6, 0.18, color);
        this.addBurst('sprite', TYPE_RING, projectile.position, r * 5, 0.25, color);
    }

    impact(position, radius, color) {
        // Heavy warheads are bigger, but not so much that one hit hides the whole ship.
        const r = Math.min(radius, 3.5);
        this.addBurst('sprite', TYPE_IMPACT, position, r * 16, 0.45, color);
        this.addBurst('sprite', TYPE_RING, position, r * 24, 0.65, color);
        // A second, wider front a beat later sells the size of the blast.
        this.addBurst('sprite', TYPE_RING, position, r * 38, 0.9, color, 0.08);
        this.addBurst('shell', 0, position, r * 9, 0.55, color);
    }

    allocateWake() {
        for (const wake of this.wakes) if (!wake.active) return wake;
        // All busy: reuse the most faded detached wake rather than drop the new one.
        return this.wakes.find((wake) => !wake.attached) ?? null;
    }

    /**
     * @param {object} world the simulation world
     * @param {number} dt effect time step (0 while paused)
     */
    update(world, dt) {
        this.clock += dt;
        const now = this.clock;
        this.frame += 1;
        const frame = this.frame;

        this.sprites.begin();
        this.trails.begin();
        this.shells.begin();

        // Torpedoes in flight.
        let torpedoCount = 0;
        for (const projectile of world.projectiles) {
            if (projectile.kind !== 'torpedo' || !projectile.alive) continue;
            const color = parseColor(projectile.color);
            let entry = this.tracked.get(projectile.id);
            if (!entry) {
                const wake = this.allocateWake();
                if (wake) wake.start(projectile.position, projectile.radius, color, now);
                entry = { projectile, wake, seed: Math.random(), frame };
                this.tracked.set(projectile.id, entry);
                if (this.primed) this.launch(projectile, color);
            }
            entry.frame = frame;
            if (entry.wake && dt > 0) entry.wake.record(projectile.position, now);
            if (torpedoCount < MAX_TORPEDOES) {
                const pulse = 1 + 0.12 * Math.sin(now * 21 + entry.seed * 40);
                this.sprites.push(projectile.position, projectile.radius * 6 * pulse, 0, TYPE_CORE, entry.seed, color);
                torpedoCount += 1;
            }
        }
        this.primed = true;

        // Torpedoes that are gone: a burst where they died (only if they were destroyed, not cleared away).
        for (const [id, entry] of this.tracked) {
            if (entry.frame === frame) continue;
            this.tracked.delete(id);
            const { projectile, wake } = entry;
            if (!projectile.alive) {
                this.impact(projectile.position, projectile.radius, parseColor(projectile.color));
                if (wake) {
                    wake.attached = false;
                    wake.headPosition = null;
                }
            } else if (wake) {
                wake.reset();
            }
        }

        // Wakes.
        for (const wake of this.wakes) {
            if (!wake.active) continue;
            const count = wake.build(now);
            this.trails.push(wake.points, count, wake.width, wake.seed, wake.color);
        }

        // Flashes, rings and shells.
        for (const burst of this.bursts) {
            if (burst.life <= 0) continue;
            if (burst.delay > 0) {
                burst.delay -= dt;
                continue;
            }
            burst.life -= dt;
            if (burst.life <= 0) continue;
            const progress = 1 - burst.life / burst.maxLife;
            if (burst.kind === 'shell') {
                const grow = 1 - (1 - progress) ** 3;
                this.shells.push(burst.position, burst.size * (0.15 + 0.85 * grow), progress, burst.seed, burst.color);
            } else {
                const width = burst.type === TYPE_RING ? burst.size : burst.size * (0.55 + 0.45 * Math.sqrt(progress));
                this.sprites.push(burst.position, width, progress, burst.type, burst.seed, burst.color);
            }
        }

        this.sprites.end(now);
        this.trails.end(now);
        this.shells.end();
    }

    dispose() {
        this.sprites.dispose();
        this.trails.dispose();
        this.shells.dispose();
    }
}
