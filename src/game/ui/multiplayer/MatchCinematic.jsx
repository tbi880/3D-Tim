import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { OUTRO_ACT } from '../../modes/battleRoyale/BattleRoyalePresenter.js';
import { rosterBySide } from '../../modes/battleRoyale/battleRoyaleState.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The two short ceremonies of a battle royale match, drawn over the 3D view:
 *
 *  - the introduction (about ten seconds, before anybody is in the system): what is
 *    happening here, why everybody wants the stargate, and the three sides with their pilots;
 *  - the ending (between the deciding moment and the result screen), in two acts that the
 *    3D view plays: at the stargate the winners go through it and everybody else watches it
 *    close; then the black hole takes the system and the fleets left in it. This puts the
 *    words under each.
 *
 * Both are timed by the match itself (`match.intro` counts down on the host; the presenter
 * holds `matchOutro` for as long as the ending plays), so every device shows them together.
 */

/**
 * Seconds into the introduction at which each part appears. They follow the match's own
 * countdown, not a clock of this page's, so a device that was slow to draw (or whose page
 * was in the background) shows what everybody else is looking at.
 */
const INTRO_BEATS = Object.freeze({ story2: 2, story3: 3, sides: 4 });
const shown = (visible) => (visible ? 'eod-cine-part' : 'eod-cine-part eod-cine-part--waiting');

function pilotCount(t, count) {
    if (count === 0) return t('mp.intro.noPilots');
    return count === 1 ? t('mp.intro.onePilot') : t('mp.intro.pilots', { count });
}

/** One side on the introduction: its name, what it has, and who flies for it. */
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

function MatchIntro({ match }) {
    const t = useT();
    const elapsed = BATTLE_ROYALE.intro.seconds - match.intro;
    return (
        <div className="eod-cinematic eod-intro">
            <h2 className="eod-cinematic-title">{t('mp.intro.title')}</h2>
            <p className="eod-intro-line">{t('mp.intro.story1')}</p>
            <p className={`eod-intro-line ${shown(elapsed >= INTRO_BEATS.story2)}`}>{t('mp.intro.story2')}</p>
            <p className={`eod-intro-line eod-intro-line--last ${shown(elapsed >= INTRO_BEATS.story3)}`}>{t('mp.intro.story3')}</p>
            <ol className={`eod-intro-sides ${shown(elapsed >= INTRO_BEATS.sides)}`}>
                {rosterBySide(match).map((side) => (
                    <SideCard key={side.faction} side={side} yours={side.faction === match.you?.faction} localId={match.localId} />
                ))}
            </ol>
            <p className="eod-cinematic-footnote">{t('mp.intro.entering', { seconds: match.intro })}</p>
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

/** Shows whichever ceremony is on; nothing during ordinary play. */
export default function MatchCinematic() {
    const match = useGameStore((state) => state.match);
    const outro = useGameStore((state) => state.matchOutro);
    if (outro) return <MatchOutro outro={outro} />;
    if (match?.intro != null && match.players) return <MatchIntro match={match} />;
    return null;
}
