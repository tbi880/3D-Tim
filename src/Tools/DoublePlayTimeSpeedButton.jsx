import { useContext, useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faForward } from '@fortawesome/free-solid-svg-icons';
import './css/general.css';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';
import { useLocation } from 'wouter';


export function DoublePlayTimeSpeedButton({ sheetSequence }) {
    const [doublePlayTimeSpeed, setDoublePlayTimeSpeed] = useState(false);
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);
    const [uri, setUri] = useState('');
    const [location, setLocation] = useLocation();

    const handleDoublePlayTimeSpeed = () => {
        setDoublePlayTimeSpeed((prevValue) => !prevValue);
    }


    const setSpeedWhenIsPlaying = () => {
        if (doublePlayTimeSpeed) {
            setRate(2);
            playOnce({ sequence: sheetSequence, range: [sheetSequence.position, targetPosition.current] });
        } else {
            setRate(1);
            playOnce({ sequence: sheetSequence, range: [sheetSequence.position, targetPosition.current] });
        }
    }

    useEffect(() => {
        if (location !== uri) {
            setUri(location);
            setDoublePlayTimeSpeed(false);
            setIsSequencePlaying(false);
            setRate(1);
            setTargetPosition(0);
        }
    }, [location]);


    useEffect(() => {
        if (sheetSequence) {
            if (isSequencePlaying) {
                setSpeedWhenIsPlaying(sheetSequence);
            }
            else {
                setRate(doublePlayTimeSpeed ? 2 : 1);
            }
        }
    }, [sheetSequence, doublePlayTimeSpeed])


    return (
        <button
            className="double-speed-button"
            onClick={handleDoublePlayTimeSpeed}
        >
            {doublePlayTimeSpeed ? <FontAwesomeIcon icon={faForward} /> : <FontAwesomeIcon icon={faPlay} />}
        </button>
    );
}

export default DoublePlayTimeSpeedButton;
