import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState, useRef } from 'react';
import "../Tools/css/notification.css";

export function Notification({ message, show }) {
    return (
        <div className={`notification ${show ? 'show' : ''}`}>
            {message}
        </div>
    );
}

function Loader() {
    const stories = [
        "In the distant future,", "humanity has mastered the technology of interstellar travel,", "but the universe remains full of unknowns...",
        "You are about to awaken on a starship that has been voyaging for centuries,", "time has passed so long that Captain Tim Bi has been gone forever,",
        "You don't remember anything before your hibernation,", "only that you designed this starship, familiar with every corner of it,", "and vaguely remember that the destination is humanity's new home...",
        "Suddenly, an alarm sound and intense vibrations alert you to the severity of the situation,", "you are unsure if this centuries-old vessel can withstand this sudden 'surprise'",
        "You must awaken quickly,", "check the extent of the damage to the ship,", "gain the AI's trust to get authorized, thus changing the course.", "The lives of all surviving crew members are in your hands now"
    ];
    const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度

    // 使用 useRef 存储计时器引用
    const storyTimerRef = useRef(null);
    const timer1Ref = useRef(null);
    const timer2Ref = useRef(null);

    useEffect(() => {
        // 故事增加逻辑
        storyTimerRef.current = setInterval(() => {
            setCurrentStoryIndex(prevIndex => {
                if (prevIndex < stories.length - 1) {
                    return prevIndex + 1;
                } else {
                    // 清除计时器
                    clearInterval(storyTimerRef.current);
                    return prevIndex;
                }
            });
        }, 500);

        return () => clearInterval(storyTimerRef.current);
    }, []);

    useEffect(() => {
        // 模拟加载进度
        if (simulatedProgress < actualProgress) {
            const timerId = setTimeout(() => {
                setSimulatedProgress(prevProgress => Math.min(prevProgress + 1, actualProgress));
            }, 20);
            return () => clearTimeout(timerId);
        } else if (simulatedProgress >= 100 && actualProgress < 100) {
            setSimulatedProgress(99);
        }
    }, [simulatedProgress, actualProgress]);

    const [showNotification, setShowNotification] = useState(false);

    useEffect(() => {
        const checkProgress = () => {
            if (simulatedProgress === actualProgress) {
                timer1Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        setShowNotification(true);
                    }
                }, 7000);

                timer2Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        window.location.reload();
                    } else {
                        setShowNotification(false);
                    }
                }, 17000); // 弹窗后10秒后检查进度是否更新
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
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100vw',
                padding: '10px',
                color: 'black',
            }}>
                <h1 style={{ fontSize: '4vw' }}>Welcome to Tim Bi's world.</h1>
                <h2 style={{ fontSize: '3vw' }}>Ready for a 3D ride in my universe?</h2>
                <h2 style={{ fontSize: '3vw', padding: '10px' }}>I think you would know me very well after you finish this "adventure"</h2>
                <h2 style={{ fontSize: '3vw', padding: '10px' }}>Please be patient. The first time access would take approximately 20 seconds.</h2>
                <div className="loading" style={{ fontSize: '5vw' }}>{Math.ceil(simulatedProgress)} % loaded</div>
                <div style={{ padding: '10px' }}>
                    {stories.slice(0, currentStoryIndex + 1).map((story, index) => (
                        <p key={index} className="story" style={{ animation: `fadeIn 2s ease-out`, fontSize: '2.5vw' }}>{story}</p>
                    ))}
                </div>
                <Notification
                    message="Your internet is too slow! Please check your network connection and try again. The page will reload in 10 seconds if the progress remains unchanged."
                    show={showNotification}
                />
            </div>
        </Html>
    );
}

export default Loader;