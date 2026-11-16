import { STAR_SYSTEM } from '../../config/battleRoyale.js';
import { PLANET_STATUS } from '../../modes/battleRoyale/collapse.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The star map (battle royale): every planet from the collapsing sun outwards, what is
 * happening at each, and - for the two next to the player's - a button to jump there.
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

function PlanetCard({ planet, you, onJump }) {
    const t = useT();
    const here = planet.id === you.planet;
    const neighbour = Math.abs(orbitOf(planet.id) - orbitOf(you.planet)) === 1;
    const gate = ORBITS[ORBITS.length - 1].id === planet.id;
    const battle = planet.forces.dawn > 0 && planet.forces.umbra > 0;
    const block = jumpBlock(you);
    const timer = planet.changesIn === null ? null
        : t(planet.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: planet.changesIn });

    return (
        <li className={`eod-map-planet eod-map-planet--${planet.status} ${here ? 'eod-map-planet--here' : ''} ${planet.owner ? `eod-map-planet--held-${planet.owner}` : ''}`}>
            <span className="eod-map-globe" aria-hidden="true">{gate ? '◎' : '●'}</span>
            <strong>{t(`mp.planet.${planet.id}`)}</strong>
            <span className="eod-map-status">{gate && planet.status === PLANET_STATUS.SAFE ? t('mp.map.gate') : t(`mp.hud.status.${planet.status}`)}</span>
            {timer && <span className="eod-map-timer">{timer}</span>}
            <span className="eod-map-forces">
                {t('mp.map.forces', planet.forces)}{battle && <em> · {t('mp.map.battle')}</em>}
            </span>
            {planet.owner && <span className={`eod-map-owner eod-side--${planet.owner}`}>{t('mp.hud.bubble', { faction: t(`mp.faction.${planet.owner}`) })}</span>}
            {planet.comrades.length > 0 && <span className="eod-map-comrades">{t('mp.map.comrades', { names: planet.comrades.join(', ') })}</span>}
            {here && <span className="eod-map-here">{t('mp.map.here')}</span>}
            {neighbour && (
                <button type="button" className="eod-button eod-button--primary eod-map-jump" disabled={Boolean(block)} onClick={() => onJump(planet.id)}>
                    {t('mp.map.jump')}
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
                {match.planets.map((planet) => <PlanetCard key={planet.id} planet={planet} you={match.you} onJump={(planetId) => presenter.jumpTo(planetId)} />)}
            </ol>
            <div className="eod-menu">
                <button type="button" className="eod-button" onClick={() => presenter.setPanel(null)}>{t('mp.map.close')}</button>
            </div>
        </div>
    );
}
