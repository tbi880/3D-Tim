import { useContext, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBraille, faDice } from '@fortawesome/free-solid-svg-icons';
import "./css/general.css";
import BigRoad from './BigRoad';
import { BaccaratGraphBoardContentContext } from '../sharedContexts/BaccaratGraphBoardContentProvider';

const BaccaratGraphBoard = ({
    isPortraitPhoneScreen,
    setDisplayOverlayCallback }) => {

    const [showBoard, setShowBoard] = useState(false);

    const { baccaratGraphBoardContent, setBaccaratGraphBoardContent } = useContext(BaccaratGraphBoardContentContext);

    const toggleBoard = () => {
        setShowBoard(!showBoard);
        if (showBoard) {
            setDisplayOverlayCallback("none");
        } else {
            setDisplayOverlayCallback("baccaratGraphBoard");
        }
    };

    const containerStyle = {
        color: '#fff',
        padding: isPortraitPhoneScreen ? '15%' : '10%',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 999,
        width: '100%',
        height: '100%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.5)',
        transition: 'transform 0.5s ease',
        transform: showBoard ? 'translateY(0)' : 'translateY(-100%)',
        overflowY: 'auto',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
    };

    const buttonStyle = {
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        backgroundColor: '#fff',
        border: 'none',
        cursor: 'pointer',
        padding: '10px',
        borderRadius: '0 0 5px 5px',
        boxShadow: '0px 2px 5px rgba(0,0,0,0.1)'
    };

    return (
        <div style={{ fontFamily: 'Orbitron, sans-serif' }}>
            <button style={buttonStyle} onClick={toggleBoard} >

                <FontAwesomeIcon icon={showBoard ? faDice : faBraille} size="2x"
                    color="black" />

            </button>

            <div style={containerStyle}>
                <h1>Graph Board</h1>

                <div style={{ paddingTop: "5px" }}></div>
                <div className='divider'></div>

                <div style={{
                    paddingTop: "20px",
                    textAlign: "center",
                    width: "100%",
                    maxWidth: "600px"
                }}>
                    <BigRoad results={baccaratGraphBoardContent ? baccaratGraphBoardContent : []} />
                </div>
            </div>
        </div>
    );
};

export default BaccaratGraphBoard;
