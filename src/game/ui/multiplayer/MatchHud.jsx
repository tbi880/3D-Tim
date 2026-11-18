import { LOYALTY } from '../../modes/battleRoyale/allegiance.js';
import { MATCH_ACTION } from '../../modes/battleRoyale/BattleRoyalePresenter.js';
import { PLANET_STATUS } from '../../modes/battleRoyale/collapse.js';
import { EQUIPMENT_ORDER } from '../../modes/battleRoyale/equipment.js';
import { useGameStore, useT } from '../../state/gameStore.js';
import { EQUIPMENT_ICONS } from './EquipmentPanel.jsx';

/**
 * The battle royale's part of the in-flight HUD: which side the pilot is on, where they
 * are and how long that will last, the jump drive, what they carry and have to spend, the
 * station's dock when the ship is in it, the comrades, where to come back after being shot
 * down and whom to watch meanwhile - and the buttons for the map, the refit window,
 * reinforcements, docking and the equipment (keys G, U, B, E and I).
 *
 * Each part is placed by ui/GameHud.jsx in one of its docks, so that it stacks with the
 * panels it shows up with instead of covering them. GameHud shows none of them during a
 * match's introduction or ending. Each one draws nothing outside a match.
 */

/** What the pilot carries, and which of it is on right now. */
function EquipmentRow({ you }) {
    const t = useT();
    const carried = EQUIPMENT_ORDER.filter((item) => you.equipment[item] > 0);
    const effects = Object.entries(you.effects).filter(([, seconds]) => seconds > 0);
    if (carried.length === 0 && effects.length === 0) return null;
    return (
        <div className="eod-match-row eod-match-gear">
            {carried.map((item) => (
                <span key={item} title={t(`mp.equipment.${item}.name`)}>{EQUIPMENT_ICONS[item]}{you.equipment[item] > 1 && <b>×{you.equipment[item]}</b>}</span>
            ))}
            {effects.map(([item, seconds]) => <strong key={item} className="eod-match-effect">{t(`mp.equipment.effect.${item}`, { seconds })}</strong>)}
        </div>
    );
}

/** Side, planet and jump drive, and what the pilot carries. */
function MatchRows({ match }) {
    const t = useT();
    const you = match.you;
    const here = match.planets.find((planet) => planet.id === you.planet);
    const jump = you.jump.to ? t('mp.hud.jumpSpooling', { planet: t(`mp.planet.${you.jump.to}`) })
        : you.jump.trapped ? t('mp.hud.jumpTrapped')
            : you.jump.cooldown > 0 ? t('mp.hud.jumpCharging', { seconds: you.jump.cooldown }) : t('mp.hud.jumpReady');
    const timer = here && here.changesIn !== null
        ? t(here.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: here.changesIn })
        : null;

    return (
        <>
            <div className="eod-match-row eod-match-row--side">
                <span className="eod-meter-label">{t('mp.hud.side')}</span>
                <strong className={`eod-side--${you.faction}`}>{t(`mp.faction.${you.faction}`)}</strong>
                {Number.isFinite(match.rtt) && <small className="eod-match-ping">{t('mp.hud.ping', { ms: match.rtt })}</small>}
            </div>
            {here && (
                <div className="eod-match-row eod-match-row--planet">
                    <span className="eod-meter-label">{t('mp.hud.planet')}</span>
                    <strong className={`eod-match-planet--${here.status}`}>{t(`mp.planet.${here.id}`)}</strong>
                    <small>{timer ?? t(`mp.hud.status.${here.status}`)}</small>
                </div>
            )}
            <div className="eod-match-row eod-match-row--jump">
                <span className="eod-meter-label">{t('mp.hud.jump')}</span>
                <strong className={you.jump.cooldown === 0 && !you.jump.trapped ? 'eod-match-ready' : ''}>{jump}</strong>
            </div>
            <EquipmentRow you={you} />
        </>
    );
}

/** The mode's buttons: map, equipment, refit and reinforcements. */
export function MatchButtons({ session }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    if (!you) return null;
    const act = (action) => () => session.handleAction(action);
    return (
        <div className="eod-match-buttons">
            <button type="button" className="eod-match-button" onClick={act(MATCH_ACTION.MAP)}>
                <kbd>{t('mp.hud.keyMap')}</kbd>{t('mp.hud.map')}
            </button>
            <button type="button" className={`eod-match-button ${you.picks > 0 ? 'eod-match-button--calling' : ''}`} onClick={act(MATCH_ACTION.EQUIPMENT)}>
                <kbd>{t('mp.hud.keyEquipment')}</kbd>{t('mp.hud.equipment')}{you.picks > 0 && <b>{you.picks}</b>}
            </button>
            <button type="button" className="eod-match-button" disabled={!you.alive || you.points === 0} onClick={act(MATCH_ACTION.REFIT)}>
                <kbd>{t('mp.hud.keyRefit')}</kbd>{t('mp.hud.refit')}<b>{you.points}</b>
            </button>
            <button type="button" className="eod-match-button" disabled={!you.alive || you.summons === 0} onClick={act(MATCH_ACTION.SUMMON)}>
                <kbd>{t('mp.hud.keySummon')}</kbd>{t('mp.hud.summon')}<b>{you.summons}</b>
            </button>
        </div>
    );
}

