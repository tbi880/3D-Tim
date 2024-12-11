import { useState, useContext, forwardRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faListCheck, faAnglesDown } from '@fortawesome/free-solid-svg-icons';
import "./css/general.css";
import { TaskBoardContentContext } from '../sharedContexts/TaskBoardContentProvider';


const TaskBoard = forwardRef(({
    isPortraitPhoneScreen,
    setDisplayOverlayCallback
}, refTaskBoard) => {
    const [showTaskBoard, setShowTaskBoard] = useState(false);
    const { taskBoardContent, setTaskBoardContent } = useContext(TaskBoardContentContext);

    const toggleTaskBoard = () => {
        setShowTaskBoard(!showTaskBoard);
        if (showTaskBoard) {
            setDisplayOverlayCallback("none");
        } else {
            setDisplayOverlayCallback("taskBoard");
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
        transform: showTaskBoard ? 'translateY(0)' : 'translateY(-100%)',
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
        transform: 'translateX(-50%) translateY(0)',
        zIndex: 1000,
        backgroundColor: '#fff',
        border: 'none',
        cursor: 'pointer',
        padding: '10px',
        borderRadius: '0 0 5px 5px',
        boxShadow: '0px 2px 5px rgba(0,0,0,0.1)'
    };

    return (
        <>
            <button style={buttonStyle} onClick={toggleTaskBoard} ref={refTaskBoard}>
                <FontAwesomeIcon icon={showTaskBoard ? faChevronUp : faListCheck} size="2x" color="black" />
            </button>
            <div style={containerStyle}>
                <h1>Task Board</h1>
                <div style={{ paddingTop: "5px" }}></div>
                <div className='divider'></div>
                <div style={{ paddingTop: "20px" }}></div>
                <div style={{ padding: "5px", textAlign: "center", overFlowY: 'auto', maxHeight: '100vh', }}>
                    {taskBoardContent.map((item, index) => (
                        <div key={index}>
                            <p >{item}</p>
                            <FontAwesomeIcon icon={faAnglesDown} />
                            <div style={{ paddingBottom: "10px" }}></div>
                        </div>
                    ))}
                </div>
            </div >
        </>
    );
});

export default TaskBoard;
