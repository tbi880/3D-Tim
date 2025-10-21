import React, { useState, useMemo, useContext } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDoorOpen, faPlus, faCheck } from '@fortawesome/free-solid-svg-icons';
import './css/general.css';
import { useRoomStore } from '../hooks/useRoomStore';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';

export default function CasinoRoomForm({ isPortraitPhoneScreen }) {
    const [mode, setMode] = useState('join'); // 'join' | 'create'
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { joinRoom, createRoom, joining, creating, currentRoom } = useRoomStore();
    const { messageApi } = useContext(GlobalNotificationContext);


    // join
    const [joinRoomId, setJoinRoomId] = useState('');

    // create
    const [gameMode, setGameMode] = useState('free');
    const [roomName, setRoomName] = useState('');
    const [maxUsers, setMaxUsers] = useState(5);
    const [gameType] = useState('Baccarat');
    const [levelOfBets, setLevelOfBets] = useState('lv1');

    const levels = [
        'lv1', 'lv2', 'lv3', 'lv4', 'lv5', 'lv6', 'lv7', 'lv8', 'lv9', 'lv10'
    ];

    const LevelMap = useMemo(() => ({
        lv1: { min: 1000, max: 100000, unit: 100 },
        lv2: { min: 2000, max: 200000, unit: 200 },
        lv3: { min: 5000, max: 500000, unit: 500 },
        lv4: { min: 10000, max: 1000000, unit: 1000 },
        lv5: { min: 50000, max: 5000000, unit: 5000 },
        lv6: { min: 100000, max: 10000000, unit: 10000 },
        lv7: { min: 300000, max: 30000000, unit: 30000 },
        lv8: { min: 500000, max: 50000000, unit: 50000 },
        lv9: { min: 1000000, max: 100000000, unit: 100000 },
        lv10: { min: 5000000, max: 500000000, unit: 500000 },
    }), []);

    // helper：千位分隔格式
    const fmt = (n) => {
        if (typeof n !== 'number') return n;
        return n.toLocaleString();
    };

    // 当前等级对应的 min/max/unit（自动 derived）
    const currentLevelValues = LevelMap[levelOfBets] || LevelMap.lv1;

    const handleJoinSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            if (!joinRoomId.trim()) {
                messageApi('warning', 'Please enter room ID', 1);
                return;
            }
            await joinRoom(joinRoomId, messageApi);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            if (!roomName.trim()) {
                messageApi('warning', 'Please enter room name', 1);
                return;
            }

            const dto = {
                roomName: roomName.trim(),
                maxUsers: Number(maxUsers),
                levelOfBets,
                gameType,
            };

            await createRoom(dto, messageApi);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`casino-room-container ${isPortraitPhoneScreen ? 'portrait' : 'landscape'}`}>
            <div className="casino-card rb-card">
                <h1 className="title">Lobby</h1>

                <div className="rb-toggle">
                    <button
                        className={`rb-toggle-btn ${mode === 'join' ? 'active' : ''}`}
                        onClick={() => setMode('join')}
                    >
                        <FontAwesomeIcon icon={faDoorOpen} /> Join Room
                    </button>
                    <button
                        className={`rb-toggle-btn ${mode === 'create' ? 'active' : ''}`}
                        onClick={() => setMode('create')}
                    >
                        <FontAwesomeIcon icon={faPlus} /> Create Room
                    </button>
                </div>

                <div className="rb-section">
                    {mode === 'join' ? (
                        <form className="form" onSubmit={handleJoinSubmit}>
                            <div className="divider"></div>

                            <label className="label">Room Number <span className="required">*</span></label>
                            <input
                                className="input"
                                type="number"
                                placeholder="Enter Room ID (max 4 digits)"
                                value={joinRoomId}
                                onChange={(e) => e.target.value.length <= 4 ? setJoinRoomId(e.target.value) : null}
                                required
                            />

                            <div className="button-container">
                                <button
                                    type="submit"
                                    className={`button submit-button ${isSubmitting ? 'submit-button-submitting' : ''}`}
                                    disabled={isSubmitting}
                                >
                                    {!isSubmitting && <FontAwesomeIcon icon={faCheck} />}
                                    {isSubmitting ? ' Connecting...' : ' Join'}
                                </button>
                            </div>

                        </form>
                    ) : (
                        <form className="form" onSubmit={handleCreateSubmit}>
                            <div className="divider"></div>

                            <label className="label">Game Modes <span className="required">*</span></label>
                            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                                <button
                                    type="button"
                                    className={`button ${gameMode === 'free' ? 'submit-button' : ''}`}
                                    onClick={() => setGameMode('free')}
                                >
                                    Free Mode
                                </button>
                                <button
                                    type="button"
                                    className="button close-button"
                                    disabled
                                    title="Agreement Mode is temporarily unavailable"
                                    onClick={() => setGameMode('bet')}
                                >
                                    Agreement Mode (Disabled)
                                </button>
                            </div>

                            <label className="label">Room Name <span className="required">*</span></label>
                            <input
                                className="input"
                                type="text"
                                placeholder="Tim's Room"
                                value={roomName}
                                onChange={(e) => setRoomName(e.target.value)}
                                maxLength={40}
                                required
                            />

                            <label className="label">Max Players (Up to 10) <span className="required">*</span></label>
                            <input
                                className="input"
                                type="number"
                                min={1}
                                max={10}
                                value={maxUsers}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    if (!isNaN(v)) setMaxUsers(Math.min(10, Math.max(1, v)));
                                }}
                                required
                            />

                            <label className="label">Game Type</label>
                            <select className="input" value={gameType} disabled>
                                <option value="Baccarat">Baccarat</option>
                            </select>

                            <div className="divider"></div>

                            <label className="label">Bet Level <span className="required">*</span></label>
                            <select
                                className="input"
                                value={levelOfBets}
                                onChange={(e) => setLevelOfBets(e.target.value)}
                            >
                                {levels.map(l => {
                                    const v = LevelMap[l];
                                    const label = `${l} — (Min: ${fmt(v.min)}, Max: ${fmt(v.max)}, Unit: ${fmt(v.unit)})`;
                                    return <option key={l} value={l}>{label}</option>;
                                })}
                            </select>

                            <label className="label">Current Level — Min / Max / Unit</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                    <label className="level-display">Min: {fmt(currentLevelValues.min)}</label>
                                    <label className="level-display">Max: {fmt(currentLevelValues.max)}</label>
                                    <label className="level-display">Unit: {fmt(currentLevelValues.unit)}</label>
                                </div>
                            </div>

                            <div style={{ height: 10 }}></div>

                            <div className="button-container">
                                <button
                                    style={{ marginTop: '5%' }}
                                    type="submit"
                                    className={`button submit-button ${isSubmitting ? 'submit-button-submitting' : ''}`}
                                    disabled={isSubmitting}
                                >
                                    {!isSubmitting && <FontAwesomeIcon icon={faCheck} />}
                                    {isSubmitting ? ' Connecting...' : ' Create Room'}
                                </button>

                                <button
                                    type="button"
                                    className="button close-button"
                                    onClick={() => {
                                        setRoomName('');
                                        setMaxUsers(5);
                                        setLevelOfBets('lv1');
                                    }}
                                    style={{ marginTop: '5%' }}
                                >
                                    Reset
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
