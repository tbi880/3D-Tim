import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { t } from '../../i18n/index.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { sanitizeBattleRoyaleState } from './battleRoyaleState.js';
import { BR_EVENT, BR_REQUEST } from './battleRoyaleProtocol.js';
import { PLANET_STATUS } from './collapse.js';

/** The mode's own keys and buttons (bound in input/InputController.js, shown by ui/multiplayer). */
export const MATCH_ACTION = Object.freeze({ MAP: 'match:map', REFIT: 'match:refit', SUMMON: 'match:summon' });
export const MATCH_PANEL = Object.freeze({ MAP: 'map' });

/** Sounds of the match's ceremonies (audio/SoundEngine.js playCue). */
export const CUE = Object.freeze({ INTRO: 'matchIntro', VICTORY: 'victory', DEFEAT: 'defeat' });

/** Names as the player reads them (the ids come from the host: an unknown one is shown as it came). */
export const planetName = (planetId) => t(`mp.planet.${String(planetId)}`);
export const factionName = (faction) => t(`mp.faction.${String(faction)}`);

/** Seconds the warp streaks take to fade once the ship has arrived. */
const WARP_EXIT_SECONDS = 1.4;

/**
 * The battle royale on a player's device (the "presenter" half of a game mode, see
 * modes/index.js): turns what the rules announce into what the pilot sees and hears.
 * The map, the scoreboard and the panels read the match state from the game store; this
 * handles the moments - a jump, a planet falling in, a warning.
 */
export class BattleRoyalePresenter {
    constructor() {
        this.client = null;
        this.session = null;
        /** The jump in progress on screen: { phase: 'spool' | 'exit', elapsed, seconds }, or null. */
        this.warp = null;
        /** The mode's window that is open (MATCH_PANEL), or null; and whether the refit window is. */
        this.openPanel = null;
        this.refitOpen = false;
        /** Whether the introduction is on screen (null before the first state has said). */
        this.introShowing = null;
        /** The ending being played: { elapsed, seconds, won, showResults }, or null. */
        this.outro = null;
    }

    sanitizeState(raw) {
        const state = sanitizeBattleRoyaleState(raw);
        if (state) this.followIntro(state);
        return state;
    }

    begin(client, session) {
        this.client = client;
        this.session = session;
        // Until the introduction is over the player is nowhere: the view is the dying sun, from outside.
        session.world.setSector(BATTLE_ROYALE.intro.sectorId);
    }

    // ---- The introduction and the ending -------------------------------------------------------

    /** Music and a cue as the introduction starts, and again as the ships enter the system. */
    followIntro(state) {
        const showing = state.intro !== null && state.phase === MATCH_PHASE.PLAYING;
        if (showing === this.introShowing) return;
        this.introShowing = showing;
        this.session.playMusic(showing ? 'calm' : 'battle');
        if (showing) this.session.playCue(CUE.INTRO);
    }

    /**
     * The match is decided. Plays the ending - the winners go through the stargate, everybody
     * else is left to the black hole - and only then lets the result screen up.
     */
    onMatchOver(state, showResults) {
        if (this.outro) return true;
        const { session } = this;
        const won = Boolean(state.winner) && state.you?.faction === state.winner;
        this.setPanel(null);
        this.refitOpen = false;
        session.ui.set({ refit: null, matchOutro: { winner: state.winner, won } });
        this.outro = { elapsed: 0, seconds: BATTLE_ROYALE.outro.seconds, won, showResults };
        this.warp = null;
        session.playCue(won ? CUE.VICTORY : CUE.DEFEAT);
        if (won) session.playMusic('finale');
        return true;
    }

    updateOutro(dt) {
        const { outro, session } = this;
        outro.elapsed += dt;
        const progress = Math.min(1, outro.elapsed / outro.seconds);
        // Winners: the jump through the gate builds for the whole ending. Losers: the dark closes in.
        if (outro.won) session.world.warpFactor = progress * progress;
        else session.world.screenFade = 0.85 * progress;
        if (progress < 1) return;
        this.outro = null;
        if (outro.won) {
            // Through the gate: the flash of arrival, and the streaks let go behind the result.
            session.onWarp('arrive');
            this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        }
        session.ui.set({ matchOutro: null });
        outro.showResults();
    }

