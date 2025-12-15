import React, { useState, useEffect, useContext } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faMinus, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { Slider } from 'antd';
import './css/general.css';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { useAuthStore } from '../hooks/useAuthStore';
import useCasinoControl from '../hooks/useCasinoControl';
import { roomURL } from '../Settings';
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { BetterSlider } from './BetterSlider';

export default function PlaceBets({ isPortraitPhoneScreen, moneyInRoom, roomId, fetchRoomStatus, levelOfBets, LevelMap, setMainChoice, mainBetValue, setMainBetValue, sideOpen, setSideOpen, smallTiger, setSmallTiger, bigTiger, setBigTiger, tigerTie, setTigerTie, chipSheet, setShowPlaceBets, setMoneyInRoom }) {
    const { messageApi } = useContext(GlobalNotificationContext);
    const token = useAuthStore(state => state.token);
    const currentLevelValues = LevelMap[levelOfBets] || LevelMap.lv1;
    const { placeBetOnPlayer, placeBetOnBanker, placeBetOnTie } = useCasinoControl({ chipSheet: chipSheet });
    const [isPlacing, setIsPlacing] = useState(false);
    const [thinkingChoice, setThinkingChoice] = useState(null);
    const roomValue = useMotionValue(moneyInRoom);
    const display = useTransform(roomValue, (latest) => {
        return Number(latest).toLocaleString();
    });
    useEffect(() => {
        const controls = animate(roomValue, moneyInRoom, { duration: 1.5 });
        return () => controls.stop();
    }, [moneyInRoom]);


    const odds = [
        ["SmallTiger", 22],
        ["BigTiger", 50],
        ["TigerTie", 35],
        ["Tie", 8],
        ["Player", 1],
        ["Banker", 0.95],
    ];

    useEffect(() => {
        fetchRoomStatus(roomId, true);
    }, []);

    const fmt = (n) => {
        if (typeof n !== 'number') return n;
        return n.toLocaleString();
    };

    const handlePlaceBets = async (isFreehand) => {
        try {
            if (isPlacing) return;
            setIsPlacing(true);
            const betSides = {};

            if (thinkingChoice && mainBetValue > 0) {
                betSides[thinkingChoice] = mainBetValue;
            }
            if (sideOpen && smallTiger > 0) betSides["SmallTiger"] = smallTiger;
            if (sideOpen && bigTiger > 0) betSides["BigTiger"] = bigTiger;
            if (sideOpen && tigerTie > 0) betSides["TigerTie"] = tigerTie;

            if (!isFreehand && Object.keys(betSides).length === 0) {
                messageApi('error', 'Please select at least one bet option or go with Freehand', 1);
                return;
            }

            const totalBetValue = (mainBetValue + (sideOpen ? (smallTiger + bigTiger + tigerTie) : 0));
            if (!isFreehand && totalBetValue > moneyInRoom) {
                messageApi('error', `Insufficient balance for the bets placed, all bets combined ${totalBetValue} exceed your available balance ${moneyInRoom}`, 5);
                return;
            }

            const response = await fetch(`${roomURL}baccarat-room/place-bets`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    roomId: roomId,
                    betSidesWithAmount: isFreehand ? {
                        "Freehand": 0
                    } : betSides
                })
            });

            if (response.status === 200) {
                if (!isFreehand) {
                    if (thinkingChoice) {
                        if (thinkingChoice === 'Player') {
                            setMainChoice('Player');
                            placeBetOnPlayer();
                        } else if (thinkingChoice === 'Banker') {
                            setMainChoice('Banker');
                            placeBetOnBanker();
                        } else if (thinkingChoice === 'Tie') {
                            setMainChoice('Tie');
                            placeBetOnTie();
                        }
                    }
                    messageApi('success', 'Bet placed successfully', 1);
                } else {
                    setMainChoice(null);
                    messageApi('success', 'Freehand for you this round', 1);
                }
                fetchRoomStatus(roomId, false);
                if (!isFreehand) {
                    setMoneyInRoom(moneyInRoom - totalBetValue);
                }
                setShowPlaceBets(false);
            } else {
                const errorText = await response.text();
                messageApi('error', errorText || 'Unknown error', 1);
            }

        } catch (err) {
            messageApi('error', err.message || 'Network error', 1);
        } finally {
            setIsPlacing(false);
        }
    };

    return (
        <div className={`casino-room-container`}>
            <div className="casino-card rb-card" style={{ marginTop: isPortraitPhoneScreen ? "130%" : 0 }}>
                <h1 className="title">Place Bets</h1>

                <div className="divider"></div>

                <label className="label">
                    In Room Chip Value:&nbsp;
                    <motion.span className="level-display" style={{ marginLeft: 8 }}>
                        {display}
                    </motion.span>
                </label>

                <div className="divider"></div>

                <label className="label">Current Level — Min / Max / Unit</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                        <label className="level-display">Min: {fmt(currentLevelValues.min)}</label>
                        <label className="level-display">Max: {fmt(currentLevelValues.max)}</label>
                        <label className="level-display">Unit: {fmt(currentLevelValues.unit)}</label>
                    </div>
                </div>

                <div style={{ height: 10 }}></div>

                <label className="label">Odds</label>
                <div className="rb-section" style={{ padding: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {odds.map(([name, odd]) => (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>{name}</div>
                                <div>{odd} : 1</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="divider"></div>

                <label className="label">Main Bets options:</label>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button
                        type="button"
                        className={`button ${thinkingChoice === 'Player' ? 'submit-button' : ''}`}
                        onClick={() => setThinkingChoice('Player')}
                    >
                        Player
                    </button>
                    <button
                        type="button"
                        className={`button ${thinkingChoice === 'Banker' ? 'submit-button' : ''}`}
                        onClick={() => setThinkingChoice('Banker')}
                    >
                        Banker
                    </button>
                    <button
                        type="button"
                        className={`button ${thinkingChoice === 'Tie' ? 'submit-button' : ''}`}
                        onClick={() => setThinkingChoice('Tie')}
                    >
                        Tie
                    </button>
                </div>

                <div style={{ height: 12 }}></div>
                <BetterSlider label={"Bet Amount"} moneyInRoom={moneyInRoom} min={currentLevelValues.min} max={currentLevelValues.max} unit={currentLevelValues.unit} step={currentLevelValues.unit} value={mainBetValue} setValue={setMainBetValue} isMainBets={true} />

                <div style={{ height: 12 }}></div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="button" onClick={() => setSideOpen(s => !s)}>
                        <FontAwesomeIcon icon={sideOpen ? faEyeSlash : faEye} /> {sideOpen ? ' Hide Side Bets' : ' Show Side Bets'}
                    </button>
                </div>

                {sideOpen && (
                    <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                            <BetterSlider
                                label="Small Tiger — Odds: 22 : 1"
                                moneyInRoom={moneyInRoom}
                                min={currentLevelValues.min / 5}
                                max={currentLevelValues.max / 5}
                                unit={currentLevelValues.unit / 5}
                                step={currentLevelValues.unit / 5}
                                value={smallTiger}
                                setValue={setSmallTiger}
                            />

                            <BetterSlider
                                label="Big Tiger — Odds: 50 : 1"
                                moneyInRoom={moneyInRoom}
                                min={currentLevelValues.min / 5}
                                max={currentLevelValues.max / 5}
                                unit={currentLevelValues.unit / 5}
                                step={currentLevelValues.unit / 5}
                                value={bigTiger}
                                setValue={setBigTiger}
                            />

                            <BetterSlider
                                label="Tiger Tie — Odds: 35 : 1"
                                moneyInRoom={moneyInRoom}
                                min={currentLevelValues.min / 5}
                                max={currentLevelValues.max / 5}
                                unit={currentLevelValues.unit / 5}
                                step={currentLevelValues.unit / 5}
                                value={tigerTie}
                                setValue={setTigerTie}
                            />
                        </div>
                    </div>
                )}

                <div className="divider"></div>

                <div className="button-container" >
                    <button className={`button submit-button ${isPlacing ? "submit-button-submitting" : ""}`}
                        disabled={isPlacing} onClick={() => handlePlaceBets(false)}> {isPlacing ? "Loading..." : "Place Bets"}</button>
                    <br />
                    <button className={`button submit-button ${isPlacing ? "submit-button-submitting" : ""}`}
                        disabled={isPlacing} onClick={() => handlePlaceBets(true)}> {isPlacing ? "Loading..." : "Free Hand"}</button>
                </div>

            </div>
        </div>
    );
}
