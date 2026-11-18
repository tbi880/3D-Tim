import { useLayoutEffect, useRef, useState } from 'react';
import { PLAYER_FACTIONS, STAR_SYSTEM } from '../../config/battleRoyale.js';
import { isBattle, jumpChoice } from '../../modes/battleRoyale/battleRoyaleState.js';
import { PLANET_STATUS } from '../../modes/battleRoyale/collapse.js';
import { EQUIPMENT } from '../../modes/battleRoyale/equipment.js';
import { useGameStore, useT } from '../../state/gameStore.js';
import { isGatePlanet, lookOf, paintPlanet, paintSystemBackdrop } from '../systemChart.js';
import { EQUIPMENT_ICONS } from './EquipmentPanel.jsx';

/**
 * The star map (battle royale): every planet from the collapsing sun outwards, how the
 * collapse stands at each, and - where the player's side has eyes (a pilot of theirs, a
 * station it holds, or a beacon) - what is there and who holds its station. The planets within the drive's reach have a button to jump there; the
 * ones next door, while the player carries a beacon, one to launch it.
 * Behind the cards, the system side on (ui/systemChart.js): the sun at the left, the orbits
 * round it, each planet drawn at the top of its card, and "Sun → outer orbits" along the bottom.
 * Opened with G or the HUD's map button; the ship holds its course while it is open.
 */

const ORBITS = STAR_SYSTEM.planets;
const orbitOf = (planetId) => ORBITS.findIndex((planet) => planet.id === planetId);

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
    const jump = jumpChoice(you, orbits);
    const timer = planet.changesIn === null ? null
        : t(planet.status === PLANET_STATUS.SAFE ? 'mp.hud.fallsIn' : 'mp.hud.goneIn', { seconds: planet.changesIn });
    const canScout = orbits === 1 && you.alive && you.equipment[EQUIPMENT.BEACON] > 0 && !planet.beacon;

    return (
        <li className={`eod-map-planet eod-map-planet--${planet.status} ${here ? 'eod-map-planet--here' : ''} ${planet.owner ? `eod-map-planet--held-${planet.owner}` : ''}`}>
            {/* The planet itself is painted behind the card (SystemBackdrop); this is the ring round it that shows its state and holder. */}
            <span className="eod-map-globe" style={{ '--eod-planet-size': lookOf(planet.id).size }} aria-hidden="true" />
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
            {jump && (
                <button type="button" className="eod-button eod-button--primary eod-map-jump" disabled={Boolean(jump.block)} onClick={() => presenter.jumpTo(planet.id)}>
                    {jump.overdrive ? `${EQUIPMENT_ICONS[EQUIPMENT.OVERDRIVE]} ${t('mp.map.overdrive')}` : t('mp.map.jump')}
                    {jump.block && <small>{t(jump.block.key, jump.block.params)}</small>}
                    {/* Going on the chip before the drive has charged: say what it costs. */}
                    {!jump.block && jump.overdrive && you.jump.cooldown > 0 && <small>{t('mp.map.overdriveCharging', { seconds: you.jump.cooldown })}</small>}
                </button>
            )}
        </li>
    );
}

/** Position of an element's centre in the list's scrolled content (where the backdrop canvas sits). */
function centreIn(list, element) {
    const box = list.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2 - box.left - list.clientLeft + list.scrollLeft,
        y: rect.top + rect.height / 2 - box.top - list.clientTop + list.scrollTop,
        right: rect.right - box.left - list.clientLeft + list.scrollLeft,
    };
}

/**
 * Where the cards' planets are, in the list's own pixels: measured when the list is laid out
 * and again only when its size changes (a resized window, a card growing a line).
 */
function measureChart(list) {
    const globes = [...list.querySelectorAll('.eod-map-globe')];
    const cards = list.querySelectorAll('.eod-map-planet');
    const sun = list.querySelector('.eod-map-sun');
    if (globes.length === 0 || !sun) return null;
    const style = getComputedStyle(list);
    const centres = globes.map((globe) => centreIn(list, globe));
    const sunBox = centreIn(list, sun);
    // Never wider or taller than what the cards already scroll over: the canvas must not make the list scroll.
    const width = Math.max(list.clientWidth, centreIn(list, cards[cards.length - 1]).right + parseFloat(style.paddingRight));
    return {
        width: Math.floor(width),
        height: list.clientHeight,
        eclipticY: centres[0].y,
        // The sun's rim a little past the middle of its column: its glow reaches the first card.
        sunEdge: sunBox.x + (sunBox.right - sunBox.x) * 0.5,
        planetXs: centres.map((centre) => centre.x),
        planetMax: parseFloat(style.getPropertyValue('--eod-planet-max')) || 14,
        captionY: list.clientHeight - parseFloat(style.paddingBottom) * 0.32,
        font: style.fontFamily,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    };
}

/**
 * The system side on, behind the cards: one canvas the size of the list's scrolled content,
 * painted when the layout, the language or a swallowed planet changes - not every frame.
 */
function SystemBackdrop({ planets }) {
    const t = useT();
    const canvasRef = useRef(null);
    const [chart, setChart] = useState(null);
    const swallowed = planets.map((planet) => (planet.status === PLANET_STATUS.SWALLOWED ? 1 : 0)).join('');
    const ids = planets.map((planet) => planet.id).join();
    const sunLabel = t('mp.map.sun');
    const outerLabel = t('mp.map.outer');

    useLayoutEffect(() => {
        const list = canvasRef.current?.closest('.eod-map-orbits');
        if (!list) return undefined;
        const update = () => {
            const next = measureChart(list);
            setChart((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(list);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !chart) return;
        const { pixelRatio } = chart;
        canvas.width = Math.round(chart.width * pixelRatio);
        canvas.height = Math.round(chart.height * pixelRatio);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        ctx.clearRect(0, 0, chart.width, chart.height);
        paintSystemBackdrop(ctx, { x: 0, y: 0, ...chart }, { sun: sunLabel, outer: outerLabel }, { font: chart.font });
        ids.split(',').forEach((id, index) => {
            const x = chart.planetXs[index];
            if (x === undefined) return;
            const look = lookOf(id);
            paintPlanet(ctx, { x, y: chart.eclipticY, radius: look.size * chart.planetMax, look, swallowed: swallowed[index] === '1', gate: isGatePlanet(id) });
        });
    }, [chart, ids, swallowed, sunLabel, outerLabel]);

    return <canvas ref={canvasRef} className="eod-map-chart" style={chart ? { width: chart.width, height: chart.height } : { display: 'none' }} aria-hidden="true" />;
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
            <ol className="eod-map-orbits" aria-label={t('mp.map.order')}>
                <li className="eod-map-sun" aria-hidden="true"><SystemBackdrop planets={match.planets} /></li>
                {match.planets.map((planet) => <PlanetCard key={planet.id} planet={planet} you={match.you} presenter={presenter} />)}
            </ol>
            <div className="eod-menu">
                <button type="button" className="eod-button" onClick={() => presenter.setPanel(null)}>{t('mp.map.close')}</button>
            </div>
        </div>
    );
}
