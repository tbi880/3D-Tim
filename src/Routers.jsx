import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage'
import { useEffect } from 'react';
import { stageOfENV } from './Settings';
import SceneJessie from './pages/SceneJessie';

function Routers() {

    useEffect(() => {
        // 定义进入全屏的函数
        if (stageOfENV === "prod") {
            const requestFullscreen = () => {
                if (document.documentElement.requestFullscreen) {
                    document.documentElement.requestFullscreen();
                } else if (document.documentElement.mozRequestFullScreen) { /* Firefox */
                    document.documentElement.mozRequestFullScreen();
                } else if (document.documentElement.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
                    document.documentElement.webkitRequestFullscreen();
                } else if (document.documentElement.msRequestFullscreen) { /* IE/Edge */
                    document.documentElement.msRequestFullscreen();
                }
            };

            // 定义处理第一次用户交互的事件处理器
            const handleFirstUserInteraction = () => {
                requestFullscreen();
                // 移除事件监听器，以确保这段代码只执行一次
                document.removeEventListener('click', handleFirstUserInteraction);
            };

            // 添加事件监听器，监听第一次点击事件
            document.addEventListener('click', handleFirstUserInteraction);

            // 组件卸载时清理
            return () => {
                document.removeEventListener('click', handleFirstUserInteraction);
            };
        }
    }, []);


    return (
        // <Router basename="/tim">

        <Router>

            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="*" element={<NotFoundPage />} />
                <Route path="/jessie" element={<SceneJessie startPoint={0} />} />
            </Routes>
        </Router>
    );
}

export default Routers;