/**
 * Side, planet, jump drive and rewards in one panel - with the mode's buttons under them, or
 * (`buttons={false}`, phones) without: there the buttons sit between the thumbs (MatchButtons).
 */
export function MatchStatus({ session, buttons = true }) {
    const match = useGameStore((state) => state.match);
    if (!match?.you) return null;
    return (
        <div className={`eod-panel eod-match-status ${buttons ? '' : 'eod-match-status--strip'}`}>
            <MatchRows match={match} />
            {buttons && <MatchButtons session={session} />}
        </div>
    );
}

/**
 * The station's dock. In its mouth: the button that clamps the ship on. Clamped on: how long
 * is left, and the button that lets go.
 */
export function DockPrompt({ session }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    const dock = you?.dock;
    if (!you?.alive || !dock || (!dock.ready && dock.left === null)) return null;
    const toggle = () => session.handleAction(MATCH_ACTION.DOCK);
    if (dock.left === null) {
        const holder = match.planets.find((planet) => planet.id === you.planet)?.owner;
        return (
            <div className="eod-panel eod-match-dock">
                <span>{holder ? t('mp.dock.promptHeld', { seconds: dock.seconds, faction: t(`mp.faction.${holder}`) }) : t('mp.dock.prompt', { seconds: dock.seconds })}</span>
                <button type="button" className="eod-button eod-button--primary" onClick={toggle}><kbd>{t('mp.hud.keyDock')}</kbd>{t('mp.hud.dock')}</button>
            </div>
        );
    }
    const done = Math.min(1, Math.max(0, 1 - dock.left / dock.seconds));
    return (
        <div className="eod-panel eod-match-dock eod-match-dock--on">
            <strong>{t('mp.dock.progress', { seconds: Math.ceil(dock.left) })}</strong>
            <div className="eod-match-dock-bar"><i style={{ width: `${done * 100}%` }} /></div>
            <span>{t('mp.dock.locked')}</span>
            <button type="button" className="eod-button" onClick={toggle}><kbd>{t('mp.hud.keyDock')}</kbd>{t('mp.hud.undock')}</button>
        </div>
    );
}

/** The collapse and the pilot's own side shouting at them: lines for GameHud's alert stack. */
export function MatchAlerts() {
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
    // (Shot down, the choice of where to come back says so: RespawnPrompt.)
    if (!you.alive && !you.respawn) alerts.push(t('mp.hud.dead'));
    if (alerts.length === 0) return null;
    return alerts.map((text) => <span key={text} className="eod-alert">{text}</span>);
}

/**
 * Shot down: how long until the pilot may come back, then a button for each station their
 * side holds - the first one (key E) is where they are sent if they let the clock run out.
 * During the wait the buttons are there but not yet live, so the choice can be made ahead. A
 * station another side is docked at, taking it, is shown greyed out until that is settled.
 * Once the pilot's side is out, it says so instead. Either way, under it: whom they watch fly.
 */
