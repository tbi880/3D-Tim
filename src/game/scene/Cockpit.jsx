import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { GAME_EVENTS } from '../core/EventBus.js';
import { isTouchDevice, watchTouchDevice } from '../input/device.js';
import { useGameStore } from '../state/gameStore.js';
import { preloadVRFlightStick } from '../xr/VRFlightStick.jsx';
import { useVRActive, useVRSupported, vr } from '../xr/vrState.js';
import { ambientLight } from './cabinLighting.js';
import CockpitCabin, { CABIN_FILE, CABIN_SCALE, SPARK_EMITTERS, preloadCockpitCabin } from './CockpitCabin.jsx';
import CockpitSparks from './CockpitSparks.jsx';
import { isHullHitOnPlayer } from './effects/playerFeedback.js';
import { useModelPreload } from './models/GltfModel.jsx';
import { ModelErrorBoundary } from './models/ShipModel.jsx';

/**
 * The cockpit round the pilot's eye, attached to the camera: the cabin (CockpitCabin.jsx),
 * its ambient light and the sparks a hull hit throws into it. The same cabin on a screen and
 * in a headset; PlayerCamera shows it in the first-person view only.
 *
 * Phones fly in the chase view only (saveGame.js), so outside VR they never sit in the cabin:
 * there it is neither fetched nor drawn.
 *
 * On a screen the field of view widens on the afterburner and in warp. `baseFov` is the
 * field of view the cabin is drawn for: when the camera's widens, the cabin is scaled
 * sideways and upwards by the same ratio, so it stays put on screen instead of shrinking
 * into view as a floating frame. A headset's field of view never changes.
 */

/** Before the cabin and the VR flight sticks take their colour from the ambient light. */
const LIGHTING_PRIORITY = -1;
/** How badly a hit on the bare hull knocks the cabin's power (cabinLighting.js): a base, and more per point of damage. */
const KNOCK_BASE = 0.55;
const KNOCK_PER_DAMAGE = 1 / 30;

const useTouchDevice = () => useSyncExternalStore(watchTouchDevice, isTouchDevice, () => false);

export default function Cockpit({ baseFov, session }) {
    const groupRef = useRef(null);
    const inVR = useVRActive();
    const touch = useTouchDevice();
    const seated = inVR || !touch;
    // Where VR can be entered, fetch the cabin and the flight sticks ahead of time, so they
    // are there on entering (a phone that can do VR has not fetched the cabin yet).
    const vrSupported = useVRSupported();
    useEffect(() => {
        if (!vrSupported) return;
        preloadCockpitCabin();
        preloadVRFlightStick();
    }, [vrSupported]);
    const baseTangent = Math.tan((baseFov * Math.PI) / 360);

    // With the shield down a hit reaches the ship's power: the cabin lights stutter.
    useEffect(() => {
        if (!seated) return undefined;
        const { world } = session;
        return world.events.on(GAME_EVENTS.HIT, (hit) => {
            if (isHullHitOnPlayer(world, hit)) ambientLight.disturb(KNOCK_BASE + hit.amount * KNOCK_PER_DAMAGE);
        });
    }, [session, seated]);

    useFrame((_, delta) => {
        if (seated) ambientLight.update(useGameStore.getState().hud, delta);
    }, LIGHTING_PRIORITY);

    useFrame(({ camera }) => {
        const group = groupRef.current;
        if (!group) return;
        const ratio = vr.active ? 1 : Math.tan((camera.fov * Math.PI) / 360) / baseTangent;
        group.scale.set(ratio, ratio, 1);
    });

    return (
        <group ref={groupRef}>
            {seated && (
                <>
                    <ModelErrorBoundary url={CABIN_FILE} fallback={null}>
                        <Suspense fallback={null}>
                            <CockpitCabin />
                        </Suspense>
                    </ModelErrorBoundary>
                    <CockpitSparks session={session} emitters={inVR ? SPARK_EMITTERS.headset : SPARK_EMITTERS.screen} scale={CABIN_SCALE} />
                </>
            )}
        </group>
    );
}

function PreloadCabin() {
    useModelPreload(CABIN_FILE);
    return null;
}

/**
 * Holds the loading screen (GameScene's Suspense, as ShipModelPreloader does) until the cabin
 * is in, wherever the pilot can sit in it on the page, so it is there from the first frame
 * instead of popping in after launch. Decided once: a later wait must never bring the
 * loading screen back mid-flight.
 */
export function CockpitPreloader() {
    const [needed] = useState(() => !isTouchDevice());
    if (!needed) return null;
    return (
        <ModelErrorBoundary fallback={null}>
            <PreloadCabin />
        </ModelErrorBoundary>
    );
}
