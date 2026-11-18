import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GAME_EVENTS } from '../core/EventBus.js';
import { hasTranslation } from '../i18n/index.js';
import { isTouchDevice, watchTouchDevice } from '../input/device.js';
import { PHASE, SESSION_EVENTS } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';
import { abilityStateText } from './abilityText.js';
import CommsPanel from './CommsPanel.jsx';
import { DockPrompt, MatchAlerts, MatchButtons, MatchStatus, RespawnPrompt } from './multiplayer/MatchHud.jsx';

/**
 * The in-flight HUD. Each panel subscribes to one slice of the game store (refreshed about
 * ten times a second by GameSession.publishHud). Fast-moving elements - reticle, target
 * brackets, radar - are drawn on canvases by scene/HudCanvasBridge.jsx instead.
 *
 * Panels are not placed one by one. Each goes into one of a few docks - a column top left,
 * one top centre, one top right, a stack at the bottom centre - and a dock stacks what is in
 * it, so panels that come up together (the objective and the match status, a hint and the
 * choice of where to come back, a dock prompt and the comms line) push each other along instead of covering each
 * other. The docks are sized in hud.css to keep clear of one another, of the corners (the
 * gauges on a desktop; the stick and the buttons on a touch screen) and of the reticle.
 */

/**
 * Whether to lay the HUD out for fingers. Followed live, not decided once: a browser's phone
 * emulation switched off, or a trackpad keyboard put on a tablet, changes it mid-flight - and
 * the panels must then change with the stylesheet (which follows the same media query),
 * or phone panels end up placed by desktop rules, all piled in a corner.
 */
function useTouchLayout() {
    return useSyncExternalStore(watchTouchDevice, isTouchDevice, () => false);
}

