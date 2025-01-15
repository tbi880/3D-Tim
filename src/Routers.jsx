import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { stageOfENV } from './Settings';
import GlobalProviders from './sharedContexts/GlobalProviders';
import { OverlayDisplayManager } from './Tools/OverlayDisplayManager';

// 使用 React.lazy 动态加载页面组件
const HomePage = lazy(() => import('./pages/HomePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const SceneJessie = lazy(() => import('./pages/SceneJessie'));
const Bridge = lazy(() => import('./pages/Bridge'));
const ShipHanger = lazy(() => import('./pages/ShipHanger'));
const ShipEngineering = lazy(() => import('./pages/ShipEngineering'));
const ShipTimsChamber = lazy(() => import('./pages/ShipTimsChamber'));
const ProjectDawn = lazy(() => import('./pages/ProjectDawn'));

function Routers() {
    const [isWeChatBrowser, setIsWeChatBrowser] = useState(false);
    // 检测屏幕是否为手机竖屏模式，即高度大于宽度
    const [isPortraitPhoneScreen, setIsPortraitPhoneScreen] = useState(false);


    useEffect(() => {
        function checkBrowser() {
            const ua = navigator.userAgent;
            if (ua.includes('MicroMessenger')) {
                // 微信内置浏览器中打开
                setIsWeChatBrowser(true);
                alert('请不要使用微信浏览器来打开本页面，由于性能限制，网页可能存在性能瓶颈导致错误。\n在Safari或Chrome内核浏览器中打开本页面。');
                // 或者你可以设置状态来控制渲染不同的组件或元素
            }
            if (window.innerHeight > window.innerWidth) {
                setIsPortraitPhoneScreen(true);
            }
        }

        checkBrowser();

        // 定义进入全屏的函数
        if (stageOfENV === "prod" && !isPortraitPhoneScreen) {
            const requestFullscreen = () => {
                if (navigator.xr) {
                    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                        if (!supported) {
                            if (document.documentElement.requestFullscreen) {
                                document.documentElement.requestFullscreen();
                            } else if (document.documentElement.mozRequestFullScreen) { /* Firefox */
                                document.documentElement.mozRequestFullScreen();
                            } else if (document.documentElement.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
                                document.documentElement.webkitRequestFullscreen();
                            } else if (document.documentElement.msRequestFullscreen) { /* IE/Edge */
                                document.documentElement.msRequestFullscreen();
                            }
                        }
                    });
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


    if (isWeChatBrowser) {
        return <>微信内置浏览器限制性能，我也很难受。。。还是劳烦您手动复制到浏览器打开吧</>
    }



    return (
        <Router>
            <GlobalProviders>
                <OverlayDisplayManager isPortraitPhoneScreen={isPortraitPhoneScreen} />
                <Suspense fallback={<div>Loading...</div>}>
                    <Routes>
                        <Route path="/" element={<HomePage isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/bridge" element={<Bridge isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_hanger" element={<ShipHanger isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_engineering" element={<ShipEngineering isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_captains_chamber" element={<ShipTimsChamber isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/project_dawn" element={<ProjectDawn isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/jessie" element={<SceneJessie startPoint={0} />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </Suspense>
            </GlobalProviders>
        </Router>
    );
}

export default Routers;
