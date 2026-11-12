import { useEffect, useMemo } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { clone as cloneWithSkeletons } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bucketURL } from '../../../Settings';

/**
 * Shows a GLB from the site's asset bucket, optionally playing one of its animations.
 *
 * Unlike the site's AnyModel this leaves the model's materials untouched. AnyModel marks
 * every material as transparent so scenes can fade models in and out; in a busy 3D battle
 * that makes overlapping parts sort by distance instead of by depth, which shows up as
 * flicker and as hulls drawing through each other.
 *
 * Each instance is a clone, so the same file can appear many times (a squadron of drones)
 * while sharing geometry and materials.
 *
 * `brightness` scales the model's own colours (1 = as authored). Models that were made for
 * a small, dim corner of the site can look washed out when they fill half the sky here.
 * A dimmed instance gets its own copies of the materials, so other instances are unaffected.
 *
 * `materials` (see shipMaterials.js) replaces the file's materials with the game's shared
 * ones; it is what turns a generated ship's placeholder "hull" and "glow" into the real thing.
 */
export default function GltfModel({ url, animation = null, animationSpeed = 1, brightness = 1, materials = null, ...groupProps }) {
    const gltf = useGLTF(bucketURL + url, true, true);
    const object = useMemo(() => {
        const clone = cloneWithSkeletons(gltf.scene);
        if (materials) {
            clone.traverse((node) => {
                if (node.isMesh) node.material = materials.resolve(node.material);
            });
        }
        if (brightness !== 1) dimMaterials(clone, brightness);
        return clone;
    }, [gltf.scene, brightness, materials]);
    const root = useMemo(() => ({ current: object }), [object]);
    const { actions } = useAnimations(gltf.animations, root);

    useEffect(() => {
        const action = animation ? actions[animation] : null;
        if (!action) return undefined;
        action.setEffectiveTimeScale(animationSpeed).play();
        return () => action.stop();
    }, [actions, animation, animationSpeed]);

    return <primitive object={object} {...groupProps} />;
}

function dimMaterials(root, brightness) {
    const dimmed = new Map();
    root.traverse((node) => {
        if (!node.material) return;
        if (!dimmed.has(node.material)) {
            const copy = node.material.clone();
            copy.color?.multiplyScalar(brightness);
            copy.emissive?.multiplyScalar(brightness);
            dimmed.set(node.material, copy);
        }
        node.material = dimmed.get(node.material);
    });
}

/** Starts downloading a model so it is ready (and cached) before it is first shown. */
export function useModelPreload(url) {
    useGLTF(bucketURL + url, true, true);
}
