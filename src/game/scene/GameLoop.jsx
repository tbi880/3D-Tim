import { useFrame } from '@react-three/fiber';
import { PHASE } from '../state/GameSession.js';

/** Runs before every other frame callback (priority -2) so views always draw fresh state. */
const SIMULATION_PRIORITY = -2;

/** Advances the simulation once per rendered frame and keeps continuous audio in sync. */
export default function GameLoop({ game }) {
    useFrame((state, delta) => {
        const { session, input, sound } = game;
        session.update(delta, input.getControls());
        sound.update(session.world, session.phase === PHASE.PLAYING);
    }, SIMULATION_PRIORITY);
    return null;
}
