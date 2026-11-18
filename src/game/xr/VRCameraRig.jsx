import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { XROrigin } from '@react-three/xr';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { translate } from '../i18n/index.js';
import { TUTORIAL_ACTION } from '../config/tutorial.js';
import { PHASE } from '../state/GameSession.js';
import { MATCH_ACTION } from '../modes/battleRoyale/BattleRoyalePresenter.js';
import { useGameStore } from '../state/gameStore.js';
import { createCanvasPanel } from './canvasPanel.js';
import VRHud, { vrComms } from './VRHud.jsx';
import { VRMenu } from './VRMenu.js';
import { XRGamepadInput } from './XRGamepadInput.js';
import { guardXRFrames } from './frameGuard.js';
import { vrBenchmark } from './vrBenchmark.js';
import { vrPerformance } from './vrPerformance.js';
import { getXRStore, useVRActive, vr } from './vrState.js';

/** Runs before the simulation (-2), so this frame's stick positions are used this frame. */
const INPUT_PRIORITY = -3;
/**
 * Re-centres after the session starts: the full one early, then (position only, so the view
 * never swings round) once more when a real headset's tracking has surely settled, in case
 * the first poses were stale and left the pilot's head above or beside the seat.
 */
const AUTO_RECENTER = [{ frame: 20, turn: true }, { frame: 90, turn: false }];
const MENU_TEXTURE = [1024, 768];
const MENU_METERS = [1.48, 1.11];
const MENU_POSITION = [0, 0.02, -1.5];
const MENU_REDRAW_INTERVAL = 0.2;
/**
 * The headset's depth range. three takes it from the camera it renders with, which in VR is
 * its own XR camera (near 0.1 m, far 2 km by default), not the game camera - so without this
 * everything beyond 2 km is clipped. Same far as the game camera; a closer near so the cabin
 * never gets cut when the pilot leans in.
 */
const XR_NEAR = 0.02;
const XR_FAR = 3_000_000;

/** The rig's origin group (read by PlayerCamera to work out the eye's world pose). */
export const vrRig = { origin: null };

const scratchEuler = new THREE.Euler();

/**
 * Re-centres the seat: turns and shifts the headset's tracking origin so the head, where it
 * is now, sits at the pilot's eye looking straight ahead. Works the same seated or standing.
 */
function recenter(origin, xrCamera, turn = true) {
    if (turn) {
        scratchEuler.setFromQuaternion(xrCamera.quaternion, 'YXZ');
        origin.rotation.set(0, -scratchEuler.y, 0);
    }
    origin.position.copy(xrCamera.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, origin.rotation.y).negate();
    origin.updateMatrix();
}

/**
 * Everything VR that hangs off the pilot's seat (a child of PlayerCamera's camera): the
 * headset's tracking origin, the controller input, the HUD and the menus.
 */
