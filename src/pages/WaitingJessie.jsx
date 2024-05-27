import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState } from 'react';
import JessiePreAlert from '../modelComponents/JessiePreAlert';
import { Notification } from './Loader';

const codelineOne = "耐心等待哦"
const codelineTwo = "嘻嘻嘻"
const codelineThree = "If (you are Jessie) {"
const codelineFour = "    return <SceneJessie />"
const codelineFive = "}"
const codelineSix = "else {"
const codelineSeven = "    return <Page404 />"
const codelineEight = "}"

function WaitingJessie() {
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度

    const [isCrawler, setIsCrawler] = useState(false);

    useEffect(() => {
        const userAgent = navigator.userAgent;
        const crawlers = [
            'Googlebot', // 谷歌爬虫
            'Bingbot',   // 必应爬虫
            'Slurp',     // 雅虎爬虫
            'DuckDuckBot', // DuckDuckGo爬虫
            'Baiduspider', // 百度爬虫
            'YandexBot', // Yandex爬虫
            'Sogou',     // 搜狗爬虫
            'Exabot',    // Exalead爬虫
            'facebot',   // Facebook爬虫
            'ia_archiver' // Alexa爬虫
        ];

        // 检查User-Agent是否匹配上述爬虫之一
        setIsCrawler(crawlers.some(crawler => userAgent.includes(crawler)));
    }, []);

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
                }, 5000);
                timer = setTimeout(() => {
                    if (simulatedProgress === actualProgress) {
                        window.location.reload();
                    } else {
                        setShowNotification(false);
                    }
                }, 8000); // 8秒后检查进度是否更新
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
                fontFamily: '"ZCOOL KuaiLe", sans-serif',
                fontWeight: 400,
                fontStyle: "normal",
            }}>
                <h1 style={{ fontSize: '4vw' }}>Loading For More Context...</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineOne}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineTwo}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineThree}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineFour}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineFive}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineSix}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineSeven}</h1>
                <h1 style={{ fontSize: '4vw', padding: '10px' }}>{codelineEight}</h1>
                <div className="loading" style={{ fontSize: '5vw' }}>{Math.ceil(simulatedProgress)} % loaded</div>
                <Notification message="Please check your network connection and try again. The page will reload in 3 seconds if the progress remains unchanged." show={showNotification} />

            </div>
            {!isCrawler && <JessiePreAlert />}
        </Html >
    );
}

export default WaitingJessie;