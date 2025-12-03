import { calculateBaccaratPoints } from "../utils/cardMapping";
import { bucketURL } from "../Settings";
import { useMemo } from "react";

export const BaccaratPointDisplay = ({ gameHands, baccaratPointDisplayManager }) => {
    if (!gameHands || gameHands.length < 2) return null;

    const { playerHand, bankerHand } = useMemo(() => {
        const normalize = (hand) => {
            if (!hand) return [];
            if (Array.isArray(hand) && !Array.isArray(hand[0])) return hand;
            if (Array.isArray(hand) && Array.isArray(hand[0])) return hand[0];
            return [];
        };

        return {
            playerHand: normalize(gameHands[0]),
            bankerHand: normalize(gameHands[1])
        };
    }, [gameHands]);

    const { playerPoints, bankerPoints } = useMemo(() => {
        return {
            playerPoints: calculateBaccaratPoints(playerHand),
            bankerPoints: calculateBaccaratPoints(bankerHand)
        };
    }, [playerHand, bankerHand]);

    const resultImage = useMemo(() => {
        if (playerPoints > bankerPoints) return `${bucketURL}pic/player-wins.png`;
        if (bankerPoints > playerPoints) return `${bucketURL}pic/banker-wins.png`;
        return `${bucketURL}pic/tie.png`;
    }, [playerPoints, bankerPoints]);

    const containerStyle = useMemo(() => ({
        position: 'fixed',
        top: '70%',
        left: 0,
        width: '100%',
        height: '12.5vh',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 2rem',
        background: 'rgba(255,255,255,0.9)',
        zIndex: 10000,
        pointerEvents: 'none',
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#000',
    }), []);

    const columnStyle = useMemo(() => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
    }), []);

    return (
        <div style={containerStyle}>
            {/* Player */}
            <div style={columnStyle}>
                <div>Player: {baccaratPointDisplayManager.finalResult ? playerPoints : ''}</div>
                <div>
                    {baccaratPointDisplayManager.player1 && (playerHand[0] + ' ')}
                    {baccaratPointDisplayManager.player2 && (playerHand[1] + ' ')}
                    {baccaratPointDisplayManager.player3 && (playerHand[2] ?? '')}
                </div>
            </div>

            {/* Result */}
            <div style={{ textAlign: 'center' }}>
                {baccaratPointDisplayManager.finalResult && (
                    <img src={resultImage} alt="final result" style={{ height: '50px' }} />
                )}
            </div>

            {/* Banker */}
            <div style={columnStyle}>
                <div>Banker: {baccaratPointDisplayManager.finalResult ? bankerPoints : ''}</div>
                <div>
                    {baccaratPointDisplayManager.banker3 && (bankerHand[2] ? (' ' + bankerHand[2]) : '')}
                    {baccaratPointDisplayManager.banker2 && (' ' + bankerHand[1])}
                    {baccaratPointDisplayManager.banker1 && (' ' + bankerHand[0] + ' ')}
                </div>
            </div>
        </div>
    );
};
export default BaccaratPointDisplay;