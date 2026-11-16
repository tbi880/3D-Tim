import { LOYALTY } from '../../modes/battleRoyale/allegiance.js';
import { MATCH_ACTION } from '../../modes/battleRoyale/BattleRoyalePresenter.js';
import { VOTE } from '../../modes/battleRoyale/battleRoyaleProtocol.js';
import { PLANET_STATUS } from '../../modes/battleRoyale/collapse.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The battle royale's part of the in-flight HUD: which side the pilot is on, where they
 * are and how long that will last, the jump drive, what they have to spend - and the
 * buttons for the map, the refit window and reinforcements (keys G, U and B).
 */

/** Side, planet, jump drive and rewards, with the mode's three buttons. */
function MatchStatus({ session }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    if (!you) return null;
    const here = match.planets.find((planet) => planet.id === you.planet);
    const act = (action) => () => session.handleAction(action);
    const jump = you.jump.to ? t('mp.hud.jumpSpooling', { planet: t(`mp.planet.${you.jump.to}`) })
        : you.jump.trapped ? t('mp.hud.jumpTrapped')
            : you.jump.cooldown > 0 ? t('mp.hud.jumpCharging', { seconds: you.jump.cooldown }) : t('mp.hud.jumpReady');
    const timer = here && here.changesIn !== null
        ? t(here.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: here.changesIn })
        : null;

    return (
        <div className="eod-panel eod-match-status">
            <div className="eod-match-row">
                <span className="eod-meter-label">{t('mp.hud.side')}</span>
                <strong className={`eod-side--${you.faction}`}>{t(`mp.faction.${you.faction}`)}</strong>
                {Number.isFinite(match.rtt) && <small className="eod-match-ping">{t('mp.hud.ping', { ms: match.rtt })}</small>}
            </div>
            {here && (
                <div className="eod-match-row">
                    <span className="eod-meter-label">{t('mp.hud.planet')}</span>
                    <strong className={`eod-match-planet--${here.status}`}>{t(`mp.planet.${here.id}`)}</strong>
                    <small>{timer ?? t(`mp.hud.status.${here.status}`)}</small>
                </div>
            )}
            <div className="eod-match-row">
                <span className="eod-meter-label">{t('mp.hud.jump')}</span>
                <strong className={you.jump.cooldown === 0 && !you.jump.trapped ? 'eod-match-ready' : ''}>{jump}</strong>
            </div>
            <div className="eod-match-buttons">
                <button type="button" className="eod-match-button" onClick={act(MATCH_ACTION.MAP)}>
                    <kbd>{t('mp.hud.keyMap')}</kbd>{t('mp.hud.map')}
                </button>
                <button type="button" className="eod-match-button" disabled={!you.alive || you.points === 0} onClick={act(MATCH_ACTION.REFIT)}>
                    <kbd>{t('mp.hud.keyRefit')}</kbd>{t('mp.hud.refit')}<b>{you.points}</b>
                </button>
                <button type="button" className="eod-match-button" disabled={!you.alive || you.summons === 0} onClick={act(MATCH_ACTION.SUMMON)}>
                    <kbd>{t('mp.hud.keySummon')}</kbd>{t('mp.hud.summon')}<b>{you.summons}</b>
                </button>
            </div>
        </div>
    );
}

/** The collapse and the pilot's own side shouting at them. */
function MatchAlerts() {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    if (!you) return null;
    const here = match.planets.find((planet) => planet.id === you.planet);
    const sheltered = here?.owner === you.faction;
    const alerts = [];
    if (you.alive && here && !sheltered) {
        if (here.status === PLANET_STATUS.COLLAPSING) alerts.push(t('mp.alert.collapsing', { seconds: here.changesIn ?? 0 }));
        if (here.status === PLANET_STATUS.SWALLOWED) alerts.push(t('mp.alert.swallowed'));
    }
    if (you.loyalty === LOYALTY.WARNED) alerts.push(t('mp.alert.warned'));
    if (!you.alive) alerts.push(t('mp.hud.dead'));
    if (alerts.length === 0) return null;
    return (
        <div className="eod-alerts eod-match-alerts">
            {alerts.map((text) => <span key={text} className="eod-alert">{text}</span>)}
        </div>
    );
}

/** After taking a planet with comrades down: the reward, or bring them back. */
function VotePrompt({ session }) {
    const vote = useGameStore((state) => state.match?.you?.vote);
    const t = useT();
    const presenter = session.match?.presenter;
    if (!vote || !presenter) return null;
    const choice = (value, label) => (
        <button type="button" className={`eod-button ${vote.choice === value ? 'eod-button--primary' : ''}`} onClick={() => presenter.vote(value)}>
            {t(label)}
            {vote.choice === value && <small>{t('mp.vote.chosen')}</small>}
        </button>
    );
    return (
        <div className="eod-panel eod-match-vote">
            <strong>{t('mp.vote.title', { planet: t(`mp.planet.${vote.planet}`) })} · {t('mp.vote.endsIn', { seconds: vote.endsIn })}</strong>
            <p>{t('mp.vote.text')}</p>
            <div className="eod-match-vote-choices">
                {choice(VOTE.REWARD, 'mp.vote.reward')}
                {choice(VOTE.REVIVE, 'mp.vote.revive')}
            </div>
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../../state/GameSession.js').GameSession} props.session
 */
export default function MatchHud({ session }) {
    const inMatch = useGameStore((state) => Boolean(state.match));
    if (!inMatch) return null;
    return (
        <>
            <MatchStatus session={session} />
            <MatchAlerts />
            <VotePrompt session={session} />
        </>
    );
}
