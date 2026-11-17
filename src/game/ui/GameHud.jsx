import { useEffect, useRef, useState } from 'react';
import { GAME_EVENTS } from '../core/EventBus.js';
import { hasTranslation } from '../i18n/index.js';
import { isTouchDevice } from '../input/device.js';
import { PHASE, SESSION_EVENTS } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';
import { abilityStateText } from './abilityText.js';
import CommsPanel from './CommsPanel.jsx';
import MatchHud from './multiplayer/MatchHud.jsx';

/** Decided once: a device does not grow a mouse halfway through a mission. */
const IS_TOUCH = isTouchDevice();

/**
 * The in-flight HUD. Each panel subscribes to one slice of the game store (refreshed about
 * ten times a second by GameSession.publishHud). Fast-moving elements - reticle, target
 * brackets, radar - are drawn on canvases by scene/HudCanvasBridge.jsx instead.
 */

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
            <div className="eod-torpedo-tubes">
                {Array.from({ length: hud.torpedoCapacity }, (_, index) => (
                    <span key={index} className={`eod-torpedo ${index < hud.torpedoes ? 'eod-torpedo--loaded' : ''}`} />
                ))}
            </div>
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
                <div className="eod-torpedo-tubes">
                    {Array.from({ length: hud.torpedoCapacity }, (_, index) => (
                        <span key={index} className={`eod-torpedo ${index < hud.torpedoes ? 'eod-torpedo--loaded' : ''}`} />
                    ))}
                </div>
            </div>
            <div className="eod-speed">
                <span className="eod-meter-label">{t('hud.speed')}</span>
                <span className="eod-speed-value">{hud.speed}</span>
                <span className="eod-speed-unit">m/s</span>
                <span className="eod-meter-label">{t('hud.throttle')} {percent(hud.throttle)}</span>
            </div>
            {hud.ability && <AbilityRow ability={hud.ability} />}
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
                    <Meter label={t('hud.hull')} value={target.hull} tone={target.invulnerable ? 'locked' : 'hostile'} />
                    <span className="eod-target-distance">{target.distance} m</span>
                </>
            ) : <span className="eod-target-name eod-target-name--none">{t('hud.noTarget')}</span>}
        </div>
    );
}

function ObjectivePanel() {
    const objective = useGameStore((state) => state.objective);
    const progress = useGameStore((state) => state.progress);
    const t = useT();
    if (!objective && !progress) return null;
    return (
        <div className="eod-panel eod-objective">
            {objective && (
                <>
                    <span className="eod-meter-label">{t('hud.objective')}</span>
                    <p className="eod-objective-text">{t(objective.key, objective.params ?? undefined)}</p>
                </>
            )}
            {progress && <Meter label={t(progress.labelKey)} value={progress.value} tone="energy" />}
        </div>
    );
}

/** Top-centre bars for the ship being protected and the current boss. */
function FleetBars() {
    const escort = useGameStore((state) => state.escort);
    const boss = useGameStore((state) => state.boss);
    const t = useT();
    if (!escort && !boss) return null;
    return (
        <div className="eod-fleet-bars">
            {boss && (
                <div className="eod-fleet-bar eod-fleet-bar--boss">
                    <span className="eod-fleet-name">{shipTitle(t, boss)}</span>
                    {boss.hasShield && <Meter label={t('hud.shields')} value={boss.shield} tone="shield" />}
                    <Meter label={t('hud.hull')} value={boss.hull} tone={boss.invulnerable ? 'locked' : 'hostile'} />
                </div>
            )}
            {escort && (
                <div className="eod-fleet-bar eod-fleet-bar--escort">
                    <span className="eod-fleet-name">{shipTitle(t, escort)}</span>
                    {escort.hasShield && <Meter label={t('hud.shields')} value={escort.shield} tone="shield" />}
                    <Meter label={t('hud.hull')} value={escort.hull} tone="hull" warning={escort.hull < 0.3} />
                </div>
            )}
        </div>
    );
}

function Alerts() {
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
        <div className="eod-alerts">
            {/* A breach blast has the shield down: how long until it can come back. */}
            {hud.shieldDown > 0 && <span className="eod-alert">{t('hud.shieldsBreached', { seconds: hud.shieldDown })}</span>}
            {alerts.map((key) => <span key={key} className="eod-alert">{t(key)}</span>)}
            {hud.cloaked && <span className="eod-alert eod-alert--cloak">{t('hud.cloaked')}</span>}
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

function HintBar() {
    const hint = useGameStore((state) => state.hint);
    const t = useT();
    if (!hint || (IS_TOUCH && TOUCH_HIDDEN_HINTS.has(hint))) return null;
    // Hints that name keys have a `.touch` twin describing the on-screen controls instead.
    const touchHint = `${hint}.touch`;
    return <div className="eod-hint">{t(IS_TOUCH && hasTranslation(touchHint) ? touchHint : hint)}</div>;
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

export default function GameHud({ session, markerCanvasRef, radarCanvasRef }) {
    const phase = useGameStore((state) => state.phase);
    // A match's introduction and ending have the screen to themselves.
    const ceremony = useGameStore((state) => Boolean(state.matchOutro) || state.match?.intro != null);
    const inFlight = (phase === PHASE.PLAYING || phase === PHASE.PAUSED) && !ceremony;
    const flash = useDamageFlash(session);

    return (
        // A hit on the bare hull (shield down) knocks the instruments: their panels jump and smear (hud.css).
        <div className="eod-hud" data-phase={phase} data-scrambled={flash?.kind === 'hull' ? '' : undefined}>
            <canvas ref={markerCanvasRef} className="eod-marker-canvas" />
            <DamageFlash flash={flash} />
            <WarpFlash session={session} />
            <ScreenFade session={session} />
            {inFlight && IS_TOUCH && (
                <>
                    <CompactShipPanel />
                    <ObjectivePanel />
                    {/* Boss / escort bars and the hint share the top centre, stacked. */}
                    <div className="eod-top-stack">
                        <FleetBars />
                        <HintBar />
                    </div>
                    <TargetPanel />
                    <canvas ref={radarCanvasRef} className="eod-radar eod-radar--corner" />
                    <MatchHud session={session} />
                    <Alerts />
                    <TitleCard />
                    <Toast />
                    <ScoreFeed session={session} />
                    <div className="eod-centre-stack">
                        <CommsPanel session={session} />
                    </div>
                </>
            )}
            {inFlight && !IS_TOUCH && (
                <>
                    <ObjectivePanel />
                    <FleetBars />
                    <TargetPanel />
                    <StatusPanel />
                    <WeaponsPanel />
                    <MatchHud session={session} />
                    <Alerts />
                    <HintBar />
                    <TitleCard />
                    <Toast />
                    <ScoreFeed session={session} />
                    <div className="eod-centre-stack">
                        <CommsPanel session={session} />
                        <canvas ref={radarCanvasRef} className="eod-radar" />
                    </div>
                </>
            )}
        </div>
    );
}
