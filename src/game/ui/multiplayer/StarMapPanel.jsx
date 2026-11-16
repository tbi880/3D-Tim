import { PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { isBattle } from '../../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../../modes/battleRoyale/collapse.js';
import { EQUIPMENT } from '../../modes/battleRoyale/equipment.js';
import { useGameStore, useT } from '../../state/gameStore.js';
import { EQUIPMENT_ICONS } from './EquipmentPanel.jsx';

/**
 * The star map (battle royale): every planet from the collapsing sun outwards, how the
 * collapse stands at each, and - where the player's side has eyes (a pilot of theirs, a
 * station it holds, or a beacon) - what is there and who holds its station. The planets within the drive's reach have a button to jump there; the
 * ones next door, while the player carries a beacon, one to launch it.
 * Opened with G or the HUD's map button; the ship holds its course while it is open.
 */

const ORBITS = STAR_SYSTEM.planets;
const orbitOf = (planetId) => ORBITS.findIndex((planet) => planet.id === planetId);

/** Why the player cannot jump right now (an i18n key and its numbers), or null if they can. */
function jumpBlock(you) {
    if (!you.alive) return { key: 'mp.jump.refused.noShip' };
    if (you.jump.to) return { key: 'mp.jump.refused.spooling' };
    if (you.jump.trapped) return { key: 'mp.hud.jumpTrapped' };
    if (you.jump.cooldown > 0) return { key: 'mp.hud.jumpCharging', params: { seconds: you.jump.cooldown } };
    return null;
}

/** What stands at a planet the player's side can see: ships by side, the station's holder, a docking in progress. */
function Intel({ planet }) {
    const t = useT();
    const sides = PLAYER_FACTIONS.filter((faction) => planet.forces[faction] > 0);
    return (
        <>
            <span className="eod-map-forces" title={t('mp.map.forces', planet.forces)}>
                {sides.map((faction) => <b key={faction} className={`eod-side--${faction}`}>◆ {planet.forces[faction]}</b>)}
                {sides.length === 0 && <b>◇ 0</b>}
                {isBattle(planet.forces) && <em>{t('mp.map.battle')}</em>}
            </span>
            <span className={`eod-map-owner ${planet.owner ? `eod-side--${planet.owner}` : ''}`}>
                {planet.owner ? t('mp.map.station', { faction: t(`mp.faction.${planet.owner}`) }) : t('mp.map.stationFree')}
            </span>
            {planet.docking && <span className={`eod-map-docking eod-side--${planet.docking}`}>{t('mp.map.docking', { faction: t(`mp.faction.${planet.docking}`) })}</span>}
        </>
    );
}

function PlanetCard({ planet, you, presenter }) {
    const t = useT();
    const here = planet.id === you.planet;
    const orbits = Math.abs(orbitOf(planet.id) - orbitOf(you.planet));
    const gate = ORBITS[ORBITS.length - 1].id === planet.id;
    const block = jumpBlock(you);
    const timer = planet.changesIn === null ? null
        : t(planet.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: planet.changesIn });
    const canScout = orbits === 1 && you.alive && you.equipment[EQUIPMENT.BEACON] > 0 && !planet.beacon;

    return (
        <li className={`eod-map-planet eod-map-planet--${planet.status} ${here ? 'eod-map-planet--here' : ''} ${planet.owner ? `eod-map-planet--held-${planet.owner}` : ''}`}>
            <span className="eod-map-globe" aria-hidden="true">{gate ? '◎' : '●'}</span>
            <strong>{t(`mp.planet.${planet.id}`)}</strong>
            <span className="eod-map-status">{gate && planet.status === PLANET_STATUS.SAFE ? t('mp.map.gate') : t(`mp.hud.status.${planet.status}`)}</span>
            {timer && <span className="eod-map-timer">{timer}</span>}
            {planet.known ? <Intel planet={planet} /> : <span className="eod-map-unknown">{t('mp.map.unknown')}</span>}
            {planet.beacon && <span className="eod-map-watched">{EQUIPMENT_ICONS[EQUIPMENT.BEACON]} {t('mp.map.watched')}</span>}
            {planet.comrades.length > 0 && <span className="eod-map-comrades">{t('mp.map.comrades', { names: planet.comrades.join(', ') })}</span>}
            {here && <span className="eod-map-here">{t('mp.map.here')}</span>}
            {canScout && (
                <button type="button" className="eod-button eod-map-beacon" onClick={() => presenter.launchBeacon(planet.id)}>
                    {EQUIPMENT_ICONS[EQUIPMENT.BEACON]} {t('mp.map.beacon')}
                </button>
            )}
            {orbits >= 1 && orbits <= you.jump.reach && (
                <button type="button" className="eod-button eod-button--primary eod-map-jump" disabled={Boolean(block)} onClick={() => presenter.jumpTo(planet.id)}>
                    {orbits > 1 ? `${EQUIPMENT_ICONS[EQUIPMENT.OVERDRIVE]} ${t('mp.map.overdrive')}` : t('mp.map.jump')}
                    {block && <small>{t(block.key, block.params)}</small>}
                </button>
            )}
        </li>
    );
}

/**
 * @param {object} props
 * @param {import('../../state/GameSession.js').GameSession} props.session
 */
export default function StarMapPanel({ session }) {
    const match = useGameStore((state) => state.match);
    const t = useT();
    const presenter = session.match?.presenter;
    if (!match?.you || !presenter) return null;

    return (
        <div className="eod-screen eod-screen--overlay eod-map">
            <h2 className="eod-screen-heading eod-refit-title">{t('mp.map.title')}</h2>
            <p className="eod-screen-text">
                {match.finalStand !== null ? t('mp.map.finalStand', { seconds: match.finalStand }) : t('mp.map.hint')}
            </p>
            <ol className="eod-map-orbits">
                <li className="eod-map-sun" aria-hidden="true">◉</li>
                {match.planets.map((planet) => <PlanetCard key={planet.id} planet={planet} you={match.you} presenter={presenter} />)}
            </ol>
            <div className="eod-menu">
                <button type="button" className="eod-button" onClick={() => presenter.setPanel(null)}>{t('mp.map.close')}</button>
            </div>
        </div>
    );
}
