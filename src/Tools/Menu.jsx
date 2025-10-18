import { forwardRef, useState } from "react";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faChevronLeft, faLock, faVrCardboard, faFileDownload } from '@fortawesome/free-solid-svg-icons';
import "./css/menu.css";
import { getMenuLockMapFromLocalStorage } from "../pages/Status";

const Menu = forwardRef(({ isPortraitPhoneScreen, setDisplayOverlayCallback }, refMenu) => {
    const [showMenu, setShowMenu] = useState(false);
    const [sceneMenuLockMap, setSceneMenuLockMap] = useState(getMenuLockMapFromLocalStorage());

    const handleClick = (e, isLocked) => {
        if (isLocked) {
            e.preventDefault();
        }
    };

    const toggleMenu = () => {
        setShowMenu(!showMenu);
        setSceneMenuLockMap(getMenuLockMapFromLocalStorage());
        if (showMenu) {
            setDisplayOverlayCallback("none");
        } else {
            setDisplayOverlayCallback("menu");
        }
    };

    const menuStyle = {
        color: '#fff',
        padding: '10%',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 999,
        width: isPortraitPhoneScreen ? '100%' : '50%',
        height: '100%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.5)',
        transition: 'transform 0.5s ease',
        transform: showMenu ? 'translateX(0)' : 'translateX(-100%)',
        overflowY: 'auto', // 启用纵向滚动
        maxHeight: '100vh', // 最大高度限制为屏幕高度
    };

    const buttonStyle = {
        position: 'fixed',
        top: '50%',
        left: 0,
        transform: 'translateY(-50%)',
        zIndex: 1000,
        backgroundColor: '#fff',
        border: 'none',
        cursor: 'pointer',
        padding: '10px',
        borderRadius: '0 5px 5px 0',
        boxShadow: '2px 0 5px rgba(0,0,0,0.1)'
    };

    const titleStyle = {
        marginBottom: '15%' // 增加底部的 margin
    };

    const listItemStyle = {
        textAlign: 'center',
        margin: '5%',
        position: 'relative',
        transition: 'color 0.3s ease'
    };

    const dividerStyle = {
        width: '80%',
        height: '2px',
        background: 'linear-gradient(to right, rgba(255, 255, 255, 0), #fff, rgba(255, 255, 255, 0))',
        margin: '5% auto',
    };

    return (
        <div style={{
            fontFamily: 'Orbitron, sans-serif', // 显式设置字体
        }}>
            <button style={buttonStyle} onClick={toggleMenu} ref={refMenu}>
                <FontAwesomeIcon icon={showMenu ? faChevronLeft : faChevronRight} size="2x" color="black" />
            </button>
            <div style={menuStyle} className="menu-container">
                <h1 style={titleStyle}>Storyline - Menu</h1>
                <ul style={{ padding: 0, listStyleType: 'none' }}>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/" className="menu-link" target="_blank" rel="noopener noreferrer">Scene1: Introduction</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/bridge" className={`menu-link ${sceneMenuLockMap.sceneTwo ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneTwo)} target="_blank" rel="noopener noreferrer">
                            {!sceneMenuLockMap.sceneTwo ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene2: Ship's bridge</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/ship_hanger" className={`menu-link ${sceneMenuLockMap.sceneThree ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneThree)} target="_blank" rel="noopener noreferrer">
                            {!sceneMenuLockMap.sceneThree ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene3: Ship hanger</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/ship_engineering" className={`menu-link ${sceneMenuLockMap.sceneFour ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneFour)} target="_blank" rel="noopener noreferrer">
                            {!sceneMenuLockMap.sceneFour ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene4: Ship's Engineering</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/ship_captains_chamber" className={`menu-link ${sceneMenuLockMap.sceneFive ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneFive)} target="_blank" rel="noopener noreferrer">
                            {!sceneMenuLockMap.sceneFive ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene5: Captain's Command Chamber</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/project_dawn" className={`menu-link ${sceneMenuLockMap.sceneSix ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneFive)} target="_blank" rel="noopener noreferrer">
                            {!sceneMenuLockMap.sceneSix ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene6: Project Dawn</a>
                        <div style={dividerStyle} ></div>
                    </li>

                </ul>
                <div className="vr-container">
                    <FontAwesomeIcon icon={faVrCardboard} className="vr-icon" />
                    <span>VR is now supported, to experience in a different view with more hidden places on the ship to unlock.</span>
                </div>
                <br /><br />
                <a
                    href="https://www.bty.co.nz/Tim_Bi_resume.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={"vr-link"}
                    style={{ color: 'white' }}
                    title="Download Tim Bi's software developer resume"
                    aria-label="Download Tim Bi's software developer resume"
                >
                    <FontAwesomeIcon icon={faFileDownload} className="vr-icon" />
                    <span className="menu-item">Click here to download Tim's developer resume</span>
                </a>

            </div >
        </div>
    );

});

export default Menu;
