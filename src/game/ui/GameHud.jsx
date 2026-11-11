import { useEffect, useState } from 'react';
import { GAME_EVENTS } from '../core/EventBus.js';
import { PHASE, SESSION_EVENTS } from '../state/GameSession.js';
import { useGameStore, useT } from '../state/gameStore.js';
import CommsPanel from './CommsPanel.jsx';

/**
 * The in-flight HUD. Each panel subscribes to one slice of the game store (refreshed about
 * ten times a second by GameSession.publishHud). Fast-moving elements - reticle, target
 * brackets, radar - are drawn on canvases by scene/HudCanvasBridge.jsx instead.
 */

const percent = (fraction) => `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;

function Meter({ label, value, tone, warning = false }) {
    return (
        <div className={`eod-meter eod-meter--${tone} ${warning ? 'eod-meter--warning' : ''}`}>
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
    if (escort && escort.hull < 0.3) alerts.push('hud.escortCritical');
    if (hud.hull < 0.3) alerts.push('hud.hullCritical');
    else if (hud.shield <= 0.01) alerts.push('hud.shieldsDown');
    if (alerts.length === 0) return null;
    return (
        <div className="eod-alerts">
            {alerts.map((key) => <span key={key} className="eod-alert">{t(key)}</span>)}
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

function HintBar() {
    const hint = useGameStore((state) => state.hint);
    const t = useT();
    if (!hint) return null;
    return <div className="eod-hint">{t(hint)}</div>;
}

function Toast() {
    const toast = useGameStore((state) => state.toast);
    const t = useT();
    if (!toast) return null;
    return (
        <div className="eod-toast">
            <strong>{t(toast.key)}</strong>
            {toast.checkpointId && <span>{t(`checkpoint.${toast.checkpointId}`)}</span>}
        </div>
    );
}

/** Screen-edge flash when the player's ship is hit: blue for shields, red for hull. */
function DamageFlash({ session }) {
    const [flash, setFlash] = useState(null);

    useEffect(() => {
        let timer = null;
        const off = session.world.events.on(GAME_EVENTS.HIT, ({ target, shield, amount }) => {
            if (!target?.isPlayer || amount <= 0) return;
            setFlash({ kind: shield ? 'shield' : 'hull', id: Date.now() });
            clearTimeout(timer);
            timer = setTimeout(() => setFlash(null), 320);
        });
        return () => {
            off();
            clearTimeout(timer);
        };
    }, [session]);

    if (!flash) return null;
    return <div key={flash.id} className={`eod-damage-flash eod-damage-flash--${flash.kind}`} />;
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

export default function GameHud({ session, markerCanvasRef, radarCanvasRef }) {
    const phase = useGameStore((state) => state.phase);
    const inFlight = phase === PHASE.PLAYING || phase === PHASE.PAUSED;

    return (
        <div className="eod-hud" data-phase={phase}>
            <canvas ref={markerCanvasRef} className="eod-marker-canvas" />
            <DamageFlash session={session} />
            <WarpFlash session={session} />
            {inFlight && (
                <>
                    <ObjectivePanel />
                    <FleetBars />
                    <TargetPanel />
                    <StatusPanel />
                    <WeaponsPanel />
                    <Alerts />
                    <HintBar />
                    <TitleCard />
                    <Toast />
                    <div className="eod-centre-stack">
                        <CommsPanel />
                        <canvas ref={radarCanvasRef} className="eod-radar" />
                    </div>
                </>
            )}
        </div>
    );
}
