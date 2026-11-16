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

export class Impostor {
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
        /** The sheet. Add it to the scene; give it the model's parent so both share a frame. */
        this.mesh = new THREE.Mesh(sheetGeometry, this.material);
        this.mesh.visible = false;
        /** Set whenever the sheet was drawn: lets the owner skip refreshes while it is out of view. */
        this.seen = false;
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
        mesh.scale.setScalar(2 * distance * Math.tan(halfAngle));
        this.halfAngle = halfAngle;
    }

    /** Takes the picture: draws the model's layer of `scene` into the texture. Call after `aim`. */
    refresh(gl, scene) {
        const size = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.radToDeg(2 * this.halfAngle) * PIXELS_PER_DEGREE), MIN_SIZE, MAX_SIZE);
        const target = this.#targetOfSize(gl, size);

        // Drawn with this impostor's own camera even inside a headset session, and without
        // disturbing what the renderer was set up to draw next.
        const xrEnabled = gl.xr.enabled;
        const previousTarget = gl.getRenderTarget();
        const previousAlpha = gl.getClearAlpha();
        gl.getClearColor(scratchColor);
        gl.xr.enabled = false;
        gl.setRenderTarget(target);
        gl.setClearColor(0x000000, 0);
        gl.clear();
        gl.render(scene, this.camera);
        gl.setRenderTarget(previousTarget);
        gl.setClearColor(scratchColor, previousAlpha);
        gl.xr.enabled = xrEnabled;

        this.mesh.visible = true;
        this.seen = false;
    }

    /** Whether a picture has been taken yet. */
    get ready() {
        return this.mesh.visible;
    }

    /** Frees the texture (the next refresh makes a new one). */
    release() {
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
