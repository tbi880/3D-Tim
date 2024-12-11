import { Tour } from 'antd';


const TourGuide = ({ stepsConfig, onClose, open, onChange }) => {
    const steps = stepsConfig.map(step => ({
        ...step,
        target: () => step.ref.current
    }));

    return <Tour open={open} onClose={onClose} steps={steps} disabledInteraction={true} zIndex={99999} onChange={onChange} />;
};

export default TourGuide;