export default function VRCameraRig({ game }) {
    const active = useVRActive();
    const originRef = useRef(null);
    const seatRef = useRef(null);
    const gl = useThree((state) => state.gl);
    const setThree = useThree((state) => state.set);
    const xrCamera = gl.xr.getCamera();
    // autoClear as it was before VR (see the session subscription below).
    const flatAutoClear = useRef(null);
    // Frame numbers (counted from the session start) at which to re-centre.
    const recenterAt = useRef([...AUTO_RECENTER]);
    const frameCount = useRef(0);
    const recenterSoon = () => { recenterAt.current.push({ frame: frameCount.current + 1, turn: true }); };
    const menuTimer = useRef(0);

    const menu = useMemo(() => new VRMenu(game), [game]);
    const menuPanel = useMemo(() => createCanvasPanel({ gl, width: MENU_TEXTURE[0], height: MENU_TEXTURE[1], meters: MENU_METERS, renderOrder: 1003 }), [gl]);
    useEffect(() => () => menuPanel.dispose(), [menuPanel]);

    const gamepads = useMemo(() => {
        const { session, input } = game;
        const store = () => useGameStore.getState();
        const t = (key, params) => translate(store().settings.locale, key, params);
        return new XRGamepadInput({
            input,
            getInvertY: () => session.settings.invertY,
            isMenuOpen: () => menu.isOpen(store()),
            onMenuAction: (action) => menu.handle(action, store(), t),
            // What each button does is in XRGamepadInput.js; here is what it means in the campaign and in a match.
            onFlightAction: (action) => {
                const inMatch = Boolean(session.match);
                switch (action) {
                    case 'recenter': recenterSoon(); break;
                    case 'pause': session.togglePause(); break;
                    case 'view':
                        // B: cockpit or chase (the headset keeps a view of its own, apart from the flat page's).
                        vr.view = vr.view === 'chase' ? 'cockpit' : 'chase';
                        if (session.phase === PHASE.PLAYING) session.tutorial.noteAction('toggleView');
                        break;
                    case 'confirm':
                        // A in the campaign: "next" on a tutorial card; on the comms line the first
                        // press shows the whole line, the second moves on (as tapping the flat panel does).
                        if (inMatch) break;
                        if (session.tutorial.awaitsNext) session.handleAction(TUTORIAL_ACTION.NEXT);
                        else if (vrComms.typing) vrComms.revealed = true;
                        else session.handleAction('skip');
                        break;
                    case 'confirmTap':
                        // A match has no comms lines: there a press of A opens the star map (or, for a
                        // pilot who is down and watching with the menu put away, brings the menu back)...
                        if (inMatch) session.handleAction(MATCH_ACTION.MAP);
                        break;
                    case 'confirmHeld':
                        // ...and kept down, clamps on to the station whose dock the ship is in or lets go
                        // of it (shot down: comes back at the first station offered, once the wait is over).
                        if (inMatch) session.handleAction(MATCH_ACTION.DOCK);
                        break;
                    case 'targetCrosshair':
                        // Shot down in a match, the lock button steps through the pilots to watch (as T does).
                        if (inMatch && !session.world.player?.alive) session.handleAction('cycleTarget');
                        else session.handleAction(action);
                        break;
                    default: session.handleAction(action);
                }
            },
        });
    }, [game, menu]);

    useEffect(() => {
        vrRig.origin = originRef.current;
        return () => { vrRig.origin = null; };
    }, []);

    // An error in one frame must not stop the headset's frames for good (see frameGuard.js).
    useEffect(() => guardXRFrames(gl, {
        onError: (error) => vrPerformance.failed(error),
        onFrame: (milliseconds) => vrPerformance.frameTook(milliseconds),
    }), [gl]);

    // Leaving the headset's view (system menu, headset taken off) pauses the fight; leaving VR
    // drops every held control so the ship does not keep turning on the flat page.
    useEffect(() => getXRStore().subscribe((state, previous) => {
        if (state.visibilityState !== previous.visibilityState && state.visibilityState && state.visibilityState !== 'visible') game.session.pause();
        if (state.session !== previous.session) {
            // The post-processing composer (unmounted in VR) turns the renderer's autoClear
            // off for good. Without it nothing clears the headset's framebuffer, whose depth
            // then keeps every earlier frame's nearest surface and hides the cockpit on a real
            // headset (an emulator's canvas happens to be cleared by the browser).
            if (state.session) {
                if (flatAutoClear.current === null) flatAutoClear.current = gl.autoClear;
                gl.autoClear = true;
            } else if (flatAutoClear.current !== null) {
                gl.autoClear = flatAutoClear.current;
                flatAutoClear.current = null;
            }
            frameCount.current = 0;
            vrBenchmark.cancel();
            if (state.session) vrPerformance.begin();
            else vrPerformance.end();
            recenterAt.current = [...AUTO_RECENTER];
            gamepads.release();
            if (!state.session) game.input.setXRControls(null);
            // The tutorial names the controls in the pilot's hands: the VR controllers while a session runs.
            game.session.tutorial.setVR(Boolean(state.session));
        }
    }), [game, gamepads, gl]);

    // A rumble when the ship is hit or rams something.
    useEffect(() => {
        const { world } = game.session;
        const { events } = world;
        // Only for the ship flown on this device: in multiplayer other players' ships are hit too.
        const isOwnShip = (ship) => Boolean(ship) && ship === world.player;
        const offs = [
            events.on(GAME_EVENTS.HIT, ({ target, amount, shield }) => {
                if (!vr.active || !isOwnShip(target) || amount <= 0) return;
                gamepads.pulse((shield ? 0.25 : 0.5) + amount / 200, shield ? 40 : 80);
            }),
            events.on(GAME_EVENTS.PLAYER_COLLISION, ({ ship }) => { if (vr.active && isOwnShip(ship)) gamepads.pulse(1, 160); }),
        ];
        return () => offs.forEach((off) => off());
    }, [game, gamepads]);

    // The headset's own "re-centre" (holding the Meta button) resets the tracking space.
    const referenceSpace = active ? getXRStore().getState().originReferenceSpace : null;
    useEffect(() => {
        if (!referenceSpace?.addEventListener) return undefined;
        const onReset = () => recenterSoon();
        referenceSpace.addEventListener('reset', onReset);
        return () => referenceSpace.removeEventListener('reset', onReset);
    }, [referenceSpace]);

    useFrame((state, delta, frame) => {
        if (!vr.active) return;
        // First, while the renderer still holds last frame's counts.
        vrPerformance.update(gl, delta, frame, { flying: game.session.phase === PHASE.PLAYING, adapt: vr.dynamicResolution });
        // A benchmark (started from the pause menu) measures flight only, and pauses again when it has finished.
        if (vrBenchmark.running && game.session.phase === PHASE.PLAYING) vrBenchmark.update(gl, state.scene, delta, () => game.session.pause());
        // In VR the scene must be drawn with the headset's camera (@react-three/xr switches to
        // it when the session starts). PlayerCamera's <PerspectiveCamera makeDefault> takes the
        // default back whenever its effects run again - e.g. when part of the scene suspends
        // while a ship model loads and then shows again. three then draws with the seat camera:
        // the head's pose is applied from the world origin and copied onto the seat, so the
        // cockpit, HUD and menus all ride along with the head. Hand the headset its camera back.
        if (state.camera !== xrCamera) setThree({ camera: xrCamera });
        if (!gl.autoClear) gl.autoClear = true;
        if (xrCamera.near !== XR_NEAR || xrCamera.far !== XR_FAR) {
            xrCamera.near = XR_NEAR;
            xrCamera.far = XR_FAR;
        }
        gamepads.update(gl.xr.getSession(), delta);
        const origin = originRef.current;
        frameCount.current += 1;
        const pending = recenterAt.current;
        const due = pending.filter(({ frame }) => frame <= frameCount.current);
        if (origin && due.length) {
            recenterAt.current = pending.filter(({ frame }) => frame > frameCount.current);
            recenter(origin, xrCamera, due.some(({ turn }) => turn));
        }
    }, INPUT_PRIORITY);

    useFrame((_, delta) => {
        if (!vr.active) return;
        const state = useGameStore.getState();
        const open = menu.isOpen(state);
        menuPanel.mesh.visible = open;
        if (!open) return;
        menu.tick(state);
        menuTimer.current -= delta;
        if (menu.dirty || menuTimer.current <= 0) {
            menuTimer.current = MENU_REDRAW_INTERVAL;
            menu.draw(menuPanel, state, (key, params) => translate(state.settings.locale, key, params));
        }
    });

    return (
        <group ref={seatRef}>
            <XROrigin ref={originRef} />
            {active && (
                <>
                    <VRHud game={game} seatRef={seatRef} />
                    <primitive object={menuPanel.mesh} position={MENU_POSITION} />
                </>
            )}
        </group>
    );
}
