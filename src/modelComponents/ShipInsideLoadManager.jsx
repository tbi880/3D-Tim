import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

function ShipInsideLoadManager({ sequence, onSequencePass }) {
    const checkPoint = useRef(true);

    useFrame(() => {
        if (checkPoint.current) {
            if (sequence && sequence.position >= 30.5) {
                checkPoint.current = false;
                onSequencePass();
            }
        }
    });


    return (<>
    </>
    )
}

export default ShipInsideLoadManager;
