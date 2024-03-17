

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

function SingleLoadManager({ loadPoint, sequence, onSequencePass }) {
    const checkPoint = useRef(true);

    useFrame(() => {
        if (checkPoint.current) {
            if (sequence && sequence.position >= loadPoint) {
                checkPoint.current = false;
                onSequencePass();
            }
        }
    });


    return (<>
    </>
    )
}

export default SingleLoadManager;
