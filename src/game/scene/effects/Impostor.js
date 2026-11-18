import * as THREE from 'three';

/**
 * A picture of something far away, shown on one flat sheet in its place.
 *
 * A planet or a black hole hundreds of thousands of kilometres off looks the same from
 * anywhere in the battle and changes slowly, yet as a model it costs its triangles, its draw
 * calls and its materials' shading on every pixel it covers, every frame, twice in a headset.
 * An impostor draws the model into a texture a few times a second and shows that texture on
 * a single sheet (one draw call, two triangles, one texture read per pixel).
 *
 * The picture is exact, not an approximation: it is taken from the viewer's eye, and the
 * sheet stands square to the line of sight at the model's own distance, filling the very
 * frustum the picture was taken with. Turning the head or the ship does not change what a
 * far-away thing looks like from one spot, so the picture only goes stale as the model
 * animates or the eye travels, which is what the refreshes are for.
 *
 * How the model is kept out of the normal picture: its meshes sit on a layer of their own
 * (`layer`) that only this impostor's camera sees. They stay in the main scene, so they are
 * lit by its lights (which must be on every layer) and its environment map.
 *
 * In a headset the picture is not taken while a frame is being drawn, but in a task of its
 * own between two frames. A headset's GPU draws the eyes' multisampled, foveated buffer in
 * one go, and three.js itself notes that such a buffer "doesn't work properly" with flushes
 * in mid-frame, which turning to another render target is. This is a precaution: it has not
 * been seen to fail in a headset, and the desktop emulator, whose "headset buffer" is the
 * page's canvas, could not show it if it did.
 */

/** Texture pixels per degree of sky: a little more than a headset's lenses resolve. */
const PIXELS_PER_DEGREE = 22;
const MIN_SIZE = 256;
const MAX_SIZE = 2048;
/** Textures up to this size are multisampled; above it the memory is not worth it. */
const MULTISAMPLED_UP_TO = 1280;
/** The picture is this much wider than the model, for parts that swing out as it animates. */
const MARGIN = 1.08;
/** Something filling more of the sky than this (half-angle) no longer fits a flat sheet. */
const MAX_HALF_ANGLE = THREE.MathUtils.degToRad(62);

const sheetGeometry = new THREE.PlaneGeometry(1, 1);
const scratchColor = new THREE.Color();
const scratchToward = new THREE.Vector3();
const scratchTurn = new THREE.Quaternion();

/**
 * A body being pulled into a black hole (`tear`): how far it is drawn out towards the hole when
 * it has fallen all the way (in its own radii), and how many times the picture's size the sheet
 * is then - room for the body's point and the stream of matter leaving it.
 */
const TORN_STRETCH = 1.1;
const TORN_ROOM = 2.6;

/**
 * The sheet's texture lookup (three.js's `map_fragment`), bent: the side of the picture
 * towards the hole is drawn out to a point, the whole of it goes dark and red, a stream of
 * its matter runs off towards the hole - and, once the hole has it, what is left slides down
 * that stream and shrinks to nothing. With every `torn*` at rest this is the plain lookup.
 */
const TORN_MAP = /* glsl */ `
    #ifdef USE_MAP
        // In the picture's own measure: the picture is -0.5..0.5, the sheet tornRoom times that.
        vec2 tornPoint = ( vMapUv - 0.5 ) * tornRoom;
        float tornOut = dot( tornPoint, tornToward );
        vec2 tornAcross = tornPoint - tornOut * tornToward;
        float tornLeft = max( 1.0 - tornGone, 0.001 );
        float tornAlong = tornOut - tornGone * 0.26 * tornRoom;
        float tornNear = max( tornAlong, 0.0 );
        vec2 tornSource = ( tornToward * ( tornAlong - tornNear * tornAmount / ( 1.0 + tornAmount ) )
            + tornAcross * ( 1.0 + 2.2 * tornAmount * tornNear ) ) / tornLeft + 0.5;
        float tornInside = step( 0.0, tornSource.x ) * step( tornSource.x, 1.0 ) * step( 0.0, tornSource.y ) * step( tornSource.y, 1.0 );
        vec4 sampledDiffuseColor = texture2D( map, clamp( tornSource, 0.0, 1.0 ) ) * tornInside;
        sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.5, 0.17, 0.13 ), tornDark );
        sampledDiffuseColor *= 1.0 - tornGone;
        // The stream: thin where it has furthest to go, with clots running down it. Light only (no alpha).
        float tornReach = 0.5 * tornRoom;
        float tornWidth = 0.004 + 0.032 * ( 1.15 - tornOut / tornReach );
        float tornFlow = exp( -pow( length( tornAcross ) / tornWidth, 2.0 ) ) * smoothstep( 0.05, 0.4, tornOut ) * smoothstep( tornReach, tornReach * 0.5, tornOut )
            * ( 0.72 + 0.28 * sin( tornOut * 95.0 - tornTime * 6.0 ) );
        sampledDiffuseColor.rgb += vec3( 1.0, 0.5, 0.22 ) * tornFlow * tornStream * 0.8;
        diffuseColor *= sampledDiffuseColor;
    #endif
`;
const TORN_UNIFORMS = /* glsl */ `
    uniform vec2 tornToward;
    uniform float tornAmount;
    uniform float tornDark;
    uniform float tornGone;
    uniform float tornStream;
    uniform float tornRoom;
    uniform float tornTime;
`;

