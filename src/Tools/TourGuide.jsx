import { Tour } from 'antd';
import React from 'react';


const TourGuide = React.forwardRef((props, ref) => {
    const { stepsConfig, onClose, open, onChange } = props;
    const steps = stepsConfig.map(step => ({
        ...step,
        target: () => step.ref.current
    }));

    return <Tour open={open} onClose={onClose} steps={steps} disabledInteraction={true} zIndex={99999} onChange={onChange} />;
});

export default TourGuide;