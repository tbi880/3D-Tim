

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

function InfoScreenDisplayStarShipInfoLoadManager({ sequence, onSequencePass }) {
    const checkPoint = useRef(true);

    useFrame(() => {
        if (checkPoint.current) {
            if (sequence && sequence.position >= 29.5) {
                checkPoint.current = false;
                onSequencePass();
            }
        }
    });


    return (<>
    </>
    )
}

export default InfoScreenDisplayStarShipInfoLoadManager;
