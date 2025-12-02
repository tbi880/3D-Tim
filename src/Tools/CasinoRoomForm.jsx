import React, { useState, useContext } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDoorOpen, faPlus, faCheck } from '@fortawesome/free-solid-svg-icons';
import './css/general.css';
import { useRoomStore } from '../hooks/useRoomStore';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';
import { casinoFormContext } from '../sharedContexts/CasinoFormProvider';

export default function CasinoRoomForm({ sceneSheet, isPortraitPhoneScreen, fetchRoomStatus, levelOfBets, setLevelOfBets, levels, LevelMap, roomName, setRoomName, roomId, setRoomId, setCountdownMs, setWaitingForJoinRoom }) {
    const [mode, setMode] = useState('join'); // 'join' | 'create'
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { joinRoom, createRoom, joining, creating, currentRoom } = useRoomStore();
    const { messageApi } = useContext(GlobalNotificationContext);
    const { showCasinoForm, setShowCasinoForm } = useContext(casinoFormContext);
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);

    // join
    const [joinRoomId, setJoinRoomId] = useState('');

    // create
    const [gameMode, setGameMode] = useState('free');
    const [maxUsers, setMaxUsers] = useState(5);
    const [gameType] = useState('Baccarat');

    // helper：千位分隔格式
    const fmt = (n) => {
        if (typeof n !== 'number') return n;
        return n.toLocaleString();
    };

    // 当前等级对应的 min/max/unit（自动 derived）
    const currentLevelValues = LevelMap[levelOfBets] || LevelMap.lv1;

    const handleAfterPlay = () => {
        if (window.location.pathname.includes('/ship_casino')) {
            setShowCasinoForm(false);
            playOnce({ sequence: sceneSheet.sequence, range: [6, 10] });
        }
    };

    const findLevelByMin = (minValue) => {
        for (const [level, config] of Object.entries(LevelMap)) {
            if (config.min === minValue) {
                return level;
            }
        }
        return null;
    };


    const handleJoinSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            if (!joinRoomId.trim()) {
                messageApi('warning', 'Please enter room ID', 1);
                return;
            }
            const result = await joinRoom(joinRoomId, messageApi);
            if (result.success) {
                setRoomName(result.data.roomName || '');
                setRoomId(result.data.roomId);
                setLevelOfBets(findLevelByMin(result.data.roomMinBet));
                fetchRoomStatus(result.data.roomId, true)
                    .then((ok) => ok && handleAfterPlay());
                setCountdownMs(result.data.countDownMs || 0);
                setWaitingForJoinRoom(true);
            }
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

            const result = await createRoom(dto, messageApi);
            if (result.success) {
                fetchRoomStatus(result.data.roomId, true)
                    .then((ok) => ok && handleAfterPlay());
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`casino-room-container ${isPortraitPhoneScreen ? 'portrait' : 'landscape'}`}>
            <div className="casino-card rb-card" style={{ marginTop: isPortraitPhoneScreen ? "30px" : 0 }}>
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
