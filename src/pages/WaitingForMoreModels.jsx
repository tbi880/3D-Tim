import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState } from 'react';


function WaitingForMoreModels() {
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度



    useEffect(() => {
        // 如果模拟进度小于实际进度，则逐渐增加模拟进度
        if (simulatedProgress < actualProgress) {
            const timerId = setTimeout(() => {
                setSimulatedProgress(prevProgress => Math.min(prevProgress + 1, actualProgress));
            }, 100); // 每100毫秒模拟进度增加1%
            return () => clearTimeout(timerId);
        }

        // 如果模拟进度已经达到100%，但实际加载进度尚未完成，可以选择保持模拟进度在99%，给用户一个正在完成加载的感觉
        if (simulatedProgress >= 100 && actualProgress < 100) {
            setSimulatedProgress(99);
        }
    }, [simulatedProgress, actualProgress]);



    return (
        <Html center>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100vw',
                backgroundColor: 'white',
                padding: '10px',
            }}>
                <h1 style={{ fontSize: '4vw' }}>Loading For More Context...</h1>
                <h1 style={{ fontSize: '4vw' }}>You won't see this if you have better internet so go blame yourself for this</h1>
                <div className="loading" style={{ fontSize: '5vw' }}>{Math.ceil(simulatedProgress)} % loaded</div>
            </div>
        </Html>
    );
}

export default WaitingForMoreModels;