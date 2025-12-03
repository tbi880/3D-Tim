import { useCallback, useEffect, useRef } from "react";
import { onChange, val } from '@theatre/core';
import { all } from "axios";

export function useCasinoControl({
    casinoSheet = null,
    card2Sheet = null,
    chipSheet = null,
    showComponents = {},
    toggleComponentDisplay = () => { },
    setShowPlaceBets = () => { },
    setShowSwitchCard = () => { },
    setIsOpeningFirstCard = () => { },
    mainBetChoiceRef = null,
    changeUserStatusInRoom = async () => { },
    resetRoundState = () => { },
    setBaccaratPointDisplayManager = () => { },
} = {}) {

    async function waitForSequenceThen(sheet, action, destinationPosition = null) {
        if (!sheet || !sheet.sequence) {
            return;
        }

        const seq = sheet.sequence;

        if (!seq.pointer.playing) {
            return action();
        }

        await new Promise((resolve) => {
            let off;
            off = onChange(seq.pointer.playing, (playing) => {
                if (!playing) {
                    if (off) off();
                    resolve();
                    if (destinationPosition != null && seq.position >= destinationPosition) {
                        return;
                    }
                }
            });
        });

        return action();
    }


    const placeBetOnPlayer = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [0, 1] });
    }, [chipSheet]);

    const loseBetOnPlayer = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [2, 3] });
    }, [chipSheet]);

    const winBetOnPlayer = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [4, 6] });
    }, [chipSheet]);

    const placeBetOnBanker = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [7, 8] });
    }, [chipSheet]);

    const loseBetOnBanker = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [9, 10] });
    }, [chipSheet]);

    const winBetOnBanker = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [11, 13] });
    }, [chipSheet]);

    const placeBetOnTie = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [14, 15] });
    }, [chipSheet]);

    const loseBetOnTie = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [16, 17] });
    }, [chipSheet]);

    const winBetOnTie = useCallback(() => {
        if (!chipSheet) return;
        chipSheet.sequence.play({ range: [18, 20] });
    }, [chipSheet]);

    // deal cards actions


    const dealFirst4Cards = useCallback(async () => {
        if (!casinoSheet || !card2Sheet || !chipSheet) return;

        await waitForSequenceThen(chipSheet, async () => {
            const p1 = casinoSheet.sequence.play({ range: [11, 16] });
            const p2 = card2Sheet.sequence.play({ range: [0, 4] });

            await Promise.all([p1, p2]);
            setShowSwitchCard(true);
        });

    }, [casinoSheet, card2Sheet, chipSheet, waitForSequenceThen, setShowSwitchCard]);

    const openCard1Player = useCallback(async (openNow = false) => {
        if (!casinoSheet || !card2Sheet) return;

        if (casinoSheet.sequence.position < 18) {
            await waitForSequenceThen(casinoSheet, async () => {
                await casinoSheet.sequence.play({ range: [16, 18] });
            }, 18);
            return;
        }

        let nextTime = casinoSheet.sequence.position + 1;

        if (casinoSheet.sequence.position < 26) {
            if (openNow) {
                nextTime = 26;
            }

            await waitForSequenceThen(casinoSheet, async () => {
                if (casinoSheet.sequence.position >= nextTime) return;
                await casinoSheet.sequence.play({ range: [casinoSheet.sequence.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (casinoSheet.sequence.position >= 26) {
                setShowSwitchCard(false);
                await waitForSequenceThen(casinoSheet, async () => {
                    if (casinoSheet.sequence.position >= 29) return;
                    await casinoSheet.sequence.play({ range: [26, 29], rate: openNow ? 5 : 1 });
                });
                setBaccaratPointDisplayManager(prev => ({ ...prev, player1: true }));
                await waitForSequenceThen(casinoSheet, async () => {
                    setIsOpeningFirstCard(false);
                    if (card2Sheet.sequence.position === 16) {
                        await playerAfterOpenTwoCards(showComponents);
                    }
                });

            }
        }
    }, [casinoSheet, card2Sheet, setShowSwitchCard, setIsOpeningFirstCard, showComponents, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const openCard2Player = useCallback(async (openNow = false) => {
        if (!card2Sheet || !casinoSheet) return;

        if (card2Sheet.sequence.position < 5) {
            await waitForSequenceThen(card2Sheet, async () => {
                await card2Sheet.sequence.play({ range: [4, 5] });
            }, 5);
            return;
        }

        const seq = card2Sheet.sequence;
        let nextTime = seq.position + 1;
        if (openNow) {
            nextTime = 13;
        }

        if (seq.position < 13) {
            await waitForSequenceThen(card2Sheet, async () => {
                if (seq.position >= nextTime) return;
                await seq.play({ range: [seq.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (seq.position >= 13) {
                setShowSwitchCard(false);

                await waitForSequenceThen(card2Sheet, async () => {
                    if (seq.position >= 16) return;
                    await seq.play({ range: [13, 16], rate: openNow ? 5 : 1 });
                });
                setBaccaratPointDisplayManager(prev => ({ ...prev, player2: true }));

                await waitForSequenceThen(card2Sheet, async () => {
                    setIsOpeningFirstCard(true);
                    if (casinoSheet.sequence.position === 29) {
                        await playerAfterOpenTwoCards(showComponents);
                    }
                });
            }
        }
    }, [card2Sheet, casinoSheet, setShowSwitchCard, setIsOpeningFirstCard, showComponents, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const openCard1Banker = useCallback(async (openNow = false) => {
        if (!casinoSheet || !card2Sheet) return;

        if (casinoSheet.sequence.position < 32) {
            await waitForSequenceThen(casinoSheet, async () => {
                await casinoSheet.sequence.play({ range: [30, 32] });
            }, 32);
            return;
        }

        const seq = casinoSheet.sequence;
        let nextTime = seq.position + 1;
        if (openNow) {
            nextTime = 40;
        }

        if (seq.position < 40) {
            await waitForSequenceThen(casinoSheet, async () => {
                if (seq.position >= nextTime) return;
                await seq.play({ range: [seq.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (seq.position >= 40) {
                setShowSwitchCard(false);

                await waitForSequenceThen(casinoSheet, async () => {
                    if (seq.position >= 43) return;
                    await seq.play({ range: [40, 43], rate: openNow ? 5 : 1 });
                });

                await waitForSequenceThen(casinoSheet, async () => {
                    setIsOpeningFirstCard(false);
                    setBaccaratPointDisplayManager(prev => ({ ...prev, banker1: true }));

                    if (card2Sheet.sequence.position === 29) {
                        await bankerAfterOpenTwoCards(showComponents);
                    }
                });
            }
        }
    }, [casinoSheet, card2Sheet, showComponents, setShowSwitchCard, setIsOpeningFirstCard, setBaccaratPointDisplayManager]);

    const openCard2Banker = useCallback(async (openNow = false) => {
        if (!card2Sheet || !casinoSheet) return;

        if (card2Sheet.sequence.position < 18) {
            await waitForSequenceThen(card2Sheet, async () => {
                await card2Sheet.sequence.play({ range: [17, 18] });
            }, 18);
            return;
        }

        const seq = card2Sheet.sequence;
        let nextTime = seq.position + 1;
        if (openNow) {
            nextTime = 26;
        }

        if (seq.position < 26) {
            await waitForSequenceThen(card2Sheet, async () => {
                if (seq.position >= nextTime) return;
                await seq.play({ range: [seq.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (seq.position >= 26) {
                setShowSwitchCard(false);

                await waitForSequenceThen(card2Sheet, async () => {
                    if (seq.position >= 29) return;
                    await seq.play({ range: [26, 29], rate: openNow ? 5 : 1 });
                });
                setBaccaratPointDisplayManager(prev => ({ ...prev, banker2: true }));

                await waitForSequenceThen(card2Sheet, async () => {
                    setIsOpeningFirstCard(true);
                    if (casinoSheet.sequence.position === 43) {
                        await bankerAfterOpenTwoCards(showComponents);
                    }
                });
            }
        }
    }, [card2Sheet, casinoSheet, showComponents, setShowSwitchCard, setIsOpeningFirstCard, setBaccaratPointDisplayManager]);

    const openPlayer1And2CardsFree = useCallback(async () => {
        if (!casinoSheet || !card2Sheet) return;
        await waitForSequenceThen(casinoSheet, async () => {
            await casinoSheet.sequence.play({ range: [28, 29] });
            setBaccaratPointDisplayManager(prev => ({ ...prev, player1: true }));
        });
        await waitForSequenceThen(card2Sheet, async () => {
            await card2Sheet.sequence.play({ range: [15, 16] });
            setBaccaratPointDisplayManager(prev => ({ ...prev, player2: true }));
        });
    }, [casinoSheet, card2Sheet, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const openBanker1And2CardsFree = useCallback(async () => {
        if (!casinoSheet || !card2Sheet) return;

        await Promise.all([
            waitForSequenceThen(card2Sheet, async () => {
                await card2Sheet.sequence.play({ range: [28, 29] });
                setBaccaratPointDisplayManager(prev => ({ ...prev, banker1: true }));
            }),
            waitForSequenceThen(casinoSheet, async () => {
                await casinoSheet.sequence.play({ range: [42, 43] });
                setBaccaratPointDisplayManager(prev => ({ ...prev, banker2: true }));
            })
        ]);
    }, [casinoSheet, card2Sheet, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const dealPlayer3Card = useCallback(async () => {
        if (!casinoSheet) return;
        if (!showComponents.card3_player) {
            toggleComponentDisplay("card3_player");
            toggleComponentDisplay("cardCover3_player");
        }
        await waitForSequenceThen(casinoSheet, async () => {
            await casinoSheet.sequence.play({ range: [44, 45] });
        });
    }, [casinoSheet, showComponents, toggleComponentDisplay]);

    const openCard3Player = useCallback(async (openNow = false) => {
        if (!casinoSheet) return;

        if (casinoSheet.sequence.position < 46) {
            await waitForSequenceThen(casinoSheet, async () => {
                await casinoSheet.sequence.play({ range: [45, 46] });
            }, 46);
            return;
        }

        const seq = casinoSheet.sequence;
        let nextTime = seq.position + 1;
        if (openNow) {
            nextTime = 54;
        }
        if (seq.position < 54) {
            await waitForSequenceThen(casinoSheet, async () => {
                if (seq.position >= nextTime) return;
                await seq.play({ range: [seq.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (seq.position >= 54) {
                await waitForSequenceThen(casinoSheet, async () => {
                    if (seq.position >= 57) return;
                    await seq.play({ range: [54, 57], rate: openNow ? 5 : 1 });
                });
                setBaccaratPointDisplayManager(prev => ({ ...prev, player3: true }));

                await waitForSequenceThen(casinoSheet, async () => {
                    playerAfterOpenThreeCards(showComponents);
                });
            }
        }
    }, [casinoSheet, showComponents, waitForSequenceThen, setBaccaratPointDisplayManager]);


    const openPlayer3CardFree = useCallback(async () => {
        if (!casinoSheet) return;
        await waitForSequenceThen(casinoSheet, async () => {
            await casinoSheet.sequence.play({ range: [56, 57] });
            setBaccaratPointDisplayManager(prev => ({ ...prev, player3: true }));
        });
    }, [casinoSheet, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const dealBanker3Card = useCallback(async () => {
        if (!casinoSheet || !card2Sheet) return;
        if (!showComponents.card3_banker) {
            toggleComponentDisplay("card3_banker");
            toggleComponentDisplay("cardCover3_banker");
        }
        await waitForSequenceThen(casinoSheet, async () => {
            await card2Sheet.sequence.play({ range: [30, 31] });
        });
    }, [card2Sheet, casinoSheet, showComponents, toggleComponentDisplay]);

    const openCard3Banker = useCallback(async (openNow = false) => {
        if (!card2Sheet) return;

        if (card2Sheet.sequence.position < 32) {
            await waitForSequenceThen(card2Sheet, async () => {
                await card2Sheet.sequence.play({ range: [31, 32] });
            }, 32);
            return;
        }

        const seq = card2Sheet.sequence;
        let nextTime = seq.position + 1;
        if (openNow) {
            nextTime = 40;
        }
        if (seq.position < 40) {
            await waitForSequenceThen(card2Sheet, async () => {
                if (seq.position >= nextTime) return;
                await seq.play({ range: [seq.position, nextTime], rate: openNow ? 5 : 1 });
            });

            if (seq.position >= 40) {
                await waitForSequenceThen(card2Sheet, async () => {
                    if (seq.position >= 43) return;
                    await seq.play({ range: [40, 43], rate: openNow ? 5 : 1 });
                });
                setBaccaratPointDisplayManager(prev => ({ ...prev, banker3: true }));
                await waitForSequenceThen(card2Sheet, async () => {
                    await changeUserStatusInRoom("results");
                });
            }
        }
    }, [card2Sheet, waitForSequenceThen, setBaccaratPointDisplayManager]);


    const openBanker3CardFree = useCallback(async () => {
        if (!card2Sheet) return;
        await waitForSequenceThen(card2Sheet, async () => {
            await card2Sheet.sequence.play({ range: [42, 43] });
            setBaccaratPointDisplayManager(prev => ({ ...prev, banker3: true }));
        });
    }, [card2Sheet, waitForSequenceThen, setBaccaratPointDisplayManager]);

    const playerAfterOpenTwoCardsIsPlaying = useRef(false);

    async function playerAfterOpenTwoCards(showComponents) {
        if (playerAfterOpenTwoCardsIsPlaying.current) {
            return;
        }
        playerAfterOpenTwoCardsIsPlaying.current = true;
        await openBanker1And2CardsFree();
        if ((!showComponents.card3_player) && (!showComponents.card3_banker)) {
            await changeUserStatusInRoom("results");
        }
        else if (showComponents.card3_player) {
            setIsOpeningFirstCard(true);
            await dealPlayer3Card();
            await openCard3Player();
        }
        else if (showComponents.card3_banker) {
            await dealBanker3Card();
            await openBanker3CardFree();
            await changeUserStatusInRoom("results");
        }
        playerAfterOpenTwoCardsIsPlaying.current = false;
    }

    const bankerAfterOpenTwoCardsIsPlaying = useRef(false);
    async function bankerAfterOpenTwoCards(showComponents) {
        if (bankerAfterOpenTwoCardsIsPlaying.current) {
            return;
        }
        bankerAfterOpenTwoCardsIsPlaying.current = true;
        if ((!showComponents.card3_player) && (!showComponents.card3_banker)) {
            await changeUserStatusInRoom("results");
            bankerAfterOpenTwoCardsIsPlaying.current = false;
            return;
        }
        if (showComponents.card3_player) {
            await dealPlayer3Card();
            await openPlayer3CardFree();
        }
        if (showComponents.card3_banker) {
            setIsOpeningFirstCard(false);
            await dealBanker3Card();
            await openCard3Banker();
            bankerAfterOpenTwoCardsIsPlaying.current = false;
            return;
        }
        await changeUserStatusInRoom("results");
        bankerAfterOpenTwoCardsIsPlaying.current = false;
    }

    const playerAfterOpenThreeCardsIsPlaying = useRef(false);
    async function playerAfterOpenThreeCards(showComponents) {
        if (playerAfterOpenThreeCardsIsPlaying.current) {
            return;
        }
        playerAfterOpenThreeCardsIsPlaying.current = true;
        if (showComponents.card3_banker) {
            await dealBanker3Card();
            await openBanker3CardFree();
        }
        await changeUserStatusInRoom("results");
        playerAfterOpenThreeCardsIsPlaying.current = false;
    }

    const removeAllCards = useCallback(async () => {
        if (!casinoSheet || !card2Sheet || !chipSheet) return;
        await waitForSequenceThen(chipSheet, async () => {
            return;
        });
        await waitForSequenceThen(card2Sheet, async () => {
            casinoSheet.sequence.play({ range: [58, 59] });
            await card2Sheet.sequence.play({ range: [44, 45] });
        });

        if (showComponents.card3_player) {
            toggleComponentDisplay("card3_player");
            toggleComponentDisplay("cardCover3_player");
        }
        if (showComponents.card3_banker) {
            toggleComponentDisplay("card3_banker");
            toggleComponentDisplay("cardCover3_banker");
        }
        setBaccaratPointDisplayManager({ player1: false, player2: false, player3: false, banker1: false, banker2: false, banker3: false, finalResult: false });
        resetRoundState();
        setShowPlaceBets(true);
        setShowSwitchCard(false);
    }, [casinoSheet, card2Sheet, chipSheet, showComponents, toggleComponentDisplay, setShowPlaceBets, resetRoundState]);

    return {
        placeBetOnPlayer,
        loseBetOnPlayer,
        winBetOnPlayer,
        placeBetOnBanker,
        loseBetOnBanker,
        winBetOnBanker,
        placeBetOnTie,
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
    };
}

export default useCasinoControl;
