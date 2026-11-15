import { BeatRunner } from './BeatRunner.js';

/**
 * Drives the campaign: one main sequence of beats plus any number of named background
 * sequences (enemy reinforcements, timers...) that run alongside it.
 *
 * The director talks to the outside world only through `stage` (dialogue, HUD, music,
 * saving), so the same script runs in the real game and in the headless simulation.
 */
export class StoryDirector {
    /**
     * @param {object} params
     * @param {import('../core/World.js').World} params.world
     * @param {object} params.stage presentation callbacks (see state/GameSession.js)
     * @param {object[]} params.beats the campaign script
     */
    constructor({ world, stage, beats }) {
        this.world = world;
        this.stage = stage;
        this.beats = beats;
        this.main = new BeatRunner(beats);
        this.backgrounds = new Map();
        /** Story variables. Plain JSON only: they are written into checkpoints. */
        this.vars = {};
        /** Presentation state that must survive a checkpoint reload (plain JSON). */
        this.scene = { chapterId: null, objectiveKey: null, escortTag: null, bossTag: null, musicId: null };
        /** Live (non-serialisable) getters behind the objective counter and progress bar. */
        this.objectiveParams = null;
        this.progress = null;
        /**
         * True from loading a checkpoint until the next checkpoint is reached: lets the beats
         * right after a checkpoint tell a replay (after a loss) from the first time through.
         */
        this.resumed = false;
        this.context = { world, stage, director: this, vars: this.vars };
    }

    get finished() {
        return this.main.finished;
    }

    /** Starts the campaign from its first beat. */
    startFromBeginning() {
        this.resetRuntime();
        this.resumed = false;
        this.main = new BeatRunner(this.beats);
    }

    /**
     * Resumes right after the given checkpoint beat.
     * @returns {boolean} false if the checkpoint id is not in the script (stale save)
     */
    startFromCheckpoint(checkpointId, savedVars, savedScene) {
        const index = this.beats.findIndex((beat) => beat.type === 'checkpoint' && beat.id === checkpointId);
        if (index === -1) return false;
        this.resetRuntime();
        Object.assign(this.vars, savedVars);
        Object.assign(this.scene, savedScene);
        this.main = new BeatRunner(this.beats, index + 1);
        this.resumed = true;
        return true;
    }

    resetRuntime() {
        this.backgrounds.clear();
        for (const key of Object.keys(this.vars)) delete this.vars[key];
        Object.assign(this.scene, { chapterId: null, objectiveKey: null, escortTag: null, bossTag: null, musicId: null });
        this.objectiveParams = null;
        this.progress = null;
    }

    startBackground(id, beats) {
        this.backgrounds.set(id, new BeatRunner(beats));
    }

    stopBackground(id) {
        this.backgrounds.delete(id);
    }

    update(dt) {
        this.main.update(this.context, dt);
        for (const [id, runner] of this.backgrounds) {
            if (runner.update(this.context, dt)) this.backgrounds.delete(id);
        }
    }

    /**
     * What the script wants on the HUD right now: the ship being protected, the boss, the
     * progress bar and the objective (ships, `{ labelKey, value }`, `{ key, params }`; null
     * for anything not shown).
     */
    missionHud() {
        const { world, scene, progress, context } = this;
        return {
            escort: scene.escortTag ? world.findByTag(scene.escortTag) : null,
            boss: scene.bossTag ? world.findByTag(scene.bossTag) : null,
            progress: progress ? { labelKey: progress.labelKey, value: progress.getValue(context) } : null,
            objective: scene.objectiveKey ? { key: scene.objectiveKey, params: this.objectiveParams?.(context) ?? null } : null,
        };
    }

    /** Ids of every checkpoint in script order (used to label saves and by tests). */
    listCheckpoints() {
        return this.beats.filter((beat) => beat.type === 'checkpoint').map((beat) => beat.id);
    }
}
