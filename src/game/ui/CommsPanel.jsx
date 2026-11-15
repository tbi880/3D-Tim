import { useEffect, useState } from 'react';
import { CHARACTERS } from '../config/characters.js';
import { isTouchDevice } from '../input/device.js';
import { useGameStore, useT } from '../state/gameStore.js';

/** Characters revealed per second by the typewriter effect. */
const TYPE_SPEED = 55;
const TYPE_TICK_MS = 30;
const IS_TOUCH = isTouchDevice();

/** Simple drawn portraits for speakers without a photo. */
function PortraitGlyph({ glyph, color }) {
    const common = { fill: 'none', stroke: color, strokeWidth: 3, strokeLinecap: 'round' };
    return (
        <svg viewBox="0 0 64 64" className="eod-comms-glyph" aria-hidden="true">
            {glyph === 'ai' && (
                <>
                    <circle cx="32" cy="32" r="20" {...common} />
                    <circle cx="32" cy="32" r="7" fill={color} />
                    <path d="M32 4v8M32 52v8M4 32h8M52 32h8" {...common} />
                </>
            )}
            {glyph === 'officer' && (
                <>
                    <circle cx="32" cy="23" r="11" {...common} />
                    <path d="M10 58c2-14 12-20 22-20s20 6 22 20" {...common} />
                    <path d="M24 46l8 6 8-6" {...common} />
                </>
            )}
            {glyph === 'unknown' && (
                <>
                    <path d="M32 6l24 44H8z" {...common} />
                    <path d="M20 40h24M26 30h12" {...common} />
                </>
            )}
        </svg>
    );
}

/**
 * The comms channel: who is talking and what they say, typed out letter by letter.
 * Tapping (or clicking) the panel shows the whole line at once; tapping again skips it.
 */
export default function CommsPanel({ session }) {
    const comms = useGameStore((state) => state.comms);
    const t = useT();
    const lineId = comms?.id ?? null;
    // The count belongs to one line, so a new line never flashes up with the last one's count.
    const [typed, setTyped] = useState({ lineId: null, count: 0 });
    const visibleCharacters = typed.lineId === lineId ? typed.count : 0;

    useEffect(() => {
        if (lineId === null) return undefined;
        const timer = setInterval(() => {
            setTyped((state) => ({ lineId, count: (state.lineId === lineId ? state.count : 0) + (TYPE_SPEED * TYPE_TICK_MS) / 1000 }));
        }, TYPE_TICK_MS);
        return () => clearInterval(timer);
    }, [lineId]);

    if (!comms) return null;
    const character = CHARACTERS[comms.speakerId] ?? CHARACTERS.vega;
    const text = t(comms.textKey);
    const isRecording = comms.textKey.includes('.log');
    const typing = visibleCharacters < text.length;
    const onTap = (event) => {
        event.stopPropagation();
        if (typing) setTyped({ lineId, count: text.length });
        else session.handleAction('skip');
    };

    return (
        <div className={`eod-comms ${character.glitch ? 'eod-comms--glitch' : ''}`} style={{ '--speaker-color': character.color }} onPointerDown={onTap}>
            <div className="eod-comms-portrait">
                {character.portrait.image
                    ? <img src={character.portrait.image} alt="" draggable={false} />
                    : <PortraitGlyph glyph={character.portrait.glyph} color={character.color} />}
            </div>
            <div className="eod-comms-body">
                <div className="eod-comms-header">
                    <span className="eod-comms-name">{t(`speaker.${character.id}`)}</span>
                    <span className="eod-comms-role">{t(`speaker.${character.id}.role`)}</span>
                    {isRecording && <span className="eod-comms-tag">● {t('hud.recording')}</span>}
                </div>
                <p className="eod-comms-text">{text.slice(0, Math.ceil(visibleCharacters))}</p>
                <span className="eod-comms-skip">{t(IS_TOUCH ? 'hud.skip.touch' : 'hud.skip')}</span>
            </div>
        </div>
    );
}
