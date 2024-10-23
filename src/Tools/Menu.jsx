import { useState } from "react";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faChevronLeft, faLock, faVrCardboard } from '@fortawesome/free-solid-svg-icons';
import "./css/menu.css";
import { getMenuLockMapFromLocalStorage } from "../pages/Status";

function Menu({ isPortraitPhoneScreen, openSettingOrMenuCallback }) {
    const [showMenu, setShowMenu] = useState(false);
    const scene_menu_lock_map = getMenuLockMapFromLocalStorage();

    const handleClick = (e, isLocked) => {
        if (isLocked) {
            e.preventDefault();
        }
    };

    const toggleMenu = () => {
        setShowMenu(!showMenu);
        if (showMenu) {
            openSettingOrMenuCallback("none");
        } else {
            openSettingOrMenuCallback("menu");
        }
    };

    const menuStyle = {
        color: '#fff',
        padding: '10%',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        width: isPortraitPhoneScreen ? '100%' : '50%',
        height: '100%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.5)',
        transition: 'transform 0.5s ease',
        transform: showMenu ? 'translateX(0)' : 'translateX(-100%)'
    };

    const buttonStyle = {
        position: 'fixed',
        top: '50%',
        left: 0,
        transform: 'translateY(-50%)',
        zIndex: 10000,
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
        <>
            <button style={buttonStyle} onClick={toggleMenu}>
                <FontAwesomeIcon icon={showMenu ? faChevronLeft : faChevronRight} size="2x" color="black" />
            </button>
            <div style={menuStyle}>
                <h1 style={titleStyle}>Storyline - Menu</h1>
                <ul style={{ padding: 0, listStyleType: 'none' }}>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/" className="menu-link" target="_blank" rel="noopener noreferrer">Scene1: Introduction</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/bridge" className={`menu-link ${scene_menu_lock_map.sceneTwo ? 'locked' : ''}`} onClick={(e) => handleClick(e, scene_menu_lock_map.sceneTwo)} target="_blank" rel="noopener noreferrer">
                            {!scene_menu_lock_map.sceneTwo ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene2: Ship's bridge</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/ship_hanger" className={`menu-link ${scene_menu_lock_map.sceneThree ? 'locked' : ''}`} onClick={(e) => handleClick(e, scene_menu_lock_map.sceneThree)} target="_blank" rel="noopener noreferrer">
                            {!scene_menu_lock_map.sceneThree ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene3: Ship hanger</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/ship_engineering" className={`menu-link ${scene_menu_lock_map.sceneFour ? 'locked' : ''}`} onClick={(e) => handleClick(e, scene_menu_lock_map.sceneFour)} target="_blank" rel="noopener noreferrer">
                            {!scene_menu_lock_map.sceneFour ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                            Scene4: Ship's Engineering</a>
                        <div style={dividerStyle} ></div>
                    </li>

                    <li style={listItemStyle} className="menu-item">
                        <a href="/tims-chamber" className={`menu-link locked`} >
                            <FontAwesomeIcon icon={faLock} className="lock-icon" />
                            Scene5: Under development...</a>
                        <div style={dividerStyle} ></div>
                    </li>

                </ul>
                <div className="vr-container">
                    <FontAwesomeIcon icon={faVrCardboard} className="vr-icon" />
                    <span>VR is now supported, to experience in a different view with more hidden places on the ship to unlock.</span>
                </div>
            </div>
        </>
    );

}

export default Menu;
