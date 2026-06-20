import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState, useRef, useContext } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { Progress } from 'antd';
import Lightfall from '../utils/Lightfall';

function Loader({ isIntroNeeded = true, extraContent, onFinished, onFadeComplete }) {

    const { progress: actualProgress, active } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度
    const { messageApi } = useContext(GlobalNotificationContext);

    const isMobile = window.innerWidth <= 768; // 判断是否为移动端

    const [isFadingOut, setIsFadingOut] = useState(false);
    const FADE_DURATION = 1600;

    const ZOOM_START = 1;
    const ZOOM_END = 5;
    const easeInCubic = (t) => t * t * t;

    const zoomRafRef = useRef(null);
    const lightfallRef = useRef();

    useEffect(() => {
        if (!active && simulatedProgress >= 100 && !isFadingOut) {
            setIsFadingOut(true);
        }
    }, [active, simulatedProgress, isFadingOut]);


    useEffect(() => {
        if (!isFadingOut) return;

        const start = performance.now();

        const tick = (now) => {
            const t =
                Math.min(
                    (now - start) / FADE_DURATION,
                    1
                );

            const zoom =
                ZOOM_START +
                (ZOOM_END - ZOOM_START)
                *
                easeInCubic(t);

            lightfallRef.current?.setZoom(zoom);

            if (t < 1)
                zoomRafRef.current =
                    requestAnimationFrame(tick);
        }

        zoomRafRef.current = requestAnimationFrame(tick);
        return () => {
            if (zoomRafRef.current) {
                cancelAnimationFrame(
                    zoomRafRef.current
                );
            }
        };
    }, [isFadingOut]);


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
        if (simulatedProgress >= actualProgress) return;

        const timer = setTimeout(() => {
            setSimulatedProgress(prev =>
                Math.min(prev + 2, actualProgress)
            );
        }, 100);

        return () => clearTimeout(timer);
    }, [simulatedProgress, actualProgress]);

    const warningTimer = useRef();
    const reloadTimer = useRef();

    useEffect(() => {
        clearTimeout(warningTimer.current);
        clearTimeout(reloadTimer.current);

        if (simulatedProgress !== actualProgress) {
            return;
        }

        warningTimer.current = setTimeout(() => {
            if (simulatedProgress === actualProgress) {
                messageApi(
                    'warning',
                    'Your internet is too slow! Please check your network connection and try again. The page will reload in 10 seconds if the progress remains unchanged.',
                    8
                );
            }
        }, 7500);

        reloadTimer.current = setTimeout(() => {
            if (simulatedProgress === actualProgress) {
                window.location.reload();
            }
        }, 12500);

        return () => {
            clearTimeout(warningTimer.current);
            clearTimeout(reloadTimer.current);
        };
    }, [simulatedProgress, actualProgress, messageApi]);

    useEffect(() => {
        const onlineHandler = () => { };
        const offlineHandler = () => window.location.reload();

        window.addEventListener('online', onlineHandler);
        window.addEventListener('offline', offlineHandler);

        return () => {
            window.removeEventListener('online', onlineHandler);
            window.removeEventListener('offline', offlineHandler);
        };
    }, []);

    return (
        <Html center>
            <div
                style={{
                    width: '100vw',
                    height: '100vh',
                    overflow: 'hidden',
                    opacity: isFadingOut ? 0 : 1,
                    transition: `opacity ${FADE_DURATION}ms cubic-bezier(0.7, 0, 1, 1)`,
                    pointerEvents: isFadingOut ? 'none' : 'auto',
                }}
                onTransitionEnd={(e) => {
                    if (e.target === e.currentTarget && e.propertyName === 'opacity' && isFadingOut) {
                        onFadeComplete?.(); // <-- resolves the gate, letting Suspense swap
                    }
                }}
            >
                <Lightfall
                    colors={[
                        '#60A5FA',
                        '#8B5CF6',
                        '#EC4899'
                    ]}
                    ref={lightfallRef}
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
                    cursorRadius={0.1}
                    mouseInteraction={simulatedProgress > 0 && simulatedProgress < 100}
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
