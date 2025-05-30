import { useState, useEffect, useContext, forwardRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCog, faCheck, faQuestionCircle } from '@fortawesome/free-solid-svg-icons';
import { message } from 'antd';
import { setUserAntialias, setUserDpr, setUserDisableUnnecessaryComponentAnimation } from '../pages/Status';
import { graphicSettingContext } from '../sharedContexts/GraphicSettingProvider';

const GraphicSetting = forwardRef(({ isPortraitPhoneScreen, setDisplayOverlayCallback }, refGraphicSetting) => {
    const [showSettings, setShowSettings] = useState(false);
    const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
    const [messageApi, contextHolder] = message.useMessage();
    const { dpr, setDpr, antialias, setAntialias, disableUnnecessaryComponentAnimation, setDisableUnnecessaryComponentAnimation } = useContext(graphicSettingContext);



    const toggleSettings = () => {
        setShowSettings(!showSettings);
        if (showSettings) {
            setDisplayOverlayCallback("none");
            saveSetting();
        } else {
            setDisplayOverlayCallback("setting");
        }
    };

    useEffect(() => {
        if (isPortraitPhoneScreen) {
            setAntialias(false);
            setUserAntialias(false);
            setDpr(1);
            setUserDpr(1);
            setDisableUnnecessaryComponentAnimation(true);
            setUserDisableUnnecessaryComponentAnimation(true);
        }
    }, [isPortraitPhoneScreen]);


    const handleDprChange = (e) => {
        const value = parseFloat(e.target.value);
        if (value > 1.5 && isPortraitPhoneScreen) {
            messageApi.error("The current DPR setting is not optimal for mobile devices. For the best experience, I strongly recommend accessing here on a desktop device!");
            return;
        }

        setDpr(value);
        setUserDpr(value);
    };

    const handleAntialiasToggle = () => {
        const newValue = !antialias;
        setAntialias(newValue);
        setUserAntialias(newValue);
    };

    const handleDisableUnnecessaryComponentAnimationToggle = () => {
        const newValue = !disableUnnecessaryComponentAnimation;
        setDisableUnnecessaryComponentAnimation(newValue);
        setUserDisableUnnecessaryComponentAnimation(newValue);
    };

    const showTooltip = (e, content) => {
        const { clientX, clientY } = e;
        setTooltip({ visible: true, content, x: clientX, y: clientY });
    };

    const hideTooltip = () => {
        setTooltip({ visible: false, content: '', x: 0, y: 0 });
    };

    const handleTooltipClick = (e, content) => {
        e.stopPropagation(); // 防止点击事件冒泡到 document
        if (isPortraitPhoneScreen) {
            const { clientX, clientY } = e;
            setTooltip({ visible: !tooltip.visible, content, x: clientX, y: clientY });
        } else {
            showTooltip(e, content);
        }
    };

    // 点击页面的其他地方隐藏悬浮窗
    const handlePageClick = () => {
        if (tooltip.visible) hideTooltip();
    };

    // 添加点击和触摸事件监听
    useEffect(() => {
        const handleDocumentClick = () => {
            handlePageClick();
        };

        document.addEventListener('click', handleDocumentClick);
        document.addEventListener('touchstart', handleDocumentClick);

        return () => {
            document.removeEventListener('click', handleDocumentClick);
            document.removeEventListener('touchstart', handleDocumentClick);
        };
    }, [tooltip.visible]);

    const menuStyle = {
        color: '#fff',
        padding: '10%',
        position: 'fixed',
        top: 0,
        right: 0,
        zIndex: 999,
        width: isPortraitPhoneScreen ? '100%' : '50%',
        height: '100%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.5)',
        transition: 'transform 0.5s ease',
        transform: showSettings ? 'translateX(0)' : 'translateX(100%)',
    };

    const buttonStyle = {
        position: 'fixed',
        top: '50%',
        right: 0,
        transform: 'translateY(-50%)',
        zIndex: 10000,
        backgroundColor: '#fff',
        border: 'none',
        cursor: 'pointer',
        padding: '10px',
        borderRadius: '5px 0 0 5px',
        boxShadow: '-2px 0 5px rgba(0,0,0,0.1)',
    };

    const titleStyle = {
        marginBottom: '15%',
        fontSize: '24px',
        textAlign: 'center',
    };

    const optionStyle = {
        marginBottom: '20px',
        color: '#fff',
        textAlign: 'center',
        margin: '5%',
        position: 'relative',
        transition: 'color 0.3s ease',
    };

    const dividerStyle = {
        width: '80%',
        height: '2px',
        background: 'linear-gradient(to right, rgba(255, 255, 255, 0), #fff, rgba(255, 255, 255, 0))',
        margin: '5% auto',
    };

    const eachContainerStyle = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        flexWrap: 'wrap',
        maxWidth: '100%',
    };

    const tooltipStyle = {
        position: 'fixed',
        top: tooltip.y + 10,
        left: tooltip.x + 10,
        backgroundColor: '#333',
        color: '#fff',
        padding: '5px 10px',
        borderRadius: '5px',
        boxShadow: '0px 0px 5px rgba(0,0,0,0.3)',
        zIndex: 10001,
        whiteSpace: 'normal',
        maxWidth: '200px',
        display: tooltip.visible ? 'block' : 'none',
    };

    const saveSetting = () => {
        messageApi.open({
            type: 'success',
            content: 'Settings saved, the canvas has been re-rendered!',
            style: {
                fontFamily: ['Orbitron', "sans-serif"],
                zIndex: 9999,

            },
        });
    };

    return (
        <div style={{
            fontFamily: 'Orbitron, sans-serif', // 显式设置字体
        }}>      {contextHolder}
            <button style={buttonStyle} onClick={toggleSettings} ref={refGraphicSetting}>
                <FontAwesomeIcon icon={showSettings ? faCheck : faCog} size="2x" color="black" />
            </button>
            <div style={menuStyle}>
                <h1 style={titleStyle}>Graphic Settings</h1>
                <div style={optionStyle}>
                    <div style={eachContainerStyle}>
                        <FontAwesomeIcon
                            icon={faQuestionCircle}
                            onClick={(e) => handleTooltipClick(e, 'Higher DPR increases detail but reduces performance. For mobile devices or 4K screen users, higher DPR may cause performance issues or crash the entire webpage.')}
                            onMouseEnter={(e) => !isPortraitPhoneScreen && showTooltip(e, 'Higher DPR increases detail but reduces performance. For mobile devices or 4K screen users, higher DPR may cause performance issues or crash the entire webpage.')}
                            onMouseLeave={() => !isPortraitPhoneScreen && hideTooltip()}
                            style={{ cursor: 'pointer' }}
                        />
                        <label>DPR: </label>
                        <select value={dpr} onChange={handleDprChange}>
                            {[1, 1.25, 1.5, 1.75, 2].map((value) => (
                                <option key={value} value={value}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div style={dividerStyle}></div>
                <div style={optionStyle}>
                    <div style={eachContainerStyle}>
                        <FontAwesomeIcon
                            icon={faQuestionCircle}
                            onClick={(e) => handleTooltipClick(e, 'Turning antialias on improves edge smoothness but may impact performance. IOS devices may not support antialias, do not turn it on!!!')}
                            onMouseEnter={(e) => !isPortraitPhoneScreen && showTooltip(e, 'Turning antialias on improves edge smoothness but may impact performance. IOS devices may not support antialias, do not turn it on!!!')}
                            onMouseLeave={() => !isPortraitPhoneScreen && hideTooltip()}
                            style={{ cursor: 'pointer' }}
                        />
                        <label>Antialias: </label>
                        <button onClick={handleAntialiasToggle}>
                            {antialias ? 'On' : 'Off'}
                        </button>
                    </div>
                </div>
                <div style={dividerStyle}></div>
                <div style={optionStyle}>
                    <div style={eachContainerStyle}>
                        <FontAwesomeIcon
                            icon={faQuestionCircle}
                            onClick={(e) => handleTooltipClick(e, 'Disable unnecessary animation on certain 3D models to improve performance and page reliability (on iphone devices).')}
                            onMouseEnter={(e) => !isPortraitPhoneScreen && showTooltip(e, 'Disable unnecessary animation on certain 3D models to improve performance and page reliability (on iphone devices).')}
                            onMouseLeave={() => !isPortraitPhoneScreen && hideTooltip()}
                            style={{ cursor: 'pointer' }}
                        />
                        <label>Disable Unnecessary Animation: </label>
                        <button onClick={handleDisableUnnecessaryComponentAnimationToggle}>
                            {disableUnnecessaryComponentAnimation ? 'On' : 'Off'}
                        </button>
                    </div>
                </div>
                <div style={dividerStyle}></div>
                <div style={optionStyle}>
                    <br />
                    <div style={eachContainerStyle}>Note: For the best experience, avoid accessing this website on mobile devices.</div>
                </div>
            </div>
            <div style={tooltipStyle}>{tooltip.content}</div>
        </div>
    );
});

export default GraphicSetting;
