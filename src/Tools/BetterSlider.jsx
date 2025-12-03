import { faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Slider } from "antd";
import { useState } from "react";

export function BetterSlider({ label, moneyInRoom, min, max, unit, step, value, setValue, isMainBets }) {
    const [tempValue, setTempValue] = useState(value);

    const fmt = (n) => {
        if (typeof n !== 'number') return n;
        return n.toLocaleString();
    };

    const adjust = (setter, value, delta, min, max) => {
        let newValue = value + delta;

        if (newValue < 0) newValue = 0;
        if (newValue > max) newValue = max;

        if (newValue !== 0 && newValue < min && delta > 0) newValue = min;
        if (newValue !== 0 && newValue < min && delta < 0) newValue = 0;

        setter(newValue);
        setTempValue(newValue);
    };


    const isOverBalance = (val) => (val > moneyInRoom);

    return (
        <>
            {isMainBets ? <div>
                <label className="label">{label}</label>

                <div style={{ marginBottom: 8 }}>
                    <div
                        className="level-display"
                        style={{
                            width: '100%',
                            backgroundColor: isOverBalance(tempValue) ? 'rgba(255,0,0,0.15)' : undefined,
                            textAlign: 'left'
                        }}
                    >
                        {fmt(tempValue)}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        className="button"
                        onClick={() => adjust(
                            setValue,
                            value,
                            -unit,
                            min,
                            max
                        )}
                    >
                        <FontAwesomeIcon icon={faMinus} />
                    </button>

                    <div style={{ flex: 1 }}>
                        <Slider
                            min={0}
                            max={max}
                            step={step}
                            value={tempValue}
                            onChange={(v) => setTempValue(v)}
                            onChangeComplete={(v) => setValue(v)}
                        />
                    </div>

                    <button
                        className="button"
                        onClick={() => adjust(
                            setValue,
                            value,
                            unit,
                            min,
                            max
                        )}
                    >
                        <FontAwesomeIcon icon={faPlus} />
                    </button>
                </div>

                {isOverBalance(tempValue) && (
                    <div style={{ color: 'salmon', marginTop: 8 }}>Not enough balance</div>
                )}

            </div>

                :
                <div>
                    <label className="label">{label}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button className="button" onClick={() => adjust(
                            setValue,
                            value,
                            -unit,
                            min,
                            max
                        )}>
                            <FontAwesomeIcon icon={faMinus} />
                        </button>

                        <div style={{ flex: 1 }}>
                            <Slider
                                min={0}
                                max={max}
                                step={step}
                                value={tempValue}
                                onChange={(v) => setTempValue(v)}
                                onChangeComplete={(v) => setValue(v)}
                            />
                        </div>

                        <button className="button" onClick={() => adjust(
                            setValue,
                            value,
                            unit,
                            min,
                            max
                        )}>
                            <FontAwesomeIcon icon={faPlus} />
                        </button>

                        <div style={{ minWidth: 120, textAlign: 'right' }}>
                            <div className="level-display" style={{ backgroundColor: isOverBalance(tempValue) ? 'rgba(255,0,0,0.15)' : undefined }}>{fmt(tempValue)}</div>
                        </div>
                    </div>
                    {isOverBalance(tempValue) && <div style={{ color: 'salmon', marginTop: 6 }}>Not enough balance</div>}
                </div >}
        </>
    )
}