export class Impostor {
    /** While true no impostor takes a new picture (for measuring what the pictures cost: xr/vrBenchmark.js). */
    static frozen = false;

    /** @param {number} layer the three.js layer the model's meshes are on (see `hideFromMainCameras`) */
    constructor(layer) {
        this.layer = layer;
        this.camera = new THREE.PerspectiveCamera(30, 1, 1, 10);
        this.camera.layers.set(layer);
        this.target = null;
        // The picture is drawn over a transparent background, which leaves its colours already
        // multiplied by their alpha: blend it as such.
        this.material = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor,
            blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        });
        /** How the body is being torn by a black hole (see `tear`); at rest, the picture is shown as it is. */
        this.torn = {
            tornToward: { value: new THREE.Vector2(1, 0) }, tornAmount: { value: 0 }, tornDark: { value: 0 }, tornGone: { value: 0 },
            tornStream: { value: 0 }, tornRoom: { value: 1 }, tornTime: { value: 0 },
        };
        this.material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this.torn);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>\n${TORN_UNIFORMS}`)
                .replace('#include <map_fragment>', TORN_MAP);
        };
        /** The sheet. Add it to the scene; give it the model's parent so both share a frame. */
        this.mesh = new THREE.Mesh(sheetGeometry, this.material);
        this.mesh.visible = false;
        /** Set whenever the sheet was drawn: lets the owner skip refreshes while it is out of view. */
        this.seen = false;
        /** The timer of a picture waiting to be taken between two headset frames, or null. */
        this.pending = null;
        this.mesh.onBeforeRender = () => { this.seen = true; };
    }

    /** Puts every mesh under `root` on this impostor's layer, where the main cameras do not look. */
    hideFromMainCameras(root) {
        root.traverse((node) => node.layers.set(this.layer));
    }

    /**
     * Aims the camera and the sheet at a sphere holding the model.
     * @param {THREE.Vector3} eye the viewer's eye (world)
     * @param {THREE.Vector3} centre the sphere's centre (world)
     * @param {number} radius the sphere's radius
     * @param {THREE.Object3D} parent the sheet's parent, whose world matrix is up to date
     */
    aim(eye, centre, radius, parent) {
        const { camera, mesh } = this;
        const distance = eye.distanceTo(centre);
        const reach = radius * MARGIN;
        const halfAngle = Math.min(MAX_HALF_ANGLE, Math.asin(Math.min(1, reach / distance)));
        camera.position.copy(eye);
        camera.lookAt(centre);
        camera.fov = THREE.MathUtils.radToDeg(2 * halfAngle);
        camera.near = Math.max(distance * 0.01, distance - reach);
        camera.far = distance + reach;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();

        mesh.position.copy(centre);
        parent.worldToLocal(mesh.position);
        mesh.quaternion.copy(camera.quaternion);
        // (Bigger than the picture while the body is being torn: see `tear`. Nothing of it once it is gone.)
        mesh.scale.setScalar(this.torn.tornGone.value >= 1 ? 0 : 2 * distance * Math.tan(halfAngle) * this.torn.tornRoom.value);
        this.halfAngle = halfAngle;
    }

    /**
     * A black hole is pulling the body in. Call after `aim`, every frame it is so (and once with
     * `falling` 0 when it is over).
     * @param {THREE.Vector3} toHole unit direction of the hole in the sky (world)
     * @param {number} falling 0..1 how far the body has been drawn out towards it
     * @param {number} gone 0..1 how far it has been torn away altogether (1: nothing is drawn)
     * @param {number} time seconds, for the stream's flow
     */
    tear(toHole, falling, gone, time) {
        const { torn, mesh } = this;
        const atRest = falling <= 0 && gone <= 0;
        if (atRest && torn.tornRoom.value === 1) return;
        // The hole's direction as the sheet sees it: across its face. A hole dead ahead or dead astern of the body pulls no way one could draw.
        const across = scratchToward.copy(toHole).applyQuaternion(scratchTurn.copy(mesh.quaternion).invert());
        const length = Math.hypot(across.x, across.y);
        if (length > 0.02) torn.tornToward.value.set(across.x / length, across.y / length);
        const sideways = Math.min(1, length * 2.5);
        torn.tornAmount.value = TORN_STRETCH * falling ** 1.3 * sideways;
        torn.tornDark.value = 0.85 * falling;
        torn.tornStream.value = falling * sideways * (1 - gone);
        torn.tornGone.value = gone;
        torn.tornTime.value = time;
        const room = atRest ? 1 : TORN_ROOM;
        if (room !== torn.tornRoom.value) {
            mesh.scale.multiplyScalar(room / torn.tornRoom.value);
            torn.tornRoom.value = room;
        }
    }

    /**
     * Takes the picture: draws the model's layer of `scene` into the texture. Call after `aim`.
     * In a headset session it is taken a moment later, between this frame and the next.
     */
    refresh(gl, scene) {
        if (Impostor.frozen && this.ready) return;
        if (!gl.xr.isPresenting) {
            this.#draw(gl, scene);
            return;
        }
        if (this.pending) return;
        const pending = setTimeout(() => {
            if (this.pending !== pending) return;
            this.pending = null;
            this.#draw(gl, scene);
        }, 0);
        this.pending = pending;
    }

    #draw(gl, scene) {
        const size = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.radToDeg(2 * this.halfAngle) * PIXELS_PER_DEGREE), MIN_SIZE, MAX_SIZE);
        const target = this.#targetOfSize(gl, size);

        // Drawn with this impostor's own camera, and without disturbing what the renderer was
        // set up to draw next, or its count of what the last frame drew.
        const presenting = gl.xr.isPresenting;
        const xrEnabled = gl.xr.enabled;
        const previousTarget = gl.getRenderTarget();
        const previousAlpha = gl.getClearAlpha();
        const { calls, triangles, points, lines } = gl.info.render;
        gl.getClearColor(scratchColor);
        gl.xr.enabled = false;
        gl.setRenderTarget(target);
        gl.setClearColor(0x000000, 0);
        gl.clear();
        gl.render(scene, this.camera);
        // Between a headset's frames its buffer must be left alone, even to bind it: three.js
        // sets it up again at the start of the next frame.
        if (!presenting) gl.setRenderTarget(previousTarget);
        gl.setClearColor(scratchColor, previousAlpha);
        gl.xr.enabled = xrEnabled;
        Object.assign(gl.info.render, { calls, triangles, points, lines });

        this.mesh.visible = true;
        this.seen = false;
    }

    /** Whether a picture has been taken yet. */
    get ready() {
        return this.mesh.visible;
    }

    /** Frees the texture (the next refresh makes a new one). */
    release() {
        this.pending = null;
        this.target?.dispose();
        this.target = null;
        this.material.map = null;
        this.mesh.visible = false;
    }

    dispose() {
        this.release();
        this.material.dispose();
    }

    #targetOfSize(gl, size) {
        // Sizes within a quarter of each other share a texture: the model's angular size creeps
        // as the ship moves, and reallocating for every pixel of it would stutter.
        if (this.target && Math.abs(this.target.width - size) <= this.target.width * 0.25) return this.target;
        this.target?.dispose();
        // Colours brighter than 1 (an accretion disc, a star) must survive for the bloom and
        // tone mapping that follow, where the GPU can render to such a texture.
        const floatTargets = gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float');
        this.target = new THREE.WebGLRenderTarget(size, size, {
            type: floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType,
            samples: size <= MULTISAMPLED_UP_TO ? 4 : 0,
            generateMipmaps: false,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });
        this.material.map = this.target.texture;
        this.material.needsUpdate = true;
        return this.target;
    }
}

const scratchSphere = new THREE.Sphere();
const scratchInverse = new THREE.Matrix4();

/**
 * A sphere round everything under `root`, in `root`'s own frame (before its position and
 * scale): the centre of the meshes' bounding boxes, out to the farthest mesh's bounding sphere.
 */
export function localBoundingSphere(root, out = new THREE.Sphere()) {
    root.updateWorldMatrix(true, true);
    scratchInverse.copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    const spheres = [];
    root.traverse((node) => {
        if (!node.isMesh) return;
        if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
        const sphere = node.geometry.boundingSphere.clone().applyMatrix4(node.matrixWorld).applyMatrix4(scratchInverse);
        spheres.push(sphere);
        box.union(sphere.getBoundingBox(new THREE.Box3()));
    });
    box.getCenter(out.center);
    out.radius = 0;
    for (const sphere of spheres) out.radius = Math.max(out.radius, sphere.center.distanceTo(out.center) + sphere.radius);
    return out;
}

/** `sphere` (in `object`'s frame) in world space. Assumes `object` is scaled evenly. */
export function sphereToWorld(sphere, object, out = scratchSphere) {
    out.center.copy(sphere.center).applyMatrix4(object.matrixWorld);
    out.radius = sphere.radius * object.matrixWorld.getMaxScaleOnAxis();
    return out;
}
