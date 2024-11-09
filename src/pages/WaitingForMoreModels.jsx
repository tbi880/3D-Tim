import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState, useRef } from 'react';
import { Notification } from './Loader';

const codelineOne = "if (userHasInternetHoweverItIsNotFast){";
const codelineTwo = "    return ThisPageThatYouAreLookingAtRightNow;";
const codelineThree = "}";

function WaitingForMoreModels({ textColor = "black", onFinished }) {
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度
    const [showNotification, setShowNotification] = useState(false);

    useEffect(() => {

        return () => {
            if (onFinished) {
                onFinished();
            }
        }
    }, [onFinished]);

    // 使用 useRef 存储计时器引用
    const timer1Ref = useRef(null);
    const timer2Ref = useRef(null);

    useEffect(() => {
        if (simulatedProgress < actualProgress) {
            const timerId = setTimeout(() => {
                setSimulatedProgress(prevProgress => Math.min(prevProgress + 1, actualProgress));
            }, 100); // 每100毫秒模拟进度增加1%
            return () => clearTimeout(timerId);
        } else if (simulatedProgress >= 100 && actualProgress < 100) {
            setSimulatedProgress(99);
        }
    }, [simulatedProgress, actualProgress]);

    useEffect(() => {
        const checkProgress = () => {
            if (simulatedProgress === actualProgress) {
                timer1Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        setShowNotification(true);
                    }
                }, 7000); // 7秒后显示通知

                timer2Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        window.location.reload();
                    } else {
                        setShowNotification(false);
                    }
                }, 17000); // 17秒后重新加载页面
            }
        };

        checkProgress();

        const onlineHandler = () => checkProgress();
        const offlineHandler = () => window.location.reload();

        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);

        return () => {
            clearTimeout(timer1Ref.current);
            clearTimeout(timer2Ref.current);
            window.removeEventListener('online', onlineHandler);
            window.removeEventListener('offline', offlineHandler);
        };
    }, [simulatedProgress, actualProgress]);

    return (
        <Html center>
            <div style={styles.container}>
                <h1 style={{ ...styles.header, color: textColor }}>Loading For More Context...</h1>
                <h1 style={{ ...styles.codeLine, color: textColor }}>{codelineOne}</h1>
                <h1 style={{ ...styles.codeLine, color: textColor }}>{codelineTwo}</h1>
                <h1 style={{ ...styles.codeLine, color: textColor }}>{codelineThree}</h1>
                <div className="loading" style={{ ...styles.loadingText, color: textColor }}>
                    {Math.ceil(simulatedProgress)}% loaded
                </div>
                <Notification
                    message="Your internet is too slow! Please check your network connection and try again. The page will reload in 10 seconds if the progress remains unchanged."
                    show={showNotification}
                />
            </div>
        </Html>
    );
}

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        backgroundColor: 'white',
        padding: '10px',
    },
    header: {
        fontSize: '4vw',
    },
    codeLine: {
        fontSize: '4vw',
        padding: '10px',
    },
    loadingText: {
        fontSize: '5vw',
    },
};

export default WaitingForMoreModels;