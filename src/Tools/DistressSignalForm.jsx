import { useContext, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes, faCheck } from '@fortawesome/free-solid-svg-icons';
import { sendDistressSignalContext } from '../sharedContexts/SendDistressSignalProvider';
import { scene5Sheet } from '../pages/SceneManager';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';


function DistressSignalForm({ isPortraitPhoneScreen }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [messageContent, setMessageContent] = useState('');
    const [allowSaveEmail, setAllowSaveEmail] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { showForm, setShowForm } = useContext(sendDistressSignalContext);
    const { messageApi } = useContext(GlobalNotificationContext);

    const handleAfterPlay = () => {
        if (window.location.pathname.includes('/ship_captains_chamber')) {
            scene5Sheet.sequence.play({ range: [41, 55] }).then(() => scene5Sheet.sequence.play({ range: [29, 30] }));
        }
    };

    const handleCheckboxClick = () => {
        setAllowSaveEmail((prevValue) => !prevValue);
    };

    const handleSubmit = async () => {
        if (!name || !email.includes('@')) {
            messageApi(
                'error',
                'Please fill in all required fields correctly.'
            );
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch('https://jsonplaceholder.typicode.com/posts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name,
                    email,
                    message: messageContent,
                    allowSaveEmail,
                }),
                mode: 'cors',
            });

            if (response.status === 201) {
                messageApi(
                    'success',
                    'Your distress signal has been sent successfully! Please check your mailbox later!',
                );
                if (showForm) {
                    handleAfterPlay();
                    setShowForm(false);
                }
            } else {
                const errorData = await response.json();
                messageApi(
                    'error',
                    errorData.message || 'An error occurred while sending your message.',
                );
                setIsSubmitting(false);
            }
        } catch (error) {
            messageApi(
                'error',
                'Failed to send the message. Please try again later.',
            );
            setIsSubmitting(false);
        }
    };

    const containerStyle = {
        color: '#fff',
        padding: '5%',
        position: 'fixed',
        top: isPortraitPhoneScreen ? 0 : '15%',
        left: 0,
        width: '100%',
        height: isPortraitPhoneScreen ? '100%' : '70%',
        backgroundColor: isPortraitPhoneScreen ? 'black' : 'rgba(0, 0, 0, 0.7)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
    };

    const formStyle = {
        width: '80%',
        maxWidth: '500px',
    };

    const titleStyle = {
        marginTop: '20px',
        marginBottom: '30px',
        fontSize: '32px',
        textAlign: 'center',
        fontFamily: ['Orbitron', 'sans-serif'],
    };

    const labelStyle = {
        display: 'block',
        marginBottom: '5px',
    };

    const inputStyle = {
        width: '100%',
        padding: '10px',
        marginBottom: '15px',
        borderRadius: '5px',
        border: '1px solid #ccc',
        fontSize: '16px',
    };

    const dividerStyle = {
        width: '100%',
        height: '2px',
        background: 'linear-gradient(to right, rgba(255, 255, 255, 0), #fff, rgba(255, 255, 255, 0))',
        margin: '15px 0',
    };

    const checkboxContainerStyle = {
        display: 'flex',
        alignItems: 'center',
        marginBottom: '20px',
    };

    const buttonContainerStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        width: '100%',
    };

    const buttonStyle = {
        padding: '10px 20px',
        fontSize: '16px',
        borderRadius: '5px',
        cursor: 'pointer',
        border: 'none',
    };

    const closeButtonStyle = {
        ...buttonStyle,
        backgroundColor: '#555',
        color: '#fff',
    };

    const submitButtonStyle = {
        ...buttonStyle,
        backgroundColor: isSubmitting ? '#888' : '#108ee9',
        color: '#fff',
        pointerEvents: isSubmitting ? 'none' : 'auto',
    };

    return (
        <>
            <div style={containerStyle}>
                <div style={formStyle}>
                    <h1 style={titleStyle}>Send Distress Signal</h1>

                    <label style={labelStyle}>
                        Your identity (Name): <span style={{ color: 'red' }}>*</span>
                    </label>
                    <input
                        type="text"
                        style={inputStyle}
                        value={name}
                        onChange={(e) => e.target.value.length <= 50 ? setName(e.target.value) : null}
                        required
                        maxLength={"50"}
                    />
                    <div style={dividerStyle}></div>

                    <label style={labelStyle}>
                        Your location (Email): <span style={{ color: 'red' }}>*</span>
                    </label>
                    <input
                        type="email"
                        style={inputStyle}
                        value={email}
                        onChange={(e) => e.target.value.length <= 254 ? setEmail(e.target.value) : null}
                        required
                        maxLength={"254"}
                    />
                    <div style={dividerStyle}></div>

                    <label style={labelStyle}>Your message (Optional):</label>
                    <textarea
                        style={{ ...inputStyle, height: '100px' }}
                        value={messageContent}
                        onChange={(e) => setMessageContent(e.target.value)}
                    ></textarea>
                    <div style={dividerStyle}></div>

                    <div style={checkboxContainerStyle} onClick={handleCheckboxClick}>
                        <input
                            type="checkbox"
                            checked={allowSaveEmail}
                            onChange={(e) => setAllowSaveEmail(e.target.checked)}
                            style={{ marginRight: '10px' }}
                        />
                        <label>Allow Tim to save your email for future contact and cooperation.</label>
                    </div>

                    <div style={buttonContainerStyle}>
                        <button style={closeButtonStyle} onClick={() => { showForm ? setShowForm(false) : null; handleAfterPlay(); }}>
                            <FontAwesomeIcon icon={faTimes} /> Close
                        </button>
                        <button style={submitButtonStyle} onClick={handleSubmit} disabled={isSubmitting}>
                            {!isSubmitting && <FontAwesomeIcon icon={faCheck} />}
                            {isSubmitting ? ' Sending...' : ' Send'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

export default DistressSignalForm;
