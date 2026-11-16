import { BATTLE_ROYALE } from '../../config/battleRoyale.js';
import { EQUIPMENT, EQUIPMENT_ORDER } from '../../modes/battleRoyale/equipment.js';
import { useGameStore, useT } from '../../state/gameStore.js';

/**
 * The quartermaster's stores (battle royale): the four pieces of single-use equipment, what
 * the pilot carries, and - while they have a choice to spend - a button to take each.
 * Opened with I or the HUD's button; the same list is shown in the lobby for the piece a
 * pilot takes into the match (EquipmentList).
 */

export const EQUIPMENT_ICONS = Object.freeze({
    [EQUIPMENT.BEACON]: '🛰️',
    [EQUIPMENT.GRAVITY_SHIELD]: '🌀',
    [EQUIPMENT.EMERGENCY_SHIELD]: '🛡️',
    [EQUIPMENT.OVERDRIVE]: '⚡',
});

/** The numbers each piece's description quotes. */
const TEXT_PARAMS = Object.freeze({
    [EQUIPMENT.GRAVITY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.gravityShieldSeconds },
    [EQUIPMENT.EMERGENCY_SHIELD]: { seconds: BATTLE_ROYALE.equipment.emergencyShieldSeconds },
});

/**
 * The four pieces as cards.
 * @param {object} props
 * @param {(item: string) => import('react').ReactNode} props.action what goes under each card's text (a button, a count...)
 * @param {string | null} [props.selected] the piece to show as chosen
 */
export function EquipmentList({ action, selected = null }) {
    const t = useT();
    return (
        <ul className="eod-gear-list">
            {EQUIPMENT_ORDER.map((item) => (
                <li key={item} className={`eod-gear-card ${selected === item ? 'eod-gear-card--chosen' : ''}`}>
                    <span className="eod-gear-icon" aria-hidden="true">{EQUIPMENT_ICONS[item]}</span>
                    <strong>{t(`mp.equipment.${item}.name`)}</strong>
                    <p>{t(`mp.equipment.${item}.text`, TEXT_PARAMS[item])}</p>
                    {action(item)}
                </li>
            ))}
        </ul>
    );
}

/**
 * @param {object} props
 * @param {import('../../state/GameSession.js').GameSession} props.session
 */
export default function EquipmentPanel({ session }) {
    const you = useGameStore((state) => state.match?.you);
    const t = useT();
    const presenter = session.match?.presenter;
    if (!you || !presenter) return null;

    return (
        <div className="eod-screen eod-screen--overlay eod-gear">
            <h2 className="eod-screen-heading eod-refit-title">{t('mp.equipment.title')}</h2>
            <p className="eod-screen-text">{t('mp.equipment.hint')}</p>
            <p className={`eod-gear-picks ${you.picks > 0 ? 'eod-gear-picks--some' : ''}`}>
                {you.picks > 0 ? t('mp.equipment.picks', { count: you.picks }) : t('mp.equipment.noPicks')}
            </p>
            <EquipmentList
                action={(item) => (
                    <>
                        <small>{t('mp.equipment.carried', { count: you.equipment[item] })}</small>
                        <button
                            type="button"
                            className="eod-button eod-button--primary"
                            disabled={you.picks === 0 || you.equipment[item] >= BATTLE_ROYALE.equipment.stack}
                            onClick={() => presenter.pickEquipment(item)}
                        >
                            {t('mp.equipment.take')}
                        </button>
                    </>
                )}
            />
            <div className="eod-menu">
                <button type="button" className="eod-button" onClick={() => presenter.setPanel(null)}>{t('mp.map.close')}</button>
            </div>
        </div>
    );
}
