import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { stageOfENV } from './Settings';
import GlobalProviders from './sharedContexts/GlobalProviders';
import { OverlayDisplayManager } from './Tools/OverlayDisplayManager';
import ProtectedRoute from './utils/ProtectedRoute';
import { useAuthStore } from './hooks/useAuthStore';
import useClickToFullscreen from './hooks/useClickToFullscreen';

// 使用 React.lazy 动态加载页面组件
const HomePage = lazy(() => import('./urls/HomePage'));
const NotFoundPage = lazy(() => import('./urls/NotFoundPage'));
const Bridge = lazy(() => import('./urls/Bridge'));
const ShipHanger = lazy(() => import('./urls/ShipHanger'));
const ShipEngineering = lazy(() => import('./urls/ShipEngineering'));
const ShipTimsChamber = lazy(() => import('./urls/ShipTimsChamber'));
const ProjectDawn = lazy(() => import('./urls/ProjectDawn'));

const ShipCasino = lazy(() => import('./urls/ShipCasino'));
const ShipQuarter = lazy(() => import('./urls/ShipQuarter'));
const EchoesOfDawn = lazy(() => import('./urls/EchoesOfDawn'));

function Routers() {
    const [isWeChatBrowser, setIsWeChatBrowser] = useState(false);
    // 检测屏幕是否为手机竖屏模式，即高度大于宽度
    const [isPortraitPhoneScreen, setIsPortraitPhoneScreen] = useState(false);

    const initFromStorage = useAuthStore(state => state.initFromStorage);

    // 生产环境下，第一次点击页面任意位置时进入全屏（竖屏手机除外）。游戏页面另有自己的设置。
    useClickToFullscreen();

    useEffect(() => {
        initFromStorage();
    }, [initFromStorage]);


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
    }, []);


    if (isWeChatBrowser) {
        return <>微信内置浏览器限制性能，我也很难受。。。还是劳烦您手动复制到浏览器打开吧</>
    }

    const canvasStyle = {
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent'
    };

    return (
        <Router>
            <GlobalProviders canvasStyle={canvasStyle}>
                <OverlayDisplayManager isPortraitPhoneScreen={isPortraitPhoneScreen} />
                <Suspense fallback={<div>Loading...</div>}>
                    <Routes>
                        <Route path="/" element={<HomePage isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/bridge" element={<Bridge isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_hanger" element={<ShipHanger isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_engineering/*" element={<ShipEngineering isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_captains_chamber" element={<ShipTimsChamber isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/project_dawn" element={<ProjectDawn isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/ship_casino" element={<ProtectedRoute><ShipCasino isPortraitPhoneScreen={isPortraitPhoneScreen} /></ProtectedRoute>} />
                        <Route path="/ship_quarter" element={<ShipQuarter isPortraitPhoneScreen={isPortraitPhoneScreen} />} />
                        <Route path="/echoes_of_dawn" element={<EchoesOfDawn />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </Suspense>
            </GlobalProviders>
        </Router>
    );
}

export default Routers;