    onEvent(name, data) {
        const { session } = this;
        const here = this.client.state?.you?.planet;
        switch (name) {
            case BR_EVENT.JUMP_SPOOL:
                this.warp = { phase: 'spool', elapsed: 0, seconds: Number.isFinite(data?.seconds) ? Math.max(0.1, data.seconds) : 1 };
                session.onWarp('spool');
                break;
            case BR_EVENT.JUMP_REFUSED:
                session.showToast(`mp.jump.refused.${String(data?.reason)}`);
                break;
            case BR_EVENT.COLLAPSE:
                if (data?.status === PLANET_STATUS.SAFE) break;
                session.showToast(`mp.collapse.${String(data?.status)}`, { planet: planetName(data?.planet) });
                // The alarm is for whoever is on that planet; the rest only read about it.
                if (data?.planet === here) session.playCue('alarm');
                break;
            case BR_EVENT.CAPTURED:
                session.showToast('mp.captured', { planet: planetName(data?.planet), faction: factionName(data?.faction) });
                session.playCue('power');
                break;
            case BR_EVENT.REWARD:
                session.showToast('mp.reward', { points: Number(data?.points) || 0, summons: Number(data?.summons) || 0 });
                break;
            case BR_EVENT.REVIVED:
                session.showToast('mp.revived', { planet: planetName(data?.planet) });
                break;
            case BR_EVENT.WARNING:
                session.showToast('mp.loyalty.warning');
                session.playCue('alarm');
                break;
            case BR_EVENT.BRANDED:
                session.showToast('mp.loyalty.branded');
                session.playCue('alarm');
                break;
            default:
        }
    }

    // ---- The pilot's own keys and windows -----------------------------------------------------

    /** Keys and buttons that belong to this mode (input/InputController.js MATCH_KEYS). */
    handleAction(action) {
        const state = this.client.state;
        // Nothing to open while the story is being told.
        if (this.outro || state?.intro != null) return Object.values(MATCH_ACTION).includes(action);
        switch (action) {
            case MATCH_ACTION.MAP:
                this.setPanel(this.panel === MATCH_PANEL.MAP ? null : MATCH_PANEL.MAP);
                return true;
            case MATCH_ACTION.REFIT:
                if (state?.you?.alive && state.you.points > 0) this.openRefit();
                return true;
            case MATCH_ACTION.SUMMON:
                if (state?.you?.alive && state.you.summons > 0) this.client.request(BR_REQUEST.SUMMON);
                return true;
            default:
                return false;
        }
    }

    get panel() {
        return this.openPanel;
    }

    /** Opens one of the mode's windows (MATCH_PANEL), or closes whichever is open (null). */
    setPanel(panel) {
        this.openPanel = panel;
        this.session.ui.set({ matchPanel: panel });
    }

    /** The refit window of the campaign, here for spending the points a captured planet pays. */
    openRefit() {
        const { you } = this.client.state;
        const ship = this.session.world.player;
        if (!ship) return;
        this.refitOpen = true;
        this.session.ui.set({ refit: { points: you.points, classId: ship.classId, upgrades: you.upgrades, inFlight: true } });
    }

    applyRefit(added) {
        this.refitOpen = false;
        if (added && Object.values(added).some((levels) => levels > 0)) this.client.request(BR_REQUEST.REFIT, { added });
    }

    /** With the map or the refit window open the pilot is not flying: the ship holds its course. */
    holdsAttention() {
        return this.openPanel !== null || this.refitOpen || this.outro !== null;
    }

    jumpTo(planetId) {
        this.client.request(BR_REQUEST.JUMP, { to: planetId });
        this.setPanel(null);
    }

    vote(choice) {
        this.client.request(BR_REQUEST.VOTE, { choice });
    }

    /** The player is somewhere new (a jump, a revival, or the start): the streaks let go. */
    onZoneEntered() {
        if (this.warp?.phase !== 'spool') return;
        this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        this.session.onWarp('arrive');
    }

    update(dt) {
        if (this.outro) {
            this.updateOutro(dt);
            return;
        }
        const { warp } = this;
        const world = this.session?.world;
        if (!warp || !world) return;
        warp.elapsed += dt;
        const progress = Math.min(1, warp.elapsed / warp.seconds);
        world.warpFactor = warp.phase === 'spool' ? progress : 1 - progress;
        // A spool whose jump never came (the ship was shot down first) fades by itself.
        if (warp.phase === 'spool' && warp.elapsed > warp.seconds + 1) this.warp = { phase: 'exit', elapsed: 0, seconds: WARP_EXIT_SECONDS };
        else if (warp.phase === 'exit' && progress >= 1) this.warp = null;
    }

    /** The objective line: where the player stands with the collapse. */
    missionHud() {
        const state = this.client?.state;
        const here = state?.planets?.find((planet) => planet.id === state.you?.planet);
        let objective = null;
        if (state?.you?.alive && here) {
            if (state.finalStand !== null && here.status === PLANET_STATUS.SAFE) objective = { key: 'mp.objective.gate', params: { seconds: state.finalStand } };
            else if (here.status === PLANET_STATUS.COLLAPSING) objective = { key: 'mp.objective.flee', params: { seconds: here.changesIn ?? 0 } };
            else if (here.status === PLANET_STATUS.SWALLOWED) objective = { key: here.owner === state.you.faction ? 'mp.objective.sheltered' : 'mp.objective.doomed', params: null };
            else objective = { key: 'mp.objective.outward', params: null };
        }
        return { escort: null, boss: null, progress: null, objective };
    }

    dispose() {
        if (this.session) {
            this.session.world.warpFactor = 0;
            this.session.world.screenFade = 0;
        }
        this.warp = null;
        this.outro = null;
        this.openPanel = null;
        this.refitOpen = false;
    }
}
