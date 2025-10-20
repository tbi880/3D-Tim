import { forwardRef, useState, useRef, useEffect } from "react";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faChevronLeft, faLock, faVrCardboard, faFileDownload } from '@fortawesome/free-solid-svg-icons';
import "./css/menu.css";
import { getMenuLockMapFromLocalStorage } from "../pages/Status";

const Menu = forwardRef(({ isPortraitPhoneScreen, setDisplayOverlayCallback }, refMenu) => {
    // menu open/close
    const [showMenu, setShowMenu] = useState(false);
    // lock map from local storage
    const [sceneMenuLockMap, setSceneMenuLockMap] = useState(getMenuLockMapFromLocalStorage());

    // paging: 0 or 1
    const [currentPage, setCurrentPage] = useState(0);

    // drag/touch state
    const viewportRef = useRef(null);
    const trackRef = useRef(null);
    const startXRef = useRef(0);
    const currentXRef = useRef(0);
    const isDraggingRef = useRef(false);
    const animationFrameRef = useRef(null);
    const [viewportWidth, setViewportWidth] = useState(0);

    // update viewport width when menu opens or on resize
    useEffect(() => {
        const updateWidth = () => {
            if (viewportRef.current) {
                setViewportWidth(viewportRef.current.clientWidth);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, [showMenu]);

    const handleClick = (e, isLocked) => {
        // prevent click if locked or if currently dragging (to avoid accidental navigations after swipe)
        if (isLocked || isDraggingRef.current) {
            e.preventDefault();
        }
    };

    const toggleMenu = () => {
        setShowMenu(prev => !prev);
        setSceneMenuLockMap(getMenuLockMapFromLocalStorage());
        if (showMenu) {
            setDisplayOverlayCallback("none");
        } else {
            setDisplayOverlayCallback("menu");
        }
    };

    // open/close transform (keeps your original animation)
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
        overflow: 'hidden', // Important: viewport will handle scrolling inside pages
        maxHeight: '100vh',
        boxSizing: 'border-box'
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
        marginBottom: '15%'
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

    // Slider track transform: we use pixels during dragging for smooth feel
    const computeTrackTransform = (offsetPx = 0) => {
        // base offset to show the current page:
        const base = -currentPage * viewportWidth;
        return `translateX(${base + offsetPx}px)`;
    };

    // enable dragging (mouse & touch)
    const onPointerDown = (clientX) => {
        if (!viewportRef.current) return;
        isDraggingRef.current = true;
        startXRef.current = clientX;
        currentXRef.current = clientX;
        // ensure we have viewport width
        setViewportWidth(viewportRef.current.clientWidth || viewportWidth);
        // temporarily remove transition for immediate dragging
        if (trackRef.current) trackRef.current.style.transition = 'none';
    };

    const onPointerMove = (clientX) => {
        if (!isDraggingRef.current || !trackRef.current) return;
        currentXRef.current = clientX;
        const deltaX = currentXRef.current - startXRef.current;
        // requestAnimationFrame for smooth updates
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = requestAnimationFrame(() => {
            trackRef.current.style.transform = computeTrackTransform(deltaX);
        });
    };

    const onPointerUp = () => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (!viewportRef.current) return;
        const deltaX = currentXRef.current - startXRef.current;
        const threshold = viewportWidth * 0.2; // 20% threshold to switch page
        let newPage = currentPage;

        if (deltaX > threshold && currentPage > 0) {
            newPage = currentPage - 1;
        } else if (deltaX < -threshold && currentPage < 1) {
            newPage = currentPage + 1;
        }
        // restore transition and snap
        if (trackRef.current) {
            trackRef.current.style.transition = 'transform 0.35s ease';
            // set final transform according to newPage (no offset)
            const finalTransform = `translateX(${-newPage * viewportRef.current.clientWidth}px)`;
            trackRef.current.style.transform = finalTransform;
        }
        setCurrentPage(newPage);

        // small timeout to avoid click firing right after drag
        setTimeout(() => {
            // clear dragging flag after short delay
            isDraggingRef.current = false;
        }, 50);
    };

    // touch handlers
    const handleTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        onPointerDown(e.touches[0].clientX);
    };
    const handleTouchMove = (e) => {
        if (e.touches.length !== 1) return;
        onPointerMove(e.touches[0].clientX);
    };
    const handleTouchEnd = () => {
        onPointerUp();
    };

    // mouse handlers for desktop dragging
    const handleMouseDown = (e) => {
        e.preventDefault();
        onPointerDown(e.clientX);
        // attach document listeners for move/up so dragging not lost when pointer leaves element
        const onMouseMoveDoc = (ev) => onPointerMove(ev.clientX);
        const onMouseUpDoc = (ev) => {
            onPointerUp();
            document.removeEventListener('mousemove', onMouseMoveDoc);
            document.removeEventListener('mouseup', onMouseUpDoc);
        };
        document.addEventListener('mousemove', onMouseMoveDoc);
        document.addEventListener('mouseup', onMouseUpDoc);
    };

    // click on dots
    const goToPage = (index) => {
        if (!viewportRef.current || !trackRef.current) {
            setCurrentPage(index);
            return;
        }
        setCurrentPage(index);
        trackRef.current.style.transition = 'transform 0.35s ease';
        trackRef.current.style.transform = `translateX(${-index * viewportRef.current.clientWidth}px)`;
    };

    // ensure track transform updates when currentPage changes programmatically (e.g., open menu)
    useEffect(() => {
        if (!trackRef.current || !viewportRef.current) return;
        trackRef.current.style.transition = 'transform 0.35s ease';
        trackRef.current.style.transform = `translateX(${-currentPage * viewportRef.current.clientWidth}px)`;
    }, [currentPage, viewportWidth, showMenu]);

    return (
        <div style={{ fontFamily: 'Orbitron, sans-serif' }}>
            <button style={buttonStyle} onClick={toggleMenu} ref={refMenu}>
                <FontAwesomeIcon icon={showMenu ? faChevronLeft : faChevronRight} size="2x" color="black" />
            </button>

            <div style={menuStyle} className="menu-container">
                {/* Slider viewport */}
                <div
                    ref={viewportRef}
                    className="menu-viewport"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={handleMouseDown}
                    style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
                >
                    {/* Track with two pages side-by-side */}
                    <div
                        ref={trackRef}
                        className="menu-track"
                        style={{
                            display: 'flex',
                            width: '200%',
                            height: '100%',
                            transform: `translateX(${-currentPage * viewportWidth}px)`,
                            transition: 'transform 0.35s ease'
                        }}
                    >
                        {/* Page 1 */}
                        <div className="menu-page" style={{ width: '50%', boxSizing: 'border-box', paddingRight: '5%', paddingLeft: '5%', overflowY: 'auto' }}>
                            <h1 style={titleStyle}>Storyline - Menu</h1>
                            <ul style={{ padding: 0, listStyleType: 'none' }}>

                                <li style={listItemStyle} className="menu-item">
                                    <a href="/" className="menu-link" target="_blank" rel="noopener noreferrer" onClick={(e) => handleClick(e, false)}>Scene1: Introduction</a>
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
                                    <a href="/project_dawn" className={`menu-link ${sceneMenuLockMap.sceneSix ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneSix)} target="_blank" rel="noopener noreferrer">
                                        {!sceneMenuLockMap.sceneSix ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                                        Scene6: Project Dawn</a>
                                    <div style={dividerStyle} ></div>
                                </li>

                            </ul>

                            <div className="vr-container" style={{ marginTop: '10%' }}>
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
                                onClick={(e) => handleClick(e, false)}
                            >
                                <FontAwesomeIcon icon={faFileDownload} className="vr-icon" />
                                <span className="menu-item">Click here to download Tim's developer resume</span>
                            </a>
                        </div>

                        {/* Page 2 */}
                        <div className="menu-page" style={{ width: '50%', boxSizing: 'border-box', paddingRight: '5%', paddingLeft: '5%', overflowY: 'auto' }}>
                            <h1 style={titleStyle}>Ship Exploration</h1>
                            <ul style={{ padding: 0, listStyleType: 'none' }}>

                                <li style={listItemStyle} className="menu-item">
                                    <a href="/ship_quarter" className="menu-link" target="_blank" rel="noopener noreferrer" onClick={(e) => handleClick(e, false)}>Login - Your Quarter</a>
                                    <div style={dividerStyle} ></div>
                                </li>

                                <li style={listItemStyle} className="menu-item">
                                    <a href="/ship_casino" className={`menu-link ${sceneMenuLockMap.sceneTwo ? 'locked' : ''}`} onClick={(e) => handleClick(e, sceneMenuLockMap.sceneTwo)} target="_blank" rel="noopener noreferrer">
                                        {!sceneMenuLockMap.sceneTwo ? null : <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                                        Game - Ship's Casino</a>
                                    <div style={dividerStyle} ></div>
                                </li>


                                <br /><br />

                            </ul>
                        </div>
                    </div>

                    {/* page dots (bottom center) */}
                    <div className="menu-dots" style={{
                        position: 'absolute',
                        bottom: '18px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                    }}>
                        <button
                            onClick={() => goToPage(0)}
                            aria-label="Go to page 1"
                            className={`dot ${currentPage === 0 ? 'active' : ''}`}
                        />
                        <button
                            onClick={() => goToPage(1)}
                            aria-label="Go to page 2"
                            className={`dot ${currentPage === 1 ? 'active' : ''}`}
                        />
                    </div>
                </div>
            </div>
        </div>
    );

});

export default Menu;