const percent = (fraction) => `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;

function Meter({ label, value, tone, warning = false, live = false }) {
    return (
        <div className={`eod-meter eod-meter--${tone} ${warning ? 'eod-meter--warning' : ''} ${live ? 'eod-meter--live' : ''}`}>
            <span className="eod-meter-label">{label}</span>
            <div className="eod-meter-track"><div className="eod-meter-fill" style={{ width: percent(value) }} /></div>
            <span className="eod-meter-value">{percent(value)}</span>
        </div>
    );
}

function shipTitle(t, ship) {
    return ship.callsign ?? t(ship.nameKey);
}

/** One pip per torpedo tube, lit while the tube is loaded. */
function TorpedoTubes({ loaded, capacity }) {
    return (
        <div className="eod-torpedo-tubes">
            {Array.from({ length: capacity }, (_, index) => (
                <span key={index} className={`eod-torpedo ${index < loaded ? 'eod-torpedo--loaded' : ''}`} />
            ))}
        </div>
    );
}

/** How a hostile ship's hull bar is coloured: purple while nothing can hurt it yet. */
const hostileHullTone = (ship) => (ship.invulnerable ? 'locked' : 'hostile');

function StatusPanel() {
    const hud = useGameStore((state) => state.hud);
    const t = useT();
    if (!hud) return null;
    return (
        <div className="eod-panel eod-status">
            <Meter label={t('hud.shields')} value={hud.shield} tone="shield" warning={hud.shield <= 0.01} />
            <Meter label={t('hud.hull')} value={hud.hull} tone="hull" warning={hud.hull < 0.3} />
            <div className="eod-power">
                <span className="eod-meter-label">{t('hud.power')}</span>
                {['balanced', 'attack', 'defense'].map((mode, index) => (
                    <span key={mode} className={`eod-power-mode ${hud.powerMode === mode ? 'eod-power-mode--active' : ''}`}>
                        <kbd>{index + 1}</kbd>{t(`hud.power.${mode}`)}
                    </span>
                ))}
            </div>
        </div>
    );
}

/**
 * Phones: one small panel in place of the two corner gauges (the thumbs own the lower corners,
 * and the power mode is not offered on touch screens). The throttle row is the only place the
 * throttle shows: while a finger is sliding to set it (input/throttleSwipe.js) the row lights
 * up and shows what the finger asks for, otherwise what the ship has.
 */
function CompactShipPanel() {
    const hud = useGameStore((state) => state.hud);
    const throttleSwipe = useGameStore((state) => state.throttleSwipe);
    const t = useT();
    if (!hud) return null;
    return (
        <div className="eod-panel eod-ship-compact">
            <Meter label={t('hud.shields')} value={hud.shield} tone="shield" warning={hud.shield <= 0.01} />
            <Meter label={t('hud.hull')} value={hud.hull} tone="hull" warning={hud.hull < 0.3} />
            <Meter label={t('hud.energy')} value={hud.energy} tone="energy" warning={hud.beamDepleted} />
            <Meter label={t('hud.throttle')} value={throttleSwipe ?? hud.throttle} tone="throttle" live={throttleSwipe !== null} />
            <TorpedoTubes loaded={hud.torpedoes} capacity={hud.torpedoCapacity} />
        </div>
    );
}

/** The ship's active ability (config/abilities.js): its name, its key, and a bar that empties while it runs and refills as it recharges. */
function AbilityRow({ ability }) {
    const t = useT();
    return (
        <div className={`eod-ability eod-ability--${ability.state}`}>
            <span className="eod-meter-label"><kbd>Q</kbd>{t(`ability.${ability.id}.name`)}</span>
            <div className="eod-meter-track"><div className="eod-meter-fill" style={{ width: percent(ability.charge) }} /></div>
            <span className="eod-ability-state">{abilityStateText(t, ability)}</span>
        </div>
    );
}

/** The ship's passive ability: only its name - there is nothing to press and nothing to wait for. */
function PassiveRow({ id }) {
    const t = useT();
    return (
        <div className="eod-ability eod-ability--passive">
            <span className="eod-meter-label">{t(`ability.${id}.name`)}</span>
            <span className="eod-ability-state">{t('hud.ability.passive')}</span>
        </div>
    );
}

function WeaponsPanel() {
    const hud = useGameStore((state) => state.hud);
    const t = useT();
    if (!hud) return null;
    return (
        <div className="eod-panel eod-weapons">
            <Meter label={t('hud.energy')} value={hud.energy} tone="energy" warning={hud.beamDepleted} />
            <Meter label={t('hud.boost')} value={hud.boost} tone="boost" />
            <div className="eod-torpedoes">
                <span className="eod-meter-label">{t('hud.torpedoes')}</span>
                <TorpedoTubes loaded={hud.torpedoes} capacity={hud.torpedoCapacity} />
            </div>
            <div className="eod-speed">
                <span className="eod-meter-label">{t('hud.speed')}</span>
                <span className="eod-speed-value">{hud.speed}</span>
                <span className="eod-speed-unit">m/s</span>
                <span className="eod-meter-label">{t('hud.throttle')} {percent(hud.throttle)}</span>
            </div>
            {hud.ability && <AbilityRow ability={hud.ability} />}
            {hud.passive && <PassiveRow id={hud.passive} />}
        </div>
    );
}

function TargetPanel() {
    const target = useGameStore((state) => state.target);
    const t = useT();
    return (
        <div className={`eod-panel eod-target eod-target--${target?.faction ?? 'none'}`}>
            <span className="eod-meter-label">{t('hud.target')}</span>
            {target ? (
                <>
                    <span className="eod-target-name">{shipTitle(t, target)}</span>
                    {target.hasShield && <Meter label={t('hud.shields')} value={target.shield} tone="shield" />}
                    <Meter label={t('hud.hull')} value={target.hull} tone={hostileHullTone(target)} />
                    <span className="eod-target-distance">{target.distance} m</span>
                </>
            ) : <span className="eod-target-name eod-target-name--none">{t('hud.noTarget')}</span>}
        </div>
    );
}

/** The label is inside the text so that on a phone it can run on the text's first line (hud.css). */
function ObjectivePanel() {
    const objective = useGameStore((state) => state.objective);
    const progress = useGameStore((state) => state.progress);
    const t = useT();
    if (!objective && !progress) return null;
    return (
        <div className="eod-panel eod-objective">
            {objective && (
                <p className="eod-objective-text">
                    <span className="eod-meter-label eod-objective-label">{t('hud.objective')}</span>
                    {t(objective.key, objective.params ?? undefined)}
                </p>
            )}
            {progress && <Meter label={t(progress.labelKey)} value={progress.value} tone="energy" />}
        </div>
    );
}

/** One named ship's bars at the top centre: `role` 'boss' (an enemy to bring down) or 'escort' (a ship to keep alive). */
function FleetBar({ ship, role }) {
    const t = useT();
    const boss = role === 'boss';
    return (
        <div className={`eod-fleet-bar eod-fleet-bar--${role}`}>
            <span className="eod-fleet-name">{shipTitle(t, ship)}</span>
            {ship.hasShield && <Meter label={t('hud.shields')} value={ship.shield} tone="shield" />}
            <Meter label={t('hud.hull')} value={ship.hull} tone={boss ? hostileHullTone(ship) : 'hull'} warning={!boss && ship.hull < 0.3} />
        </div>
    );
}

/** Bars for the ship being protected and the current boss (top centre). */
function FleetBars() {
    const escort = useGameStore((state) => state.escort);
    const boss = useGameStore((state) => state.boss);
    if (!escort && !boss) return null;
    return (
        <div className="eod-fleet-bars">
            {boss && <FleetBar ship={boss} role="boss" />}
            {escort && <FleetBar ship={escort} role="escort" />}
        </div>
    );
}

/** Warnings about the pilot's own ship: lines for the alert stack. */
function ShipAlerts() {
    const hud = useGameStore((state) => state.hud);
    const escort = useGameStore((state) => state.escort);
    const t = useT();
    if (!hud?.alive) return null;
    const alerts = [];
    if (hud.outOfBounds) alerts.push('hud.outOfBounds');
    if (hud.cannonLock === 2) alerts.push('hud.cannonLocked');
    else if (hud.cannonLock === 1) alerts.push('hud.cannonTracking');
    if (escort && escort.hull < 0.3) alerts.push('hud.escortCritical');
    if (hud.hull < 0.3) alerts.push('hud.hullCritical');
    else if (hud.shield <= 0.01 && hud.shieldDown <= 0) alerts.push('hud.shieldsDown');
    if (alerts.length === 0 && hud.shieldDown <= 0 && !hud.cloaked) return null;
    return (
        <>
            {/* A breach blast has the shield down: how long until it can come back. */}
            {hud.shieldDown > 0 && <span className="eod-alert">{t('hud.shieldsBreached', { seconds: hud.shieldDown })}</span>}
            {alerts.map((key) => <span key={key} className="eod-alert">{t(key)}</span>)}
            {hud.cloaked && <span className="eod-alert eod-alert--cloak">{t('hud.cloaked')}</span>}
        </>
    );
}

/**
 * Every warning in one stack - the ship's own and the match's (MatchHud.jsx) - at the foot of
 * the top-centre dock: a third of the way down the screen, or lower if what is above it needs
 * the room (hud.css).
 */
function AlertStack() {
    return (
        <div className="eod-alerts">
            <ShipAlerts />
            <MatchAlerts />
        </div>
    );
}

function TitleCard() {
    const titleCard = useGameStore((state) => state.titleCard);
    const t = useT();
    if (!titleCard) return null;
    return (
        <div className="eod-title-card" key={titleCard.chapterId}>
            <h2>{t(`chapter.${titleCard.chapterId}.title`)}</h2>
            <p>{t(`chapter.${titleCard.chapterId}.subtitle`)}</p>
        </div>
    );
}

/** Hints about controls phones do not have. */
const TOUCH_HIDDEN_HINTS = new Set(['hint.power']);

function HintBar({ touch }) {
    const hint = useGameStore((state) => state.hint);
    const t = useT();
    if (!hint || (touch && TOUCH_HIDDEN_HINTS.has(hint))) return null;
    // Hints that name keys have a `.touch` twin describing the on-screen controls instead.
    const touchHint = `${hint}.touch`;
    return <div className="eod-hint">{t(touch && hasTranslation(touchHint) ? touchHint : hint)}</div>;
}

function Toast() {
    const toast = useGameStore((state) => state.toast);
    const t = useT();
    if (!toast) return null;
    return (
        <div className="eod-toast">
            <strong>{t(toast.key, toast.params ?? undefined)}</strong>
            {toast.checkpointId && <span>{t(`checkpoint.${toast.checkpointId}`)}</span>}
        </div>
    );
}

/**
 * The latest hit on the player's ship, for a moment after it lands: { kind: 'shield' | 'hull', id },
 * else null.
 */
function useDamageFlash(session) {
    const [flash, setFlash] = useState(null);

    useEffect(() => {
        let timer = null;
        const off = session.world.events.on(GAME_EVENTS.HIT, ({ target, shield, amount }) => {
            if (!target || target !== session.world.player || amount <= 0) return;
            setFlash({ kind: shield ? 'shield' : 'hull', id: Date.now() });
            clearTimeout(timer);
            timer = setTimeout(() => setFlash(null), 320);
        });
        return () => {
            off();
            clearTimeout(timer);
        };
    }, [session]);
    return flash;
}

/** Screen-edge flash when the player's ship is hit: blue for shields, red for hull. */
function DamageFlash({ flash }) {
    if (!flash) return null;
    return <div key={flash.id} className={`eod-damage-flash eod-damage-flash--${flash.kind}`} />;
}

/** How long a "+points" line stays up before it has faded away (keep in step with hud.css). */
const SCORE_POPUP_MS = 3800;
const MAX_SCORE_POPUPS = 5;

/**
 * "+150 Raider" for each kill the player scores, stacked under the reticle with the running
 * total. Each line holds for three seconds, then fades out (the `eod-score-pop` animation).
 */
function ScoreFeed({ session }) {
    const [popups, setPopups] = useState([]);
    const [total, setTotal] = useState(null);
    const t = useT();

    useEffect(() => {
        let nextId = 0;
        const timers = new Set();
        const off = session.events.on(SESSION_EVENTS.SCORE, ({ points, classId, total: newTotal }) => {
            const id = nextId++;
            setPopups((list) => [...list, { id, points, classId }].slice(-MAX_SCORE_POPUPS));
            setTotal({ value: newTotal, id });
            const timer = setTimeout(() => {
                timers.delete(timer);
                setPopups((list) => list.filter((popup) => popup.id !== id));
                setTotal((current) => (current?.id === id ? null : current));
            }, SCORE_POPUP_MS);
            timers.add(timer);
        });
        return () => {
            off();
            for (const timer of timers) clearTimeout(timer);
        };
    }, [session]);

    if (popups.length === 0) return null;
    return (
        <div className="eod-score-feed">
            {total && <span key={total.id} className="eod-score-total">{t('hud.score')} {total.value.toLocaleString()}</span>}
            {popups.map(({ id, points, classId }) => (
                <div key={id} className="eod-score-pop">
                    <strong>+{points}</strong>
                    <span>{t(`ship.${classId}`)}</span>
                </div>
            ))}
        </div>
    );
}

/** White-out at the moment of a warp jump. */
function WarpFlash({ session }) {
    const [flashId, setFlashId] = useState(null);

    useEffect(() => {
        let timer = null;
        const off = session.events.on(SESSION_EVENTS.WARP, ({ stage }) => {
            if (stage !== 'arrive') return;
            setFlashId(Date.now());
            clearTimeout(timer);
            timer = setTimeout(() => setFlashId(null), 1400);
        });
        return () => {
            off();
            clearTimeout(timer);
        };
    }, [session]);

    if (flashId === null) return null;
    return <div key={flashId} className="eod-warp-flash" />;
}

/**
 * Black-out for docking cut-scenes: follows `world.screenFade` (set by the story's fade beat)
 * every animation frame, so it is smooth however often the rest of the HUD refreshes.
 */
function ScreenFade({ session }) {
    const ref = useRef(null);

    useEffect(() => {
        let frame = 0;
        const update = () => {
            if (ref.current) ref.current.style.opacity = String(session.world.screenFade ?? 0);
            frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
        return () => cancelAnimationFrame(frame);
    }, [session]);

    return <div ref={ref} className="eod-screen-fade" style={{ opacity: 0 }} />;
}

/**
 * Phones and tablets: a pared-down HUD. The lower corners belong to the thumbs (stick, buttons:
 * ui/TouchControls.jsx), so what is there to be read hugs the top edge, small, and what is
 * there to be pressed - the match's comeback, dock and buttons - sits between the thumbs with the
 * comms line, leaving the middle of the screen to the fight.
 */
function TouchHud({ session, radarCanvasRef }) {
    return (
        <>
            {/* Right of the pause button: the ship, the objective under it - ending above the stick. */}
            <div className="eod-dock eod-dock--left">
                <CompactShipPanel />
                <ObjectivePanel />
            </div>
            <div className="eod-dock eod-dock--centre">
                <FleetBars />
                <MatchStatus session={session} buttons={false} />
                <HintBar touch />
                <AlertStack />
            </div>
            {/* The radar beside the target, not under it: under it, it would come down to the buttons on a short screen. */}
            <div className="eod-dock eod-dock--right">
                <div className="eod-dock-row">
                    <canvas ref={radarCanvasRef} className="eod-radar" />
                    <TargetPanel />
                </div>
                <Toast />
            </div>
            <TitleCard />
            <ScoreFeed session={session} />
            <div className="eod-centre-stack">
                <RespawnPrompt session={session} />
                <DockPrompt session={session} />
                <CommsPanel session={session} />
                <MatchButtons session={session} />
            </div>
        </>
    );
}

/** Mouse and keyboard: the full HUD, with a gauge panel in each lower corner. */
function DesktopHud({ session, radarCanvasRef }) {
    return (
        <>
            <div className="eod-dock eod-dock--left">
                <ObjectivePanel />
                <MatchStatus session={session} />
            </div>
            <div className="eod-dock eod-dock--centre">
                <FleetBars />
                <HintBar touch={false} />
                <RespawnPrompt session={session} />
                <AlertStack />
            </div>
            <div className="eod-dock eod-dock--right">
                <TargetPanel />
                <Toast />
            </div>
            <StatusPanel />
            <WeaponsPanel />
            <TitleCard />
            <ScoreFeed session={session} />
            <div className="eod-centre-stack">
                <DockPrompt session={session} />
                <CommsPanel session={session} />
                <canvas ref={radarCanvasRef} className="eod-radar" />
            </div>
        </>
    );
}

export default function GameHud({ session, markerCanvasRef, radarCanvasRef }) {
    const phase = useGameStore((state) => state.phase);
    // A match's introduction and ending have the screen to themselves.
    const ceremony = useGameStore((state) => Boolean(state.matchOutro) || state.match?.intro != null);
    const inFlight = (phase === PHASE.PLAYING || phase === PHASE.PAUSED) && !ceremony;
    const flash = useDamageFlash(session);
    const touch = useTouchLayout();

    return (
        // A hit on the bare hull (shield down) knocks the instruments: their panels jump and smear (hud.css).
        <div className={`eod-hud ${touch ? 'eod-hud--touch' : 'eod-hud--desktop'}`} data-phase={phase} data-scrambled={flash?.kind === 'hull' ? '' : undefined}>
            <canvas ref={markerCanvasRef} className="eod-marker-canvas" />
            <DamageFlash flash={flash} />
            <WarpFlash session={session} />
            <ScreenFade session={session} />
            {inFlight && touch && <TouchHud session={session} radarCanvasRef={radarCanvasRef} />}
            {inFlight && !touch && <DesktopHud session={session} radarCanvasRef={radarCanvasRef} />}
        </div>
    );
}