export function RespawnPrompt({ session }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    const presenter = session.match?.presenter;
    if (!you || you.alive || !presenter || (!you.respawn && !you.out)) return null;
    if (you.out) {
        return (
            <div className="eod-panel eod-match-respawn">
                <strong>{t('mp.out.title')}</strong>
                <p>{t('mp.out.text')}</p>
                <WatchBar match={match} presenter={presenter} />
            </div>
        );
    }
    const { respawn } = you;
    const ready = respawn.wait === 0;
    const open = respawn.stations.length > 0;
    const none = !open && respawn.contested.length === 0;
    const headline = !ready ? t('mp.respawn.waiting', { seconds: respawn.wait })
        : none ? t('mp.respawn.noStation')
            : !open ? t('mp.respawn.allContested') : t('mp.respawn.choose', { seconds: respawn.choose ?? 0 });
    const statusOf = (planetId) => match.planets.find((planet) => planet.id === planetId)?.status ?? PLANET_STATUS.SAFE;
    return (
        <div className={`eod-panel eod-match-respawn ${ready && open ? 'eod-match-respawn--ready' : ''}`}>
            <strong>{headline}</strong>
            <p>{none ? t('mp.respawn.noStationText') : t('mp.respawn.text', { next: respawn.next })}</p>
            {!none && (
                <div className="eod-match-respawn-stations">
                    {respawn.stations.map((planetId, index) => (
                        <button
                            key={planetId}
                            type="button"
                            className={`eod-button ${index === 0 ? 'eod-button--primary' : ''}`}
                            disabled={!ready}
                            onClick={() => presenter.respawnAt(planetId)}
                        >
                            <span>
                                {index === 0 && <kbd>{t('mp.hud.keyDock')}</kbd>}
                                {t('mp.respawn.station', { planet: t(`mp.planet.${planetId}`) })}
                            </span>
                            <small className={`eod-match-planet--${statusOf(planetId)}`}>
                                {t(`mp.hud.status.${statusOf(planetId)}`)}{index === 0 ? ` · ${t('mp.respawn.default')}` : ''}
                            </small>
                        </button>
                    ))}
                    {respawn.contested.map((planetId) => (
                        <button key={planetId} type="button" className="eod-button eod-match-respawn-contested" disabled>
                            <span>{t('mp.respawn.station', { planet: t(`mp.planet.${planetId}`) })}</span>
                            <small>{t('mp.respawn.contested')}</small>
                        </button>
                    ))}
                </div>
            )}
            <WatchBar match={match} presenter={presenter} />
        </div>
    );
}

/**
 * Whom a pilot who is down watches fly: the name, the previous and next pilot they may watch
 * (key T steps on too) and a button that stops watching - the view goes back to where they are.
 */
function WatchBar({ match, presenter }) {
    const t = useT();
    const candidates = presenter.watchCandidates();
    const { watching } = match.you;
    const name = watching ? match.players.find((player) => player.id === watching)?.name : null;
    if (candidates.length === 0 && !watching) return <div className="eod-match-watch"><span>{t('mp.watch.nobody')}</span></div>;
    return (
        <div className="eod-match-watch">
            <span>{t('mp.watch.label')}</span>
            <button type="button" className="eod-match-button" disabled={candidates.length === 0} onClick={() => presenter.watchNext(-1)}>◀</button>
            <strong>{name ?? t('mp.watch.none')}</strong>
            <button type="button" className="eod-match-button" disabled={candidates.length === 0} onClick={() => presenter.watchNext(1)}>
                ▶<kbd>{t('mp.watch.key')}</kbd>
            </button>
            {watching && <button type="button" className="eod-match-button" onClick={() => presenter.watch(null)}>{t('mp.watch.stop')}</button>}
        </div>
    );
}

/**
 * The player's comrades, wherever they are: each one's ship, planet, hull and shield - or how
 * long until they may come back. While the player's own ship is lost, a comrade in the air can
 * be clicked (tapped) to watch them fly. On a phone (`onlyWhenDown`) it comes up only then:
 * in flight the screen has no room for it.
 */
export function TeamPanel({ session, onlyWhenDown = false }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const you = match?.you;
    const presenter = session.match?.presenter;
    if (!you || you.team.length === 0 || (onlyWhenDown && you.alive)) return null;
    const down = !you.alive;
    const state = (mate) => {
        if (mate.alive) return mate.docking ? t('mp.team.docking') : mate.planet ? t(`mp.planet.${mate.planet}`) : '';
        if (you.out || mate.wait === null) return t('mp.team.out');
        return mate.wait > 0 ? t('mp.team.waiting', { seconds: mate.wait }) : t('mp.team.ready');
    };
    return (
        <div className="eod-panel eod-match-team">
            <span className="eod-meter-label">{t('mp.team.title')}{down ? ` · ${t('mp.team.watchHint')}` : ''}</span>
            {you.team.map((mate) => {
                const watchable = down && mate.alive;
                const watched = you.watching === mate.id;
                return (
                    <button
                        key={mate.id}
                        type="button"
                        className={`eod-match-mate ${mate.alive ? '' : 'eod-match-mate--down'} ${watched ? 'eod-match-mate--watched' : ''}`}
                        disabled={!watchable}
                        onClick={() => presenter?.watch(mate.id)}
                    >
                        <span className="eod-match-mate-name">{watched ? '◉ ' : ''}{mate.name}</span>
                        <small>{state(mate)}</small>
                        {mate.alive && (
                            <span className="eod-match-mate-bars">
                                <i className="eod-match-mate-shield" style={{ width: `${mate.shield}%` }} />
                                <i className="eod-match-mate-hull" style={{ width: `${mate.hull}%` }} />
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
