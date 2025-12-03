import { Suspense, useCallback, useEffect, useRef, useContext, useState } from 'react';
import PreloadAssets from '../modelComponents/PreloadAssets';
import { editable as e, PerspectiveCamera } from '@theatre/r3f'
import { bucketURL, stageOfENV } from '../Settings';
import AnyModel from '../modelComponents/AnyModel';
import { Environment } from '@react-three/drei';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import Loader from './Loader';
import { Perf } from 'r3f-perf';
import { SheetProvider } from '@theatre/r3f';
import { useComponentDisplayManager } from '../hooks/useComponentDisplayManager';
import { Bloom, BrightnessContrast, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { casinoFormContext } from '../sharedContexts/CasinoFormProvider';
import SingleLoadManager from '../modelComponents/SingleLoadManager';
import Chips from '../modelComponents/Chips';
import useRoomHub from '../hooks/useRoomHub';
import { cardStringToModelUrl } from '../utils/cardMapping';
import useCasinoControl from '../hooks/useCasinoControl';
import { useAuthStore } from '../hooks/useAuthStore';


function Casino({ casinoSheet, card2Sheet, chipSheet, casinoProject, isPortraitPhoneScreen, showPlaceBets, setShowPlaceBets, mainChoice, setMainChoice, mainBetValue, setMainBetValue, roomId, token, statusInRoom, setStatusInRoom, moneyInRoom, countdownMs, setCountdownMs, betSides, setBetSides, isOpeningFirstCard, setIsOpeningFirstCard, setShowSwitchCard, resultList, setResultList, winningSides, setWinningSides, gameHands, setGameHands, setBaccaratPointDisplayManager }) {
    const { messageApi } = useContext(GlobalNotificationContext);
    const { showCasinoForm, setShowCasinoForm } = useContext(casinoFormContext);
    const mainBetChoiceRef = useRef(mainChoice);
    mainBetChoiceRef.current = mainChoice;
    const profile = useAuthStore(state => state.profile);


    const [showComponents, toggleComponentDisplay] = useComponentDisplayManager({
        loadingComponents: {
            preloadAssets: true,
            preloadEnv: true,

            cardCover1_player: false,
            cardCover2_player: false,
            cardCover3_player: false,
            card1_player: false,
            card2_player: false,
            card3_player: false,

            cardCover1_banker: false,
            cardCover2_banker: false,
            cardCover3_banker: false,
            card1_banker: false,
            card2_banker: false,
            card3_banker: false,
        },
        initialComponents: {
            preloadAssets: false,
            preloadEnv: false,

            cardCover1_player: true,
            cardCover2_player: true,
            cardCover3_player: false,
            card1_player: true,
            card2_player: true,
            card3_player: false,

            cardCover1_banker: true,
            cardCover2_banker: true,
            cardCover3_banker: false,
            card1_banker: true,
            card2_banker: true,
            card3_banker: false,
        }
    });

    const { connectionRef, connectionState } = useRoomHub(token, casinoSheet, card2Sheet, chipSheet, showComponents, toggleComponentDisplay, setShowPlaceBets, roomId);

    useEffect(() => {
        if (connectionState !== 'connected') return;
        const conn = connectionRef.current;


        const UserStatusChanged = (data) => {
            setStatusInRoom(data.roomUserStatus);
            setCountdownMs(data.countdownMs);
        };

        const UserJoined = (username) => {
            messageApi('success', `User ${username} joined the room.`, 3);
        };

        const ResultsReady = async (data) => {
            setCountdownMs(data.countdownMs);
            setGameHands(data.gameHands);
            setWinningSides(data.winningSides);
            setShowPlaceBets(false);
            await dealFirst4Cards();
            if (mainBetChoiceRef.current === 'Player') {
                openCard2Player();
                await openCard1Player();
            } else if (mainBetChoiceRef.current === 'Banker') {
                await openPlayer1And2CardsFree();
                openCard2Banker();
                await openCard1Banker();
            }
        }

        const NewGameCountdownStarted = async (data) => {
            setCountdownMs(data.countdownMs);
            setResultList(data.resultList);
            if (mainBetChoiceRef.current != 'Player' && mainBetChoiceRef.current != 'Banker') {
                await waitForSequenceThen(casinoSheet, async () => { await openPlayer1And2CardsFree() });
                await openBanker1And2CardsFree();
                if (showComponents.card3_player) {
                    await dealPlayer3Card();
                    await openPlayer3CardFree();
                }
                if (showComponents.card3_banker) {
                    await dealBanker3Card();
                    await openBanker3CardFree();
                }
            }

            if (mainBetChoiceRef.current != null) {
                if (mainBetChoiceRef.current === 'Player') {
                    if (data.resultList[data.resultList.length - 1] === "Player") {
                        winBetOnPlayer();
                    } else if (data.resultList[data.resultList.length - 1] === "Tie") {
                        messageApi('info', 'Your bet on Player is returned due to Tie.', 3);
                    }
                    else {
                        loseBetOnPlayer();
                    }
                } else if (mainBetChoiceRef.current === 'Banker') {
                    if (data.resultList[data.resultList.length - 1] === "Banker") {
                        winBetOnBanker();
                    } else if (data.resultList[data.resultList.length - 1] === "Tie") {
                        messageApi('info', 'Your bet on Banker is returned due to Tie.', 3);
                    }
                    else {
                        loseBetOnBanker();
                    }
                } else if (mainBetChoiceRef.current === 'Tie') {
                    if (data.resultList[data.resultList.length - 1] === "Tie") {
                        winBetOnTie();
                    } else {
                        loseBetOnTie();
                    }
                }
            }
            setBaccaratPointDisplayManager(prev => ({ ...prev, finalResult: true }));


            await removeAllCards();
            await changeUserStatusInRoom("waiting");
        };

        const NextGameLastHand = async (data) => {
            messageApi('info', 'The next round is the last hand of this shoe.', 5);
        };

        const UserRemoved = async (data) => {
            if (data.userId === profile?.userId) {
                messageApi('info', `You have been removed from the room due to inactivity.`, 5);
                setTimeout(() => {
                    window.location.href = '/ship_quarter';
                }, 5000);
                return;
            }
            messageApi('info', `User ${data.username} has been removed from the room due to inactivity.`, 5);
        };

        const UserActionNotification = (data) => {
            if (data.userId === profile?.userId) {
                if (data.roomUserStatus === "betting" && data.generalStatusInRoom === "waiting") {
                    messageApi('info', 'The other players are still waiting for the last round to finish. Please be patient~', 5);
                } else if (data.roomUserStatus === "results" && data.generalStatusInRoom === "dealing") {
                    messageApi('info', 'The other players are driving the game by opening the cards. Please wait for them to finish~', 5);
                } else if (data.roomUserStatus === "waiting" && (data.generalStatusInRoom === "results")) {
                    messageApi('info', 'The other players are still getting their bets. Please wait a moment~', 5);
                } else if (data.statusInRoom === "waiting") {
                    messageApi('info', 'The game is in progress. Please wait this round to finish then you can place the bets... Please be patient, this would not take long~', 5);
                }
            }
            else {
                if (data.countOfUsersStillIsGeneralInRoomStatus > 0) {
                    messageApi('info', `User ${data.userName} action changed to ${data.roomUserStatus}. Now we are still waiting for ${data.countOfUsersStillIsGeneralInRoomStatus} players to finish their current actions.`, 3);
                }
            }
        }

        conn.on('UserJoined', UserJoined);
        conn.on('UserStatusChanged', UserStatusChanged);
        conn.on('ResultsReady', ResultsReady);
        conn.on('NewGameCountdownStarted', NewGameCountdownStarted);
        conn.on('NextGameLastHand', NextGameLastHand);
        conn.on('UserRemoved', UserRemoved);
        conn.on('UserActionNotification', UserActionNotification);

        return () => {
            conn.off('UserJoined', UserJoined);
            conn.off('UserStatusChanged', UserStatusChanged);
            conn.off('ResultsReady', ResultsReady);
            conn.off('NewGameCountdownStarted', NewGameCountdownStarted);
            conn.off('NextGameLastHand', NextGameLastHand);
            conn.off('UserRemoved', UserRemoved);
            conn.off('UserActionNotification', UserActionNotification);
        };
    }, [connectionState, showComponents, messageApi, profile.userId]);


    const changeUserStatusInRoom = async (status) => {
        const conn = connectionRef.current;
        if (!conn) {
            messageApi('error', 'Not connected to the server');
            return;
        }
        try {
            await conn.invoke('UserActionChangeUserStatusInRoom', status);
            setStatusInRoom(status);
            messageApi('success', `Action completed. Status changed to ${status}`, 1);
        } catch (err) {
            console.error('Failed to change status', err);
            messageApi('error', 'Failed to change status: ' + err.message, 5);
        }
    };

    const resetRoundState = () => {
        setMainChoice(null);
        setMainBetValue(0);
        setBetSides(null);
        setIsOpeningFirstCard(true);
        setWinningSides([]);
        setGameHands([]);
    };

    const {
        loseBetOnPlayer,
        winBetOnPlayer,

        loseBetOnBanker,
        winBetOnBanker,

        loseBetOnTie,
        winBetOnTie,

        dealFirst4Cards,

        openCard1Player,
        openCard2Player,
        openCard1Banker,
        openCard2Banker,

        openPlayer1And2CardsFree,
        openBanker1And2CardsFree,

        dealPlayer3Card,
        openCard3Player,
        openPlayer3CardFree,

        dealBanker3Card,
        openCard3Banker,
        openBanker3CardFree,

        removeAllCards,
        waitForSequenceThen,
    } = useCasinoControl({
        casinoSheet,
        card2Sheet,
        chipSheet,
        showComponents,
        toggleComponentDisplay,
        setShowPlaceBets,
        setShowSwitchCard,
        setIsOpeningFirstCard,
        mainBetChoiceRef,
        changeUserStatusInRoom,
        resetRoundState,
        setBaccaratPointDisplayManager
    });



    const finishLoading = useCallback(() => {
        casinoProject.ready.then(() => {
            casinoSheet.sequence.position = 6;
            // casinoSheet.sequence.play({ range: [0, 6] });
        });
    }, []);


    useEffect(() => {
        if (gameHands.length === 0) { return; }
        if (gameHands[0].length >= 3) {
            if (showComponents.card3_player === false) {
                toggleComponentDisplay('cardCover3_player');
                toggleComponentDisplay('card3_player');
            }
        } else {
            if (showComponents.card3_player === true) {
                toggleComponentDisplay('cardCover3_player');
                toggleComponentDisplay('card3_player');
            }
        }
        if (gameHands[1].length >= 3) {
            if (showComponents.card3_banker === false) {
                toggleComponentDisplay('cardCover3_banker');
                toggleComponentDisplay('card3_banker');
            }
        } else {
            if (showComponents.card3_banker === true) {
                toggleComponentDisplay('cardCover3_banker');
                toggleComponentDisplay('card3_banker');
            }
        }
    }, [gameHands, showComponents]);

    return (
        <>
            <Suspense fallback={<Loader isIntroNeeded={false} extraContent={["Here is a good place to have fun", "Don't lose them all", "If you lose them all you have wait for the second day to get your salary as your daily reward."]} onFinished={() => { finishLoading() }} />}>
                {stageOfENV != "prod" && !isPortraitPhoneScreen && <Perf position={"bottom-right"} openByDefault showGraph />}
                {showComponents.preloadAssets && <PreloadAssets />}
                {showComponents.preloadAssets && <>
                    <AnyModel modelURL={'casino/cards/clubs_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_1"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_2.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_2"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_3.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_3"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_4.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_4"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_5.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_5"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_6.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_6"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_7.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_7"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_8.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_8"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_9.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_9"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_10.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_10"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_11.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_11"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_12.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_12"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/clubs_13.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"clubs_13"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />

                    <AnyModel modelURL={'casino/cards/diamonds_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_1"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_2.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_2"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_3.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_3"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_4.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_4"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_5.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_5"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_6.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_6"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_7.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_7"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_8.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_8"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_9.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_9"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_10.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_10"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_11.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_11"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_12.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_12"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/diamonds_13.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"diamonds_13"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />

                    <AnyModel modelURL={'casino/cards/hearts_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_1"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_2.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_2"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_3.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_3"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_4.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_4"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_5.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_5"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_6.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_6"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_7.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_7"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_8.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_8"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_9.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_9"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_10.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_10"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_11.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_11"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_12.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_12"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/hearts_13.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hearts_13"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />

                    <AnyModel modelURL={'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_1"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_2.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_2"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_3.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_3"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_4.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_4"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_5.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_5"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_6.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_6"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_7.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_7"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_8.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_8"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_9.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_9"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_10.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_10"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_11.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_11"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_12.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_12"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                    <AnyModel modelURL={'casino/cards/spades_13.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"spades_13"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} />
                </>}

                <SheetProvider sheet={casinoSheet}>

                    <ambientLight color={"#FFFFFF"} intensity={1} />

                    <AnyModel modelURL={'casino/baccaratTable.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"baccaratTable"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />
                    <AnyModel modelURL={'casino/shuffer-transformed.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"shuffer"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />
                    <AnyModel modelURL={'casino/hall.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"hall"} position={[0, 0, 0]} rotation={[0, 0, 0]} scale={[1, 1, 1]} visible={true} />
                    <PerspectiveCamera theatreKey="FirstPersonCamera" makeDefault={isOpeningFirstCard} position={[0, 2, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />

                    <color attach='background' args={['black']} />

                    <SingleLoadManager sequence={casinoSheet.sequence} loadPoint={6} onSequencePass={() => {
                        setShowCasinoForm(true);
                    }} />
                    <SingleLoadManager sequence={casinoSheet.sequence} loadPoint={10} onSequencePass={() => {
                        setShowPlaceBets(true);
                    }} />

                    {showComponents.cardCover1_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][0]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"cardCover1_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[18, 19, 20, 21, 22, 23, 24, 25, 26]} onClickPass={async () => { await openCard1Player(); }} onHoldPass={async () => { await openCard1Player(true); }} />}
                    {showComponents.cardCover1_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][0]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"cardCover1_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[32, 33, 34, 35, 36, 37, 38, 39, 40]} onClickPass={async () => { await openCard1Banker(); }} onHoldPass={async () => { await openCard1Banker(true); }} />}
                    {showComponents.cardCover3_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][2]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"cardCover3_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[46, 47, 48, 49, 50, 51, 52, 53, 54]} onClickPass={async () => { await openCard3Player(); }} onHoldPass={async () => { await openCard3Player(true); }} />}

                    {showComponents.card1_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][0]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"card1_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[18, 19, 20, 21, 22, 23, 24, 25, 26]} onClickPass={async () => { await openCard1Player(); }} onHoldPass={async () => { await openCard1Player(true); }} />}

                    {showComponents.card1_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][0]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"card1_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[32, 33, 34, 35, 36, 37, 38, 39, 40]} onClickPass={async () => { await openCard1Banker(); }} onHoldPass={async () => { await openCard1Banker(true); }} />}

                    {showComponents.card3_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][2]) : 'casino/cards/spades_1.glb'} sequence={casinoSheet.sequence} useTheatre={true} theatreKey={"card3_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[46, 47, 48, 49, 50, 51, 52, 53, 54]} onClickPass={async () => { await openCard3Player(); }} onHoldPass={async () => { await openCard3Player(true); }} />}
                </SheetProvider>

                <SheetProvider sheet={card2Sheet}>

                    <PerspectiveCamera theatreKey="SecondPersonCamera" makeDefault={!isOpeningFirstCard} position={[0, 2, 0]} rotation={[0, 0, 0]} fov={75} near={0.01} />
                    {showComponents.cardCover2_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][1]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"cardCover2_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[5, 6, 7, 8, 9, 10, 11, 12, 13]} onClickPass={async () => { await openCard2Player(); }} onHoldPass={async () => { await openCard2Player(true); }} />}
                    {showComponents.cardCover2_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][1]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"cardCover2_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[18, 19, 20, 21, 22, 23, 24, 25, 26]} onClickPass={async () => { await openCard2Banker(); }} onHoldPass={async () => { await openCard2Banker(true); }} />}
                    {showComponents.cardCover3_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][2]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"cardCover3_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[32, 33, 34, 35, 36, 37, 38, 39, 40]} onClickPass={async () => { await openCard3Banker(); }} onHoldPass={async () => { await openCard3Banker(true); }} />}
                    {showComponents.card2_player && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[0][1]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"card2_player"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[5, 6, 7, 8, 9, 10, 11, 12, 13]} onClickPass={async () => { await openCard2Player(); }} onHoldPass={async () => { await openCard2Player(true); }} />}
                    {showComponents.card2_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][1]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"card2_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[18, 19, 20, 21, 22, 23, 24, 25, 26]} onClickPass={async () => { await openCard2Banker(); }} onHoldPass={async () => { await openCard2Banker(true); }} />}
                    {showComponents.card3_banker && <AnyModel modelURL={gameHands.length > 0 ? cardStringToModelUrl(gameHands[1][2]) : 'casino/cards/spades_1.glb'} sequence={card2Sheet.sequence} useTheatre={true} theatreKey={"card3_banker"} position={[0, 0, 0]} rotation={[1.5, 0, 0]} scale={[3, 3, 3]} visible={true} isMultiple={true} interactablePoints={[32, 33, 34, 35, 36, 37, 38, 39, 40]} onClickPass={async () => { await openCard3Banker(); }} onHoldPass={async () => { await openCard3Banker(true); }} />}
                </SheetProvider>

                <Chips chipSheet={chipSheet} betValue={mainBetValue} />


                <Environment
                    files={bucketURL + 'pic/warehouse.hdr'}
                    resolution={4}
                    background={false}
                    intensity={0}
                    environmentIntensity={0}
                    backgroundIntensity={0}
                />

                {!isPortraitPhoneScreen && <EffectComposer enableNormalPass>
                    <>
                        <BrightnessContrast brightness={0} contrast={0.05} />
                        <Bloom intensity={0.4} luminanceThreshold={0.3} />
                        <ToneMapping adaptive={true} />
                        <Vignette eskil={false} offset={0.1} darkness={0.3} />
                    </>
                </EffectComposer>}

            </Suspense>
        </>
    )
}

export default Casino;
