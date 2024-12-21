import { useContext, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { authorizationCheckContext } from '../sharedContexts/AuthorizationCheckProvider';
import { scene5Sheet } from '../pages/SceneManager';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import '../Tools/css/general.css';
import { backendURL } from '../Settings';
import axios from 'axios';
import { SheetSequencePlayControlContext } from '../sharedContexts/SheetSequencePlayControlProvider';

function AuthorizationCheckForm({ isPortraitPhoneScreen }) {
    const [verificationCode, setVerificationCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { showAuthorizationCheckForm, setShowAuthorizationCheckForm } = useContext(authorizationCheckContext);
    const { messageApi } = useContext(GlobalNotificationContext);
    const { isSequencePlaying, setIsSequencePlaying, rate, setRate, targetPosition, setTargetPosition, playOnce } = useContext(SheetSequencePlayControlContext);


    const handleAfterPlay = () => {
        if (window.location.pathname.includes('/ship_captains_chamber')) {
            playOnce({ sequence: scene5Sheet.sequence, range: [153, 165] });
        }
    };


    const handleSubmit = async () => {
        if (!verificationCode) {
            messageApi(
                'error',
                'Please fill in all required fields correctly.'
            );
            return;
        }

        setIsSubmitting(true);


        try {
            const response = await axios.post(
                backendURL + 'email_contacts/verify',
                {
                    verificationCode
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 5000, // 可选：设置请求超时时间（毫秒）
                }
            );

            if (response.status === 200) {
                const data = response.data;
                if (data.status === 'success') {
                    const name = data.name;
                    messageApi(
                        'success',
                        'Commander ' + name + ', you have successfully verified your identity!',
                        3
                    );
                    if (showAuthorizationCheckForm) {
                        handleAfterPlay();
                        setShowAuthorizationCheckForm(false);
                    }
                } else {
                    messageApi(
                        'error',
                        'Please enter the correct verification code. If you are not sure, please check your mailbox (the one you just filled in).',
                        3
                    );
                }
            } else {
                const errorData = response.data;
                messageApi(
                    'error',
                    errorData.message || 'An error occurred.'
                );
                setIsSubmitting(false);
            }
        } catch (error) {
            if (error.response) {
                // 服务器响应了一个错误
                const errorData = error.response.data;
                messageApi(
                    'error',
                    errorData.message || 'An error occurred.'
                );
            } else if (error.code === 'ECONNABORTED') {
                // 请求超时
                messageApi(
                    'error',
                    'Request timed out. Please try again later.',
                );
            } else {
                // 其他错误
                messageApi(
                    'error',
                    'Failed to verify. Please try again later.',
                );
            }
        } finally {
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
        zIndex: 888,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
    };


    return (
        <>
            <div style={containerStyle}>
                <div className="form">
                    <h1 className="title">Verify Captain's Authorization</h1>

                    <label>
                        Please check your mailbox and enter the verification code I sent to you a few seconds ago.
                    </label>
                    <div className="divider"></div>
                    <label className="label">
                        Your verification code: <span className="required">*</span>
                    </label>
                    <input
                        type="text"
                        className="input"
                        value={verificationCode}
                        onChange={(e) => e.target.value.length <= 10 ? setVerificationCode(e.target.value) : null}
                        required
                        maxLength="10"
                    />
                    <div className="divider"></div>


                    <div className="button-container">
                        <button className={`button submit-button ${isSubmitting ? 'submit-button-submitting' : ''}`} onClick={handleSubmit} disabled={isSubmitting}>
                            {!isSubmitting && <FontAwesomeIcon icon={faCheck} />}
                            {isSubmitting ? ' Verifying...' : ' Verify'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    )
}

export default AuthorizationCheckForm;
