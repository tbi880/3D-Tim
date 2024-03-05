import { Html, useProgress } from '@react-three/drei';
import { useEffect, useState } from 'react';


function Loader() {
    const stories = [
        "In the distant future,", "humanity has mastered the technology of interstellar travel,", "but the universe remains full of unknowns...",
        "You are about to awaken on a starship that has been voyaging for centuries,", "time has passed so long that Captain Tim Bi has been gone forever,",
        "You don't remember anything before your hibernation,", "only that you designed this starship, familiar with every corner of it,", "and vaguely remember that the destination is humanity's new home...",
        "Suddenly, an alarm sound and intense vibrations alert you to the severity of the situation,", "you are unsure if this centuries-old vessel can withstand this sudden 'surprise'",
        "You must awaken quickly,", "check the extent of the damage to the ship,", "gain the AI's trust to get authorized, thus changing the course.", "The lives of all surviving crew members are in your hands now"
    ];
    let [currentStoryIndex, setCurrentStoryIndex] = useState(0);
    const { progress: actualProgress } = useProgress(); // 实际加载进度
    const [simulatedProgress, setSimulatedProgress] = useState(0); // 模拟的进度

    useEffect(() => {
        // 故事增加逻辑
        const storyTimer = setInterval(() => {
            setCurrentStoryIndex(prevIndex => {
                // 如果当前索引小于故事数组的长度，递增索引
                if (prevIndex < stories.length - 1) {
                    return prevIndex + 1;
                } else {
                    // 如果已经是最后一个故事，停止计时器
                    clearInterval(storyTimer);
                    return prevIndex;
                }
            });
        }, 500); // 每3秒增加一个故事

        return () => clearInterval(storyTimer);
    }, []);


    useEffect(() => {
        // 如果模拟进度小于实际进度，则逐渐增加模拟进度
        if (simulatedProgress < actualProgress) {
            const timerId = setTimeout(() => {
                setSimulatedProgress(prevProgress => Math.min(prevProgress + 1, actualProgress));
            }, 20); // 每100毫秒模拟进度增加1%
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
            }}>

                <h1 style={{ fontSize: '4vw' }}>Welcome to Tim's world.</h1>
                <h2 style={{ fontSize: '3vw' }}>Ready for a 3D ride in my universe?</h2>
                <h2 style={{ fontSize: '3vw', padding: '10px' }}>I think you would know me very well after you finish this "adventure"</h2>
                <h2 style={{ fontSize: '3vw', padding: '10px' }}>please be patient. The first time access would take approximately 20 secounds.</h2>
                <div className="loading" style={{ fontSize: '5vw' }}>{Math.ceil(simulatedProgress)} % loaded</div>
                <div style={{ padding: '10px' }}>
                    {stories.slice(0, currentStoryIndex + 1).map((story, index) => (
                        <p key={index} className="story" style={{ animation: `fadeIn 2s ease-out`, fontSize: '2.5vw' }}>{story}</p>
                    ))}
                </div>
            </div>
        </Html>
    );
}

export default Loader;