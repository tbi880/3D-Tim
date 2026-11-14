import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { GAME_EVENTS } from '../core/EventBus.js';
import { WarpArrivalEffects } from './effects/WarpArrivalEffects.js';

/**
 * Ships dropping out of warp: inbound wake, landing beacon, flare, collapsing warp bubble,
 * shock wave and a flash of light on nearby hulls (effects/WarpArrivalEffects.js).
 * The basic warp flash and spark burst still come from ExplosionsLayer.
 */
export default function WarpArrivalsLayer({ session }) {
    const effects = useMemo(() => new WarpArrivalEffects(), []);

    useEffect(() => {
        const { events } = session.world;
        const unsubscribe = [
            events.on(GAME_EVENTS.WARP_IN_STARTED, ({ ship }) => effects.start(ship)),
            events.on(GAME_EVENTS.SECTOR_CHANGED, () => effects.dropDeparted()),
        ];
        return () => {
            unsubscribe.forEach((off) => off());
            effects.clear();
        };
    }, [session, effects]);

    useEffect(() => () => effects.dispose(), [effects]);

    useFrame(({ camera }) => {
        effects.update(session.effectsDelta, camera, session.world.player);
    });

    return <primitive object={effects.group} />;
}
