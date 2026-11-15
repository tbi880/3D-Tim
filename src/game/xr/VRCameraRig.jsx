import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { XROrigin } from '@react-three/xr';
import * as THREE from 'three';
import { GAME_EVENTS } from '../core/EventBus.js';
import { translate } from '../i18n/index.js';
import { viewPose } from '../scene/viewPose.js';
import { PHASE } from '../state/GameSession.js';
import { useGameStore } from '../state/gameStore.js';
import { createCanvasPanel } from './canvasPanel.js';
import VRHud, { vrComms } from './VRHud.jsx';
import { VRMenu } from './VRMenu.js';
import { XRGamepadInput } from './XRGamepadInput.js';
import { getXRStore, useVRActive, vr } from './vrState.js';

/** Runs before the simulation (-2), so this frame's stick positions are used this frame. */
const INPUT_PRIORITY = -3;
/** Frames after the session starts before the seat is centred on the head (tracking settles). */
const AUTO_RECENTER_FRAMES = 20;
const MENU_TEXTURE = [1024, 768];
const MENU_METERS = [1.48, 1.11];
const MENU_POSITION = [0, 0.02, -1.5];
const MENU_REDRAW_INTERVAL = 0.2;

/** The rig's origin group (read by PlayerCamera to work out the eye's world pose). */
export const vrRig = { origin: null };

const scratchEuler = new THREE.Euler();
const scratchForward = new THREE.Vector3();

/**
 * Re-centres the seat: turns and shifts the headset's tracking origin so the head, where it
 * is now, sits at the pilot's eye looking straight ahead. Works the same seated or standing.
 */
function recenter(origin, xrCamera) {
    scratchEuler.setFromQuaternion(xrCamera.quaternion, 'YXZ');
    origin.rotation.set(0, -scratchEuler.y, 0);
    origin.position.copy(xrCamera.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -scratchEuler.y).negate();
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
    const xrCamera = useThree((state) => state.gl.xr.getCamera());
    const recenterIn = useRef(AUTO_RECENTER_FRAMES);
    const menuTimer = useRef(0);

    const menu = useMemo(() => new VRMenu(game), [game]);
    const menuPanel = useMemo(() => createCanvasPanel({ width: MENU_TEXTURE[0], height: MENU_TEXTURE[1], meters: MENU_METERS, renderOrder: 1003 }), []);
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
            onFlightAction: (action) => {
                switch (action) {
                    case 'recenter': recenterIn.current = 1; break;
                    case 'pause': session.togglePause(); break;
                    case 'toggleView': vr.view = vr.view === 'chase' ? 'cockpit' : 'chase'; break;
                    case 'skip':
                        // First press shows the whole line, the second moves on (as tapping the flat panel does).
                        if (vrComms.typing) vrComms.revealed = true;
                        else session.handleAction('skip');
                        break;
                    case 'gazeTarget':
                        if (session.phase === PHASE.PLAYING && session.world.player?.alive && !session.world.controlsLocked) {
                            scratchForward.set(0, 0, -1).applyQuaternion(viewPose.quaternion);
                            session.world.targetNearestToCrosshair(scratchForward);
                        }
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

    // Leaving the headset's view (system menu, headset taken off) pauses the fight; leaving VR
    // drops every held control so the ship does not keep turning on the flat page.
    useEffect(() => getXRStore().subscribe((state, previous) => {
        if (state.visibilityState !== previous.visibilityState && state.visibilityState && state.visibilityState !== 'visible') game.session.pause();
        if (state.session !== previous.session) {
            recenterIn.current = AUTO_RECENTER_FRAMES;
            gamepads.release();
            if (!state.session) game.input.setXRControls(null);
        }
    }), [game, gamepads]);

    // A rumble when the ship is hit or rams something.
    useEffect(() => {
        const { events } = game.session.world;
        const offs = [
            events.on(GAME_EVENTS.HIT, ({ target, amount, shield }) => {
                if (vr.active && target?.isPlayer && amount > 0) gamepads.pulse((shield ? 0.25 : 0.5) + amount / 200, shield ? 40 : 80);
            }),
            events.on(GAME_EVENTS.PLAYER_COLLISION, () => { if (vr.active) gamepads.pulse(1, 160); }),
        ];
        return () => offs.forEach((off) => off());
    }, [game, gamepads]);

    // The headset's own "re-centre" (holding the Meta button) resets the tracking space.
    const referenceSpace = active ? getXRStore().getState().originReferenceSpace : null;
    useEffect(() => {
        if (!referenceSpace?.addEventListener) return undefined;
        const onReset = () => { recenterIn.current = 1; };
        referenceSpace.addEventListener('reset', onReset);
        return () => referenceSpace.removeEventListener('reset', onReset);
    }, [referenceSpace]);

    useFrame(({ gl }, delta) => {
        if (!vr.active) return;
        gamepads.update(gl.xr.getSession(), delta);
        const origin = originRef.current;
        if (origin && recenterIn.current > 0) {
            recenterIn.current -= 1;
            if (recenterIn.current === 0) recenter(origin, xrCamera);
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
