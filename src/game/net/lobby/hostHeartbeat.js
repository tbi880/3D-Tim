import { IDLE_CONTROLS } from '../../core/systems/playerFlight.js';

/** How often the heartbeat checks on the game (milliseconds), and the time each beat stands for. */
const BEAT_MS = 33;

/**
 * Keeps a match going when its host's page is not being drawn.
 *
 * The game advances once per drawn frame, and a browser stops drawing a page that is in a
 * background tab or behind another window. For the host that would freeze the match for
 * everybody. A page's own timers are slowed to a crawl in the background too, but a Web
 * Worker's are not - so a tiny worker ticks thirty times a second, and whenever the host's
 * page has stopped drawing, each tick advances the match instead (the host's own ship
 * flies on with its controls released).
 *
 * It cannot help where the system suspends the whole page (a phone whose browser is put
 * away): there the other players lose the host and are told so.
 *
 * @param {import('../../state/GameSession.js').GameSession} session
 * @returns {() => void} stops the heartbeat
 */
export function startHostHeartbeat(session) {
    if (typeof Worker === 'undefined') return () => {};
    const source = `setInterval(() => postMessage(0), ${BEAT_MS});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let seenUpdates = session.updates;
    let quietBeats = 0;

    worker.onmessage = () => {
        // Frames are being drawn (or nobody depends on this page): nothing to do.
        if (session.updates !== seenUpdates || !session.match?.isHost) {
            seenUpdates = session.updates;
            quietBeats = 0;
            return;
        }
        // A few silent beats in a row mean the page really has stopped drawing, not just dropped a frame.
        quietBeats += 1;
        if (quietBeats < 4) return;
        session.update(BEAT_MS / 1000, IDLE_CONTROLS);
        seenUpdates = session.updates;
    };

    return () => {
        worker.terminate();
        URL.revokeObjectURL(url);
    };
}
