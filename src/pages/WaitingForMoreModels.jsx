import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState } from 'react';
import { Notification } from './Loader';

const codelineOne = "if (userHasInternetHoweverItIsNotFast){"
const codelineTwo = "    return ThisPageThatYouAreLookingAtRightNow;"
const codelineThree = "}"

function WaitingForMoreModels({ textColor = "black" }) {
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度



    useEffect(() => {
        // 如果模拟进度小于实际进度，则逐渐增加模拟进度
        if (simulatedProgress < actualProgress) {
            const timerId = setTimeout(() => {
                setSimulatedProgress(prevProgress => Math.min(prevProgress + 1, actualProgress));
            }, 100); // 每100毫秒模拟进度增加1%
            return () => {
                clearTimeout(timerId);
            }
        }

        // 如果模拟进度已经达到100%，但实际加载进度尚未完成，可以选择保持模拟进度在99%，给用户一个正在完成加载的感觉
        if (simulatedProgress >= 100 && actualProgress < 100) {
            setSimulatedProgress(99);
        }
    }, [simulatedProgress, actualProgress]);

    const [showNotification, setShowNotification] = useState(false);

    useEffect(() => {
        let timer;
        const checkProgress = () => {
            if (simulatedProgress === actualProgress) {
                timer = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        setShowNotification(true);
                    }
                }, 7000);
                timer = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        window.location.reload();
                    } else {
                        setShowNotification(false);
                    }
                }, 10000); // 8秒后检查进度是否更新
            }
        };

        checkProgress();

        window.addEventListener('online', checkProgress);
        window.addEventListener('offline', () => {
            window.location.reload();
        });

        return () => {
            clearTimeout(timer);
            window.removeEventListener('online', checkProgress);
            window.removeEventListener('offline', () => {
                window.location.reload();
            });
        };
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
                <h1 style={{ fontSize: '4vw', color: textColor }}>Loading For More Context...</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px', color: textColor }}>{codelineOne}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px', color: textColor }}>{codelineTwo}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px', color: textColor }}>{codelineThree}</h1>
                <div className="loading" style={{ fontSize: '5vw', color: textColor }}>{Math.ceil(simulatedProgress)} % loaded</div>
                <Notification message="Please check your network connection and try again. The page will reload in 3 seconds if the progress remains unchanged." show={showNotification} />

            </div>
        </Html>
    );
}

export default WaitingForMoreModels;