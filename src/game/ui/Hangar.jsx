import { useEffect } from 'react';
import { PLAYER_SHIPS, RATING_MAX, RATING_ORDER } from '../config/playerShips.js';
import { useGameStore, useT } from '../state/gameStore.js';
import { HANGAR_VIEWS, hangarImage, preloadHangarImages } from './hangarImages.js';
import { shipAbilityText, shipSpecRows } from './shipText.js';

/**
 * The hangar: the page a ship is chosen on. The title screen opens it before a new game, and
 * the multiplayer lobby before or inside a room (ui/multiplayer/LanLobby.jsx); both show the
 * same thing - the chosen ship from three sides and in numbers, and a card for every ship
 * with what it is, what its ability does and its rating bars. On a phone the cards are only a
 * picture and a name, and the chosen ship is written out beside its pictures.
 */

/** One row of a ship card: a label and a bar of 1-10 pips. */
function Rating({ label, value }) {
    return (
        <div className="eod-rating">
            <span>{label}</span>
            <div className="eod-rating-pips">
                {Array.from({ length: RATING_MAX }, (_, index) => (
                    <i key={index} className={index < value ? 'eod-rating-pip eod-rating-pip--on' : 'eod-rating-pip'} />
                ))}
            </div>
        </div>
    );
}

/** A ship's ability (config/abilities.js): its name and what it does. A ship has an active one or a passive one. */
function ShipAbility({ classId }) {
    const t = useT();
    const { heading, text } = shipAbilityText(t, classId);
    return (
        <p className="eod-ship-card-ability">
            <b>{heading}</b>
            {text}
        </p>
    );
}

/** The chosen ship from three sides. */
function ShipViews({ classId }) {
    const t = useT();
    return (
        <div className="eod-hangar-views">
            {HANGAR_VIEWS.map((view) => {
                const src = hangarImage(classId, view);
                return (
                    <figure key={view} className="eod-hangar-view">
                        {src && <img src={src} alt={`${t(`ship.${classId}`)} - ${t(`ui.hangar.view.${view}`)}`} draggable={false} />}
                        <figcaption>{t(`ui.hangar.view.${view}`)}</figcaption>
                    </figure>
                );
            })}
        </div>
    );
}

/**
 * The chosen ship in numbers (what its rating bars round off), and what its two weapons are
 * for. `note` is a line the page adds to them (in multiplayer: what the guns do to a player).
 */
function ShipNumbers({ classId, note }) {
    const t = useT();
    return (
        <div className="eod-hangar-numbers">
            <dl className="eod-hangar-specs">
                {shipSpecRows(t, classId).map(({ id, label, value }) => (
                    <div key={id}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
            </dl>
            <p className="eod-hangar-weapons">{t('ui.spec.weapons')}{note && <><br />{note}</>}</p>
        </div>
    );
}

/**
 * What the chosen ship is and what its ability does, written out for the screens whose cards
 * have no room for text (a phone, a narrow window); elsewhere it is on the ship's card.
 */
function ShipDetail({ classId }) {
    const t = useT();
    return (
        <div className="eod-hangar-detail">
            <h3><strong>{t(`ship.${classId}`)}</strong><em>{t(`playerShip.${classId}.role`)}</em></h3>
            <p>{t(`playerShip.${classId}.text`)}</p>
            <ShipAbility classId={classId} />
        </div>
    );
}

/**
 * @param {object} props
 * @param {import('../state/GameSession.js').GameSession} props.session the chosen ship is its `playerShip` setting
 * @param {string} [props.title] the page's heading ("Choose your ship" by default)
 * @param {import('react').ReactNode} [props.status] a line under the heading (the lobby's countdown)
 * @param {string} [props.note] a line under the ship's numbers
 * @param {string} [props.confirmLabel] the button that takes the chosen ship ("Launch" by default)
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onBack
 * @param {(classId: string) => void} [props.onSelect] called after another ship was chosen
 */
export default function Hangar({ session, title, status = null, note = null, confirmLabel, onConfirm, onBack, onSelect }) {
    const selected = useGameStore((state) => state.settings.playerShip);
    const t = useT();
    useEffect(preloadHangarImages, []);
    const select = (classId) => {
        if (classId === selected) return;
        session.updateSettings({ playerShip: classId });
        onSelect?.(classId);
    };
    return (
        <div className="eod-hangar">
            <h2 className="eod-hangar-title">{title ?? t('ui.hangar.title')}</h2>
            {status}
            <ShipViews classId={selected} />
            {/* Phones held sideways show the chosen ship's ratings here instead of on every card. */}
            <div className="eod-hangar-stats">
                {RATING_ORDER.map((rating) => (
                    <Rating key={rating} label={t(`ui.rating.${rating}`)} value={PLAYER_SHIPS.find((ship) => ship.classId === selected)?.ratings[rating] ?? 0} />
                ))}
            </div>
            <ShipNumbers classId={selected} note={note} />
            <ShipDetail classId={selected} />
            <div className="eod-hangar-ships">
                {PLAYER_SHIPS.map(({ classId, ratings }) => (
                    <button
                        key={classId}
                        type="button"
                        className={`eod-ship-card ${classId === selected ? 'eod-ship-card--selected' : ''}`}
                        aria-pressed={classId === selected}
                        onClick={() => select(classId)}
                    >
                        <img className="eod-ship-card-image" src={hangarImage(classId, 'front')} alt="" draggable={false} />
                        <strong>{t(`ship.${classId}`)}</strong>
                        <em>{t(`playerShip.${classId}.role`)}</em>
                        <p>{t(`playerShip.${classId}.text`)}</p>
                        <ShipAbility classId={classId} />
                        {RATING_ORDER.map((rating) => <Rating key={rating} label={t(`ui.rating.${rating}`)} value={ratings[rating]} />)}
                    </button>
                ))}
            </div>
            <div className="eod-hangar-actions">
                <button type="button" className="eod-button" onClick={onBack}>{t('ui.back')}</button>
                <button type="button" className="eod-button eod-button--primary" onClick={onConfirm}>{confirmLabel ?? t('ui.hangar.launch')}</button>
            </div>
        </div>
    );
}
