import { createContext, useRef, useState } from "react";


export const SheetSequencePlayControlContext = createContext();

export const SheetSequencePlayControlProvider = ({ children }) => {

    const isSequencePlaying = useRef(false);
    const rate = useRef(1);
    const targetPosition = useRef(null);

    const setIsSequencePlaying = (value) => {
        isSequencePlaying.current = value;
    }

    const setRate = (value) => {
        rate.current = value;
    }

    const setTargetPosition = (value) => {
        targetPosition.current = value;
    }

    const playOnce = ({ sequence, range }) => {
        setIsSequencePlaying(true);
        setTargetPosition(range[1]);
        if (targetPosition.current > range[0]) {
            sequence.play({ range: range, rate: rate.current }).then((result) => { setIsSequencePlaying(false); });
        }
    }

    return (
        <SheetSequencePlayControlContext.Provider value={{ isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce }}>
            {children}
        </SheetSequencePlayControlContext.Provider>

    );
};
