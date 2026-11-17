import {
    TUTORIAL_ACTION, TUTORIAL_LAST_STEP, TUTORIAL_PLATFORM, TUTORIAL_STEPS, TUTORIAL_TIMING, tutorialStepApplies, tutorialStepsFor,
} from '../config/tutorial.js';
import { getLockCandidates } from '../core/systems/targeting.js';
import { isTouchDevice } from '../input/device.js';

/** What a step is doing: waiting for its moment, on screen with the game stopped, or just done. */
export const TUTORIAL_STATE = Object.freeze({ WAITING: 'waiting', ASK: 'ask', DONE: 'done' });
const { WAITING, ASK, DONE } = TUTORIAL_STATE;

/** A run that never showed anything (tutorial off, or every step already seen). */
const NOTHING_TO_SHOW = Object.freeze({ finished: true });

/**
 * The held controls behind `signal` in config/tutorial.js: `(controls, start, world) => boolean`,
 * true while the control is in use. `start` is what the controls were when the step appeared.
 */
const TUTORIAL_SIGNALS = Object.freeze({
    // W, the VR stick, or a finger slid up or down on a touch screen (a throttle set somewhere new).
    throttle: (controls, start) => controls.throttle > 0.3
        || (controls.throttleTarget != null && (start.throttleTarget == null || Math.abs(controls.throttleTarget - start.throttleTarget) > 0.08)),
    roll: (controls) => Math.abs(controls.roll) > 0.3,
    boost: (controls) => Boolean(controls.boost),
    firePrimary: (controls) => Boolean(controls.firePrimary),
    fireSecondary: (controls) => Boolean(controls.fireSecondary),
});

/**
 * The first-flight tutorial (steps in config/tutorial.js, asked for by the story's `tutorial`
 * beats). While a step is on screen the session does not advance the world or the story: the
 * picture stands still until the pilot does what the card asks, on the controls they really
 * have. Then the game goes on with that very input.
 *
 * Whether it shows at all is the `tutorial` setting: on until the last step is done or the
 * pilot skips it, and it can be switched back on in the settings. Steps done once are not
 * shown again in the same visit (a pilot shot down in the prologue is not walked through
 * steering a second time).
 *
 * No React and no DOM here: what is on screen goes out through `session.ui` as
 * `tutorial: { id, kind, state, index, total, platform, needsTarget, ability }` (drawn by
 * ui/TutorialOverlay.jsx on the page and xr/VRHud.jsx in a headset).
 */
export class Tutorial {
    /** @param {import('./GameSession.js').GameSession} session */
    constructor(session) {
        this.session = session;
        /** True while a VR session runs (see setVR): the cards then name the VR controllers. */
        this.vr = false;
        /** Steps completed in this visit. */
        this.seen = new Set();
        /** The steps the story asked for and has not been through yet: { queue, finished }. */
        this.run = null;
        /** The step on its way: { id, def, state, elapsed, armed, travel, last, start, actions }. */
        this.step = null;
    }

    get enabled() {
        return Boolean(this.session.settings.tutorial) && !this.session.match;
    }

    get platform() {
        if (this.vr) return TUTORIAL_PLATFORM.VR;
        return isTouchDevice() ? TUTORIAL_PLATFORM.TOUCH : TUTORIAL_PLATFORM.DESKTOP;
    }

    /** The ship being flown: a step about its ability is only for a ship that has one. */
    get ship() {
        return this.session.world?.player ?? null;
    }

    /** A VR session started or ended: the card on screen, if any, changes hands with the controls. */
    setVR(active) {
        if (this.vr === active) return;
        this.vr = active;
        if (!this.step) return;
        // A step about a control the new hands do not have is dropped.
        if (tutorialStepApplies(this.step.id, this.platform, this.ship)) this.publish();
        else this.advance();
    }

    /** True while a card has the game stopped. */
    get frozen() {
        return this.step?.state === ASK;
    }

    /**
     * Starts the given steps, one after another. The story waits on the returned object's
     * `finished`, which is true at once when there is nothing to show.
     * @param {string[]} stepIds
     * @returns {{ finished: boolean }}
     */
    begin(stepIds) {
        if (!this.enabled) return NOTHING_TO_SHOW;
        const { platform } = this;
        const queue = stepIds.filter((stepId) => tutorialStepApplies(stepId, platform, this.ship) && !this.seen.has(stepId));
        if (queue.length === 0) return NOTHING_TO_SHOW;
        // Only the main story asks, one beat at a time; an unfinished run is simply replaced.
        if (this.run) this.run.finished = true;
        this.run = { queue, finished: false };
        this.advance();
        return this.run;
    }

    /** Drops whatever is on screen (a new game, a reload, the tutorial switched off). */
    cancel() {
        if (this.run) this.run.finished = true;
        this.run = null;
        this.step = null;
        this.publish();
    }

    /** The pilot does not want the tutorial: it is switched off, which also ends this run. */
    skip() {
        this.session.updateSettings({ tutorial: false });
        this.session.showToast('tutorial.skippedToast');
    }

    /** The setting changed (GameSession.updateSettings). */
    settingChanged(enabled) {
        if (enabled) this.seen.clear();
        else this.cancel();
    }

