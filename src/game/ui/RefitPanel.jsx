import { useState } from 'react';
import { RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { UPGRADE_PER_LEVEL } from '../config/refit.js';
import { mergeUpgrades, upgradedRatings } from '../core/refit.js';
import { useGameStore, useT } from '../state/gameStore.js';

/**
 * "Ship maintenance and refit": shown while the ship is docked at Lantern Station
 * (GameSession.openRefit). The player spends the points offered, one rating level each, never
 * past 10; confirming installs them (GameSession.applyRefit) and the story carries on.
 *
 * A multiplayer match opens the same window in flight (`refit.inFlight`) for the points a
 * captured planet pays: there it can be closed again, and points can be kept for later.
 */

/** Pips for one rating: what the ship already had, what this refit adds, and what is left. */
function RefitPips({ owned, added }) {
    return (
        <div className="eod-rating-pips eod-refit-pips">
            {Array.from({ length: RATING_MAX }, (_, index) => {
                const kind = index < owned ? 'eod-rating-pip--on' : index < owned + added ? 'eod-refit-pip--new' : '';
                return <i key={index} className={`eod-rating-pip ${kind}`} />;
            })}
        </div>
    );
}

export default function RefitPanel({ session }) {
    const refit = useGameStore((state) => state.refit);
    const t = useT();
    const [added, setAdded] = useState({});
    if (!refit) return null;

    const { points, classId, upgrades, inFlight = false } = refit;
    const owned = upgradedRatings(classId, upgrades) ?? {};
    const spent = Object.values(added).reduce((sum, levels) => sum + levels, 0);
    const left = points - spent;
    const withAdded = upgradedRatings(classId, mergeUpgrades(classId, upgrades, added)) ?? {};
    const canAdd = (rating) => left > 0 && withAdded[rating] < RATING_MAX;
    // Points that cannot go anywhere (everything at 10) do not hold up the refit.
    const done = left === 0 || !RATING_ORDER.some(canAdd);

    const change = (rating, step) => setAdded((current) => ({ ...current, [rating]: Math.max(0, (current[rating] ?? 0) + step) }));
    const confirm = () => {
        session.applyRefit(added);
        setAdded({});
    };

    return (
        <div className="eod-screen eod-screen--overlay eod-refit">
            <h2 className="eod-screen-heading eod-refit-title">{t('ui.refit.title')}</h2>
            <p className="eod-screen-text">{t('ui.refit.text', { ship: t(`ship.${classId}`) })}</p>
            <p className="eod-refit-points">{t('ui.refit.points', { points: left })}</p>
            <div className="eod-refit-rows">
                {RATING_ORDER.map((rating) => (
                    <div key={rating} className="eod-refit-row">
                        <div className="eod-refit-label">
                            <strong>{t(`ui.rating.${rating}`)}</strong>
                            <small>{t(`ui.refit.effect.${rating}`, { percent: Math.round(UPGRADE_PER_LEVEL[rating] * 100) })}</small>
                        </div>
                        <RefitPips owned={owned[rating] ?? 0} added={withAdded[rating] - (owned[rating] ?? 0)} />
                        <span className="eod-refit-level">{withAdded[rating] >= RATING_MAX ? t('ui.refit.max') : withAdded[rating]}</span>
                        <button type="button" className="eod-refit-step" disabled={!added[rating]} onClick={() => change(rating, -1)}>−</button>
                        <button type="button" className="eod-refit-step" disabled={!canAdd(rating)} onClick={() => change(rating, 1)}>+</button>
                    </div>
                ))}
            </div>
            <div className="eod-menu">
                <button type="button" className="eod-button eod-button--primary" disabled={inFlight ? spent === 0 : !done} onClick={confirm}>
                    {t('ui.refit.confirm')}
                    <small>{t(inFlight ? 'mp.refit.note' : 'ui.refit.repairNote')}</small>
                </button>
                {inFlight && <button type="button" className="eod-button" onClick={() => { session.applyRefit({}); setAdded({}); }}>{t('mp.refit.close')}</button>}
            </div>
        </div>
    );
}
