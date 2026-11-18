import { useEffect } from 'react';
import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { isTouchDevice } from '../../input/device.js';
import { OUTRO_ACT } from '../../modes/battleRoyale/BattleRoyalePresenter.js';
import { rosterBySide } from '../../modes/battleRoyale/battleRoyaleState.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The two ceremonies of a battle royale match. Both are shows the 3D view plays; this puts
 * the words under them, out of their way:
 *
 *  - the introduction (before anybody is in the system), in two acts: the dying sun and the
 *    ships that run from it, then the stargate and the fleets that guard it. Under it the
 *    story, a line at a time, and from the second act on the three sides with their pilots.
 *    A key, a click or a tap skips it: the player then looks at the list of the sides, and
 *    the match starts early once everybody has skipped;
 *  - the ending (between the deciding moment and the result screen), in two acts too: at the
 *    stargate the winners go through it and everybody else watches it close; then the black
 *    hole takes the system and the fleets left in it.
 *
 * Both are timed by the match itself (`match.intro` counts down on the host and
 * `matchIntro` follows it; the presenter holds `matchOutro` for as long as the ending
 * plays), so every device shows them together.
 */

const IS_TOUCH = isTouchDevice();
/** Keys that skip nothing: those that mean nothing by themselves, and those with a job of their own even now (pause, mute, the view). */
const NOT_SKIP_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']);
const NOT_SKIP_CODES = new Set(['Escape', 'KeyP', 'KeyM', 'KeyV', 'KeyC']);

function pilotCount(t, count) {
    if (count === 0) return t('mp.intro.noPilots');
    return count === 1 ? t('mp.intro.onePilot') : t('mp.intro.pilots', { count });
}

/** One side on the list a player who skipped the story looks at: its name, what it has, and who flies for it. */
function SideCard({ side, yours, localId }) {
    const t = useT();
    return (
        <li className={`eod-intro-side eod-intro-side--${side.faction} ${yours ? 'eod-intro-side--yours' : ''}`}>
            {yours && <span className="eod-intro-yours">{t('mp.intro.yours')}</span>}
            <strong className={`eod-side--${side.faction}`}>{t(`mp.faction.${side.faction}`)}</strong>
            <small>{t(`mp.intro.side.${side.faction}`)}</small>
            <span className="eod-intro-count">{pilotCount(t, side.players.length)}</span>
            <ul>
                {side.players.map((player) => (
                    <li key={player.id} className={player.id === localId ? 'eod-intro-me' : ''}>{player.name}</li>
                ))}
            </ul>
        </li>
    );
}

/** The sides under the story: each one's name and how many fly for it, the player's own marked. */
function SideChips({ match }) {
    const t = useT();
    return (
        <ol className="eod-intro-chips">
            {rosterBySide(match).map((side) => {
                const yours = side.faction === match.you?.faction;
                return (
                    <li key={side.faction} className={`eod-intro-chip ${yours ? 'eod-intro-chip--yours' : ''}`}>
                        {yours && <em>{t('mp.intro.yours')}</em>}
                        <strong className={`eod-side--${side.faction}`}>{t(`mp.faction.${side.faction}`)}</strong>
                        <span>{pilotCount(t, side.players.length)}</span>
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * The introduction's words. `intro` is where the story stands on this device's stage
 * (`matchIntro` of the game store); `match.intro` the host's count of the seconds left.
 */
function MatchIntro({ match, intro, session }) {
    const t = useT();
    const { skipped } = intro;

    // (A key or click in the story's first moment is not taken for a wish to skip it: introStage.js.)
    const skip = () => session.match?.presenter?.skipIntro?.();
    useEffect(() => {
        if (skipped) return undefined;
        const onKey = (event) => {
            if (event.repeat || NOT_SKIP_KEYS.has(event.key) || NOT_SKIP_CODES.has(event.code) || /^F\d+$/.test(event.key)) return;
            session.match?.presenter?.skipIntro?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [session, skipped]);

    const entering = t('mp.intro.entering', { seconds: match.intro });
    const votes = match.skip ?? { voted: 0, voters: 0 };
    if (skipped) {
        // Skipped: the show goes on behind, dimmed, until everybody is ready; meanwhile, who is on which side.
        return (
            <div className="eod-cinematic eod-intro">
                <h2 className="eod-cinematic-title">{t('mp.intro.title')}</h2>
                <p className="eod-intro-line">{t('mp.intro.line4')}</p>
                <p className="eod-intro-line eod-intro-line--last">{t('mp.intro.line5')}</p>
                <ol className="eod-intro-sides">
                    {rosterBySide(match).map((side) => (
                        <SideCard key={side.faction} side={side} yours={side.faction === match.you?.faction} localId={match.localId} />
                    ))}
                </ol>
                <p className="eod-cinematic-footnote">{t('mp.intro.waiting', votes)} · {entering}</p>
            </div>
        );
    }
    const last = intro.line === BATTLE_ROYALE.intro.lines.length - 1;
    return (
        <div className="eod-cinematic eod-intro eod-intro--show" onClick={skip}>
            {intro.line === 0 && <h2 className="eod-cinematic-title">{t('mp.intro.title')}</h2>}
            {/* Keyed by the line, so each comes in afresh. */}
            <p key={intro.line} className={`eod-intro-caption ${last ? 'eod-intro-caption--last' : ''}`}>{t(`mp.intro.line${intro.line + 1}`)}</p>
            {intro.sides && <SideChips match={match} />}
            <p className="eod-cinematic-footnote">
                {t(IS_TOUCH ? 'mp.intro.skipTouch' : 'mp.intro.skip')} · {votes.voted > 0 ? `${t('mp.intro.votes', votes)} · ` : ''}{entering}
            </p>
        </div>
    );
}

function MatchOutro({ outro }) {
    const t = useT();
    const kind = !outro.winner ? 'none' : outro.won ? 'won' : 'lost';
    const faction = outro.winner ? t(`mp.faction.${outro.winner}`) : '';
    // The second act has its own words: what the black hole does to what is left.
    const fall = outro.act === OUTRO_ACT.FALL;
    const words = fall ? `mp.outro.fall.${kind}` : `mp.outro.${kind}`;
    const seconds = fall ? BATTLE_ROYALE.outro.fall.seconds : BATTLE_ROYALE.outro.seconds;
    return (
        // Keyed by the act, so the words of each come in afresh.
        <div key={outro.act} className={`eod-cinematic eod-outro eod-outro--${kind} eod-outro--${fall ? 'fall' : 'gate'}`} style={{ '--eod-outro-seconds': `${seconds}s` }}>
            <h2 className={`eod-cinematic-title ${outro.winner && !fall ? `eod-side--${outro.winner}` : ''}`}>{t(`${words}.title`)}</h2>
            <p className="eod-outro-text">{t(`${words}.text`, { faction })}</p>
        </div>
    );
}

/**
 * Shows whichever ceremony is on; nothing during ordinary play.
 * @param {{ session: import('../../state/GameSession.js').GameSession }} props
 */
export default function MatchCinematic({ session }) {
    const match = useGameStore((state) => state.match);
    const intro = useGameStore((state) => state.matchIntro);
    const outro = useGameStore((state) => state.matchOutro);
    if (outro) return <MatchOutro outro={outro} />;
    if (intro && match?.intro != null && match.players) return <MatchIntro match={match} intro={intro} session={session} />;
    return null;
}
