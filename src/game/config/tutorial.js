/**
 * The first-flight tutorial: the steps the prologue walks a new pilot through
 * (`tutorial(...)` beats in story/campaign.js, played by state/Tutorial.js).
 *
 * Each step stops the game with a card on screen and waits for the pilot:
 *  - an `info` step explains part of the HUD and waits for "Next";
 *  - an `action` step names one control and waits until the pilot has really used it, on
 *    whatever they fly with (keyboard and mouse, touch screen, VR controllers). The input
 *    that ends the step is not swallowed: the game resumes with it applied.
 *
 * Fields of a step:
 *   kind       'info' | 'action'
 *   platforms  where the control exists (default: everywhere). A phone has no roll, view or
 *              power controls, so those steps are left out there.
 *   done       one-shot actions (see input/InputController.js) that complete the step
 *   allow      other one-shot actions let through while the step waits (the rest are ignored)
 *   signal     a held control (the tests are TUTORIAL_SIGNALS in state/Tutorial.js): the step
 *              completes when it is pressed after having been up (a fresh press, not a key
 *              already down)
 *   motion     the step completes once the steering stick has moved this far in all
 *   waitForHostile  the step holds off (game running) until there is a ship the pilot can lock
 *   needsTarget     the control only counts with a target locked, and the card says whether one is
 *   needsComms      the step is about the comms line on screen: with none there (the pilot has
 *                   already skipped it, so they know how) it is passed over
 *   practice   seconds of free flight after the step, before the next one stops the game again
 *   target     CSS selector of the HUD element to spotlight on the flat page, by platform
 *   place      where the card sits on the flat page: 'centre' (default) or 'top'
 *
 * Texts are `tutorial.<id>.title`, `.text` and `.keys` in the i18n files, each with optional
 * `.touch` and `.vr` twins.
 */

export const TUTORIAL_PLATFORM = Object.freeze({ DESKTOP: 'desktop', TOUCH: 'touch', VR: 'vr' });
const { DESKTOP, TOUCH, VR } = TUTORIAL_PLATFORM;
const STICKS = [DESKTOP, VR];

/** One-shot actions that are part of the tutorial itself. */
export const TUTORIAL_ACTION = Object.freeze({ NEXT: 'tutorial:next', SKIP: 'tutorial:skip' });

const LOCK_ACTIONS = ['cycleTarget', 'targetCrosshair'];

export const TUTORIAL_STEPS = Object.freeze({
    comms: {
        kind: 'action', done: ['skip'], needsComms: true, place: 'top',
        target: { [DESKTOP]: '.eod-comms', [TOUCH]: '.eod-comms' },
    },
    objective: {
        kind: 'info',
        target: { [DESKTOP]: '.eod-objective', [TOUCH]: '.eod-objective' },
    },
    steer: {
        kind: 'action', motion: 0.6, practice: 3,
        target: { [TOUCH]: '.eod-touch-stick' },
    },
    throttle: {
        kind: 'action', practice: 2.5,
        signal: 'throttle',
        target: { [DESKTOP]: '.eod-speed', [TOUCH]: '.eod-ship-compact' },
    },
    roll: {
        kind: 'action', platforms: STICKS, practice: 2.5,
        signal: 'roll',
    },
    boost: {
        kind: 'action', practice: 3,
        signal: 'boost',
        target: { [DESKTOP]: '.eod-meter--boost', [TOUCH]: '[data-tutorial="boost"]' },
    },
    view: {
        kind: 'action', platforms: STICKS, done: ['toggleView'], practice: 2,
    },
    radar: {
        kind: 'info',
        target: { [DESKTOP]: '.eod-radar', [TOUCH]: '.eod-radar' },
    },
    lock: {
        kind: 'action', done: LOCK_ACTIONS, waitForHostile: true, practice: 1,
        target: { [DESKTOP]: '.eod-target', [TOUCH]: '[data-tutorial="lock"]' },
    },
    beams: {
        kind: 'action', waitForHostile: true,
        signal: 'firePrimary',
        target: { [DESKTOP]: '.eod-meter--energy', [TOUCH]: '[data-tutorial="fire"]' },
    },
    status: {
        kind: 'info',
        target: { [DESKTOP]: '.eod-status', [TOUCH]: '.eod-ship-compact' },
    },
    power: {
        kind: 'action', platforms: STICKS, done: ['power:attack', 'power:defense', 'power:cycle'], practice: 1,
        target: { [DESKTOP]: '.eod-power' },
    },
    torpedo: {
        kind: 'action', allow: LOCK_ACTIONS, waitForHostile: true, needsTarget: true,
        signal: 'fireSecondary',
        target: { [DESKTOP]: '.eod-torpedoes', [TOUCH]: '[data-tutorial="torpedo"]' },
    },
    pause: {
        kind: 'info',
        target: { [TOUCH]: '.eod-touch-pause' },
    },
});

/** Every step in the order the prologue shows them; the card counts "3 / 14" along this list. */
export const TUTORIAL_ORDER = Object.freeze([
    'comms', 'objective', 'steer', 'throttle', 'roll', 'boost', 'view',
    'radar', 'lock', 'beams', 'status', 'power', 'torpedo', 'pause',
]);

/** The step that ends the tutorial: once it is done the tutorial never shows again (until switched back on). */
export const TUTORIAL_LAST_STEP = TUTORIAL_ORDER.at(-1);

export const TUTORIAL_TIMING = Object.freeze({
    /** A card stays up at least this long, so a key already going down cannot dismiss it unread. */
    minShowSeconds: 0.45,
    /** Longest a step waits for its `ready` condition before it is dropped (it will be offered again next time). */
    readySeconds: 12,
    /** How long the "well done" tick stays up after a step with no practice time of its own. */
    doneSeconds: 0.9,
});

export function tutorialStepApplies(stepId, platform) {
    const step = TUTORIAL_STEPS[stepId];
    return Boolean(step) && (!step.platforms || step.platforms.includes(platform));
}

/** The steps a platform is shown, in order. */
export function tutorialStepsFor(platform) {
    return TUTORIAL_ORDER.filter((stepId) => tutorialStepApplies(stepId, platform));
}
