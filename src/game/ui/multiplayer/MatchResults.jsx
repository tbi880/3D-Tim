import { rankPlayers } from '../../modes/battleRoyale/battleRoyaleState.js';
import { MATCH_PHASE } from '../../net/match/matchState.js';
import { useLanStore } from '../../net/lobby/lanStore.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The end of a match: who won, the players in order (the winning side first, by score),
 * and the way back to the lobby - the host's to open for everybody.
 */

function outcome(match) {
    if (match.phase === MATCH_PHASE.DISCONNECTED) return { title: 'mp.result.disconnected', text: 'mp.result.disconnectedText', tone: 'failure' };
    if (!match.winner) return { title: 'mp.result.draw', text: 'mp.result.noWinner', tone: 'failure' };
    const won = match.you?.faction === match.winner;
    return { title: won ? 'mp.result.victory' : 'mp.result.defeat', text: 'mp.result.winner', tone: won ? 'victory' : 'failure' };
}

/**
 * @param {object} props
 * @param {import('../../net/lobby/LanMultiplayer.js').LanMultiplayer} props.lan
 */
export default function MatchResults({ lan }) {
    const match = useGameStore((state) => state.match);
    const online = useLanStore((state) => Boolean(state.room) && state.status === 'online');
    const t = useT();
    if (!match) return null;
    const { title, text, tone } = outcome(match);
    const players = match.players?.length ? rankPlayers(match) : [];

    return (
        <div className={`eod-screen eod-screen--overlay eod-result eod-result--${tone}`}>
            <h2 className="eod-screen-heading">{t(title)}</h2>
            <p className="eod-screen-text">{t(text, { faction: match.winner ? t(`mp.faction.${match.winner}`) : '' })}</p>
            {players.length > 0 && (
                <table className="eod-result-table">
                    <thead>
                        <tr><th>{t('mp.result.rank')}</th><th>{t('mp.result.pilot')}</th><th>{t('mp.hud.side')}</th><th>{t('mp.result.kills')}</th><th>{t('mp.result.score')}</th></tr>
                    </thead>
                    <tbody>
                        {players.map((player, index) => (
                            <tr key={player.id} className={`${player.id === match.localId ? 'eod-result-me' : ''} ${player.faction === match.winner ? 'eod-result-winner' : ''}`}>
                                <td>{index + 1}</td>
                                <td>{player.name}</td>
                                <td className={`eod-side--${player.faction}`}>{t(`mp.faction.${player.faction}`)}</td>
                                <td>{player.kills}</td>
                                <td>{player.score.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div className="eod-menu">
                {online && lan.isHost && (
                    <button type="button" className="eod-button eod-button--primary" onClick={() => lan.returnToLobby()}>{t('mp.result.backToLobby')}</button>
                )}
                {online && !lan.isHost && <p className="eod-screen-footnote">{t('mp.result.waitingForHost')}</p>}
                <button type="button" className="eod-button" onClick={() => lan.leaveRoom()}>{t('mp.result.leave')}</button>
            </div>
        </div>
    );
}
