import { useContext, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { sendDistressSignalContext } from '../sharedContexts/SendDistressSignalProvider';
import { scene5Sheet } from '../pages/SceneManager';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import '../Tools/css/general.css';
import { backendURL } from '../Settings';

function DistressSignalForm({ isPortraitPhoneScreen }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [messageContent, setMessageContent] = useState('');
    const [allowSaveEmail, setAllowSaveEmail] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { showSendDistressSignalForm, setShowSendDistressSignalForm } = useContext(sendDistressSignalContext);
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
            const response = await fetch(backendURL + 'email_contacts', {
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

            if (response.status === 204) {
                messageApi(
                    'success',
                    'Your distress signal has been sent successfully! Please check your mailbox later!',
                );
                if (showSendDistressSignalForm) {
                    handleAfterPlay();
                    setShowSendDistressSignalForm(false);
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
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
    };


    return (
        <>
            <div style={containerStyle}>
                <div className="form">
                    <h1 className="title">Send Distress Signal</h1>

                    <label className="label">
                        Your identity (Name): <span className="required">*</span>
                    </label>
                    <input
                        type="text"
                        className="input"
                        value={name}
                        onChange={(e) => e.target.value.length <= 50 ? setName(e.target.value) : null}
                        required
                        maxLength="50"
                    />
                    <div className="divider"></div>

                    <label className="label">
                        Your location (Email): <span className="required">*</span>
                    </label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={(e) => e.target.value.length <= 254 ? setEmail(e.target.value) : null}
                        required
                        maxLength="254"
                    />
                    <div className="divider"></div>

                    <label className="label">Your message (Optional):</label>
                    <textarea
                        className="input message"
                        value={messageContent}
                        onChange={(e) => setMessageContent(e.target.value)}
                    ></textarea>
                    <div className="divider"></div>

                    <div className="checkbox-container" onClick={handleCheckboxClick}>
                        <input
                            type="checkbox"
                            checked={allowSaveEmail}
                            onChange={(e) => setAllowSaveEmail(e.target.checked)}
                            className="checkbox"
                        />

                        <label>Allow Tim to save your email for future contact and cooperation.</label>
                    </div>

                    <div className="button-container">
                        <button className={`button submit-button ${isSubmitting ? 'submit-button-submitting' : ''}`} onClick={handleSubmit} disabled={isSubmitting}>
                            {!isSubmitting && <FontAwesomeIcon icon={faCheck} />}
                            {isSubmitting ? ' Sending...' : ' Send'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
}

export default DistressSignalForm;