    /** Moves on to the run's next step, or ends the run. */
    advance() {
        const run = this.run;
        const stepId = run?.queue.shift();
        if (!stepId) {
            if (run) run.finished = true;
            this.run = null;
            this.step = null;
            this.publish();
            return;
        }
        const def = TUTORIAL_STEPS[stepId];
        if (def.needsComms && !this.session.comms.current) {
            this.seen.add(stepId);
            this.advance();
            return;
        }
        this.step = { id: stepId, def, state: def.waitForHostile ? WAITING : ASK, elapsed: 0, armed: false, travel: 0, last: null, start: null, actions: new Set() };
        this.publish();
    }

    /**
     * Once a frame while the story is being played, before the world moves.
     * @param {number} dt seconds since the last frame
     * @param {object} controls the held controls (input/InputController.js getControls)
     * @returns {boolean} true when the game must stand still this frame
     */
    update(dt, controls) {
        const step = this.step;
        if (!step) return false;
        if (!this.enabled) {
            this.cancel();
            return false;
        }
        step.elapsed += dt;
        switch (step.state) {
            case WAITING:
                // Enemies still dropping out of warp cannot be locked: the card waits for one that can.
                if (getLockCandidates(this.session.world).length > 0) {
                    step.state = ASK;
                    step.elapsed = 0;
                    this.publish();
                } else if (step.elapsed > TUTORIAL_TIMING.readySeconds) {
                    this.advance();
                }
                break;
            case ASK:
                if (step.def.kind === 'action' && this.performed(step, controls)) this.complete();
                break;
            case DONE:
                if (step.elapsed >= (step.def.practice ?? TUTORIAL_TIMING.doneSeconds)) this.advance();
                break;
            default: break;
        }
        return this.frozen;
    }

    /** Whether the pilot has now done what an action step asks. */
    performed(step, controls) {
        const { def } = step;
        const { world } = this.session;
        if (!step.start) step.start = { throttleTarget: controls.throttleTarget ?? null };
        let done = false;
        if (def.done?.some((action) => step.actions.has(action))) done = true;
        if (def.motion) {
            // The mouse is a stick that is already somewhere: what counts is moving it.
            if (step.last) step.travel += Math.abs(controls.yaw - step.last.yaw) + Math.abs(controls.pitch - step.last.pitch);
            step.last = { yaw: controls.yaw, pitch: controls.pitch };
            if (step.travel >= def.motion) done = true;
        }
        if (def.signal) {
            const active = TUTORIAL_SIGNALS[def.signal](controls, step.start, world);
            if (!active) step.armed = true;
            else if (step.armed && (!def.needsTarget || Boolean(world.player?.target?.alive))) done = true;
        }
        return done && step.elapsed >= TUTORIAL_TIMING.minShowSeconds;
    }

    complete() {
        const step = this.step;
        if (!step) return;
        this.seen.add(step.id);
        this.session.playCue('tutorialStep');
        if (step.id === TUTORIAL_LAST_STEP) {
            // That was everything: the tutorial switches itself off (which ends the run).
            this.session.updateSettings({ tutorial: false });
            return;
        }
        step.state = DONE;
        step.elapsed = 0;
        this.publish();
    }

    /**
     * A one-shot action arrived while the story is being played (GameSession.handleAction).
     * @returns {boolean} true when the action must go no further
     */
    intercept(action) {
        if (action === TUTORIAL_ACTION.SKIP) {
            if (this.step) this.skip();
            return true;
        }
        const step = this.step;
        if (action === TUTORIAL_ACTION.NEXT) {
            if (step?.state === ASK && step.def.kind === 'info') this.next();
            return true;
        }
        if (step?.state !== ASK) return false;
        if (step.def.kind === 'info') {
            // Enter, tapping the comms line or B (skip) also mean "next"; in a headset so does A.
            if (action === 'skip' || (this.vr && action === 'cycleTarget')) this.next();
            return true;
        }
        step.actions.add(action);
        // With the game stopped, only what the card asks for (or allows) reaches the ship.
        return !(step.def.done?.includes(action) || step.def.allow?.includes(action));
    }

    /** An action that does not come through `intercept` (the view switch) was performed. */
    noteAction(action) {
        if (this.step?.state === ASK) this.step.actions.add(action);
    }

    /** "Next" on an info card. */
    next() {
        const step = this.step;
        if (step?.state !== ASK || step.def.kind !== 'info' || step.elapsed < TUTORIAL_TIMING.minShowSeconds) return;
        this.complete();
    }

    /** Tells the UI what to show. */
    publish() {
        const step = this.step;
        if (!step || step.state === WAITING) {
            this.session.ui.set({ tutorial: null });
            return;
        }
        const { platform } = this;
        const steps = tutorialStepsFor(platform, this.ship);
        this.session.ui.set({
            tutorial: {
                id: step.id,
                kind: step.def.kind,
                state: step.state,
                index: steps.indexOf(step.id) + 1,
                total: steps.length,
                platform,
                needsTarget: Boolean(step.def.needsTarget),
                /** The ability the card is about (its id), for the step that teaches it. */
                ability: step.def.needsAbility ? this.ship?.ability?.def.id ?? null : null,
            },
        });
    }
}
