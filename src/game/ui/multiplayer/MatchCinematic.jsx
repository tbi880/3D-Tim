import { rosterBySide } from '../../modes/battleRoyale/battleRoyaleState.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The two short ceremonies of a battle royale match, drawn over the 3D view:
 *
 *  - the introduction (about ten seconds, before anybody is in the system): what is
 *    happening here, why everybody wants the stargate, and the three sides with their pilots;
 *  - the ending (five seconds, between the deciding moment and the result screen): the
 *    winners go through the gate, everybody else stays with the star.
 *
 * Both are timed by the match itself (`match.intro` counts down on the host; the presenter
 * holds `matchOutro` for as long as the ending plays), so every device shows them together.
 */

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
    return (
        <div className="eod-cinematic eod-intro">
            <h2 className="eod-cinematic-title">{t('mp.intro.title')}</h2>
            <p className="eod-intro-line eod-intro-line--1">{t('mp.intro.story1')}</p>
            <p className="eod-intro-line eod-intro-line--2">{t('mp.intro.story2')}</p>
            <p className="eod-intro-line eod-intro-line--3">{t('mp.intro.story3')}</p>
            <ol className="eod-intro-sides">
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
    return (
        <div className={`eod-cinematic eod-outro eod-outro--${kind}`}>
            {/* The winners' own moment: light breaking over the screen as the gate opens. */}
            {outro.won && <div className="eod-outro-burst" aria-hidden="true" />}
            <h2 className={`eod-cinematic-title ${outro.winner ? `eod-side--${outro.winner}` : ''}`}>{t(`mp.outro.${kind}.title`)}</h2>
            <p className="eod-outro-text">{t(`mp.outro.${kind}.text`, { faction })}</p>
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
