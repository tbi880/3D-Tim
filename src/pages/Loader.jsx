import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState, useRef, useContext } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { Progress } from 'antd';
import Lightfall from '../utils/Lightfall';

function Loader({ isIntroNeeded = true, extraContent, onFinished }) {

    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度
    const { messageApi } = useContext(GlobalNotificationContext);

    const isMobile = window.innerWidth <= 768; // 判断是否为移动端

    const centerColumn = {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
    };

    const subtitleStyle = {
        fontSize: isMobile ? '3vw' : '1.5vw',
        padding: '10px'
    }

    useEffect(() => {
        return () => {
            if (onFinished) {
                onFinished();
            }
        }
    }, [onFinished]);

    const timer1Ref = useRef(null);
    const timer2Ref = useRef(null);

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

    useEffect(() => {
        const checkProgress = () => {
            if (simulatedProgress === actualProgress) {
                timer1Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        messageApi(
                            'warning',
                            "Your internet is too slow! Please check your network connection and try again. The page will reload in 10 seconds if the progress remains unchanged.",
                            8,
                        )
                    }
                }, 15000);

                timer2Ref.current = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        window.location.reload();
                    }
                }, 25000); // 弹窗后10秒后检查进度是否更新
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
            <div
                style={{
                    width: '100vw',
                    height: '100vh',
                    overflow: 'hidden',
                }}
            >
                <Lightfall
                    colors={[
                        '#60A5FA',
                        '#8B5CF6',
                        '#EC4899'
                    ]}
                    backgroundColor="#050816"
                    speed={0.5}
                    streakCount={1}
                    streakWidth={1}
                    streakLength={1}
                    density={0.5}
                    glow={1}
                    twinkle={1}
                    zoom={1}
                    backgroundGlow={1.2}
                    cursorStrength={0.5}
                    cursorRadius={0.5}
                    mouseInteraction={simulatedProgress > 0}
                />

                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        ...centerColumn
                    }}
                >
                    <div style={{
                        ...centerColumn,
                        width: isMobile ? '80vw' : '60vw', // 电脑端更窄
                        padding: '10px',
                        color: 'white',
                        fontFamily: 'Orbitron, sans-serif', // 显式设置字体

                    }}>
                        <h1 style={{
                            fontSize: isMobile ? '5vw' : '3vw', // 电脑端字体更小
                            marginBottom: isMobile ? '10vw' : '5vw'
                        }}>
                            Welcome to Tim Bi's world.
                        </h1>
                        {isIntroNeeded && (
                            <>
                                <h2 style={subtitleStyle}>Ready for a 3D ride in my universe?</h2>
                                <h2 style={subtitleStyle}>I think you would know me very well after you finish this "space adventure".</h2>
                                <h2 style={subtitleStyle}>Please be patient. The first time access would take approximately 20 seconds.</h2>
                            </>
                        )}
                        {extraContent && (
                            <>
                                {extraContent.map((text, index) => (
                                    <h2 key={index} style={subtitleStyle}>{text}</h2>
                                ))}
                            </>
                        )}
                    </div>
                    <div style={{
                        ...centerColumn,
                        width: isMobile ? '80%' : '60%', // 电脑端更窄
                        paddingTop: '3vh',
                        marginTop: isMobile ? '5vh' : '2vh',
                    }}>
                        <div className="loading" style={{
                            fontSize: isMobile ? '5vw' : '2vw', // 电脑端字体更小
                            color: 'white',
                            textAlign: 'center'
                        }}>
                            {Math.ceil(simulatedProgress)} % loaded
                        </div>
                        <Progress
                            percent={simulatedProgress}
                            status="active"
                            strokeColor={{
                                from: '#108ee9',
                                to: '#add8e6',
                            }}
                            percentPosition={{
                                align: 'center',
                                type: 'outer',
                            }}
                            showInfo={false}
                        />
                    </div>
                </div>
            </div>
        </Html>
    );
}

export default Loader;
