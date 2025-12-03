
import 'bootstrap/dist/css/bootstrap.min.css';
import { Helmet } from 'react-helmet';
import { useContext, useState, useMemo, useEffect } from 'react';
import { getProject } from '@theatre/core';
import { CanvasProvider } from '../sharedContexts/CanvasProvider';
import Casino from '../pages/Casino';
import casinoState from '../Casino.json';
import { casinoFormContext } from '../sharedContexts/CasinoFormProvider';
import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import CasinoRoomForm from '../Tools/CasinoRoomForm';
import PlaceBets from '../Tools/PlaceBets';
import { CasinoStatusForm } from '../Tools/CasinoStatusForm';
import { useAuthStore } from '../hooks/useAuthStore';
import axios from 'axios';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { roomURL } from '../Settings';
import { BaccaratGraphBoardContentContext } from '../sharedContexts/BaccaratGraphBoardContentProvider';
import { BaccaratPointDisplay } from '../Tools/BaccaratPointDisplay';

function ShipCasino({ isPortraitPhoneScreen }) {
    const { messageApi } = useContext(GlobalNotificationContext);
    const profile = useAuthStore(state => state.profile);
    const token = useAuthStore(state => state.token);
    const casinoProject = getProject('Casino', { state: casinoState });
    const card2Sheet = casinoProject.sheet('Card2');
    const casinoSheet = casinoProject.sheet('Casino');
    const chipSheet = casinoProject.sheet('Chip');
    const { showCasinoForm, setShowCasinoForm } = useContext(casinoFormContext);
    const [showPlaceBets, setShowPlaceBets] = useState(false);
    const [roomName, setRoomName] = useState("");
    const [roomId, setRoomId] = useState(null);
    const [moneyInRoom, setMoneyInRoom] = useState(null);
    const [statusInRoom, setStatusInRoom] = useState(null);
    const [betSides, setBetSides] = useState([]);
    const [countdownMs, setCountdownMs] = useState(0);
    const [displayCountDown, setDisplayCountDown] = useState(0);
    const [isOpeningFirstCard, setIsOpeningFirstCard] = useState(true);
    const [showSwitchCard, setShowSwitchCard] = useState(false);
    const [resultList, setResultList] = useState([]);
    const [levelOfBets, setLevelOfBets] = useState('lv1');
    const { baccaratGraphBoardContent, setBaccaratGraphBoardContent } = useContext(BaccaratGraphBoardContentContext);
    const [gameHands, setGameHands] = useState([]);


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

    // main bet choices
    const [mainChoice, setMainChoice] = useState(null); // 'Player' | 'Banker' | 'Tie'
    const [mainBetValue, setMainBetValue] = useState(0);
    const [winningSides, setWinningSides] = useState(null); // 'Player' | 'Banker' | 'Tie'    

    // side bets
    const [sideOpen, setSideOpen] = useState(false);
    const [smallTiger, setSmallTiger] = useState(0);
    const [bigTiger, setBigTiger] = useState(0);
    const [tigerTie, setTigerTie] = useState(0);

    const [baccaratPointDisplayManager, setBaccaratPointDisplayManager] = useState({
        "banker1": false,
        "banker2": false,
        "banker3": false,
        "player1": false,
        "player2": false,
        "player3": false,
        "finalResult": false,
    });

    const fetchRoomStatus = async (roomId, updateMoney) => {
        return new Promise(async (resolve) => {
            if (!roomId || !profile?.userId || !token) {
                console.warn("Missing roomId, profile.userId, or token");
                return resolve(false);
            }

            try {
                const response = await axios.get(
                    `${roomURL}baccarat-room/result-board/${roomId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                const data = response.data;

                if (!data || !data.usersInRoom) {
                    console.warn("API returned no usersInRoom");
                    return resolve(false);
                }

                const userData = data.usersInRoom[profile.userId];

                if (!userData) {
                    console.warn("User not found in usersInRoom");
                    return resolve(false);
                }

                setRoomId(roomId);
                if (updateMoney) {
                    setMoneyInRoom(userData.moneyInRoom);
                    setBaccaratGraphBoardContent(data.resultList || []);
                }
                setStatusInRoom(userData.statusInRoom);
                setBetSides(userData.betSides ?? {});
                if (Object.keys(data.usersInRoom).length > 1) {
                    if ((userData.statusInRoom === "dealing" || userData.statusInRoom === "results") && data.statusGeneralInRoom === "betting") {
                        messageApi('info', 'The other players are placing their bets. You might need to wait for a moment~', 5);
                    }
                }
                resolve(true); // 成功
            } catch (err) {
                console.error("Error fetching room status:", err);
                resolve(false); // 失败
            }
        });
    };

    useEffect(() => {
        setDisplayCountDown(countdownMs / 1000);
        if (countdownMs <= 0) return;

        const interval = setInterval(() => {
            setDisplayCountDown(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);

    }, [countdownMs]);


    return (
        <>
            <Helmet>
                <title>Welcome to Tim Bi's world - To the ship's casino.</title>
                <meta name="description" content="After the successfully upgraded the ship, the crew is now ready to explore the ship's casino which is filled with excitement and uncertainty." />
                <meta name="keywords" content="Tim Bi, 毕天元" />
                <meta property="og:title" content="Welcome to Tim Bi's world - To the ship's casino." />
                <meta property="og:description" content="After the successfully upgraded the ship, the crew is now ready to explore the ship's casino which is filled with excitement and uncertainty." />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://www.bty.co.nz/ship_casino" />
                <meta property="og:image" content="https://www.bty.co.nz/Tim%20Bi.webp" />
                <meta property="og:site_name" content="Tim Bi" />
                <link rel="canonical" href="https://www.bty.co.nz/ship_casino" />
                <meta name="author" content="Tim Bi" />

            </Helmet>
            <div
                style={{
                    position: 'fixed',
                    bottom: '2.5%',
                    right: '15px',
                    zIndex: 9999,
                    background: 'rgba(0,0,0,0.6)',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '20px',
                    fontWeight: 'bold',
                    backdropFilter: 'blur(4px)',
                    letterSpacing: '1px'
                }}
            >
                {displayCountDown}s
            </div>
            <BaccaratPointDisplay gameHands={gameHands || [[], []]} baccaratPointDisplayManager={baccaratPointDisplayManager} />
            {showSwitchCard && <div
                style={{
                    position: 'fixed',
                    top: '30px',
                    right: '15px',
                    zIndex: 9999,
                    background: '#fff',
                    color: '#000',
                    padding: '8px 12px',
                    borderRadius: '10px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                    userSelect: 'none'
                }}
                onClick={() => setIsOpeningFirstCard(prev => !prev)}
            >
                <FontAwesomeIcon icon={faArrowRightArrowLeft} />
                {isOpeningFirstCard ? "Card 1" : "Card 2"}
            </div>}
            {!showPlaceBets && <CasinoStatusForm roomName={roomName} roomId={roomId} moneyInRoom={moneyInRoom} statusInRoom={statusInRoom} betSides={betSides} />}
            {showCasinoForm && <CasinoRoomForm sceneSheet={casinoSheet} isPortraitPhoneScreen={isPortraitPhoneScreen} fetchRoomStatus={fetchRoomStatus} levelOfBets={levelOfBets} setLevelOfBets={setLevelOfBets} levels={levels} LevelMap={LevelMap} roomName={roomName} setRoomName={setRoomName} roomId={roomId} setRoomId={setRoomId} setCountdownMs={setCountdownMs} />}
            {showPlaceBets && (statusInRoom === "betting") && <PlaceBets isPortraitPhoneScreen={isPortraitPhoneScreen} moneyInRoom={moneyInRoom} roomId={roomId} fetchRoomStatus={fetchRoomStatus} levelOfBets={levelOfBets} LevelMap={LevelMap} mainChoice={mainChoice} setMainChoice={setMainChoice} mainBetValue={mainBetValue} setMainBetValue={setMainBetValue} sideOpen={sideOpen} setSideOpen={setSideOpen} smallTiger={smallTiger} setSmallTiger={setSmallTiger} bigTiger={bigTiger} setBigTiger={setBigTiger} tigerTie={tigerTie} setTigerTie={setTigerTie} chipSheet={chipSheet} setShowPlaceBets={setShowPlaceBets} setMoneyInRoom={setMoneyInRoom} />}
            <div style={{ position: 'relative', zIndex: 1, height: '100vh' }}>
                <CanvasProvider>
                    <Casino casinoSheet={casinoSheet} card2Sheet={card2Sheet} chipSheet={chipSheet} casinoProject={casinoProject} isPortraitPhoneScreen={isPortraitPhoneScreen} showPlaceBets={showPlaceBets} setShowPlaceBets={setShowPlaceBets} mainChoice={mainChoice} setMainChoice={setMainChoice} mainBetValue={mainBetValue} setMainBetValue={setMainBetValue} roomId={roomId} token={token} statusInRoom={statusInRoom} setStatusInRoom={setStatusInRoom} moneyInRoom={moneyInRoom} countdownMs={countdownMs} setCountdownMs={setCountdownMs} betSides={betSides} setBetSides={setBetSides} isOpeningFirstCard={isOpeningFirstCard} setIsOpeningFirstCard={setIsOpeningFirstCard} setShowSwitchCard={setShowSwitchCard} resultList={resultList} setResultList={setResultList} winningSides={winningSides} setWinningSides={setWinningSides} gameHands={gameHands} setGameHands={setGameHands} setBaccaratPointDisplayManager={setBaccaratPointDisplayManager} />
                </CanvasProvider>

            </div>


        </>
    )

}

export default ShipCasino;

