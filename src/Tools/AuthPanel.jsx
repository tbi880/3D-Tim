import { useState, forwardRef, useContext, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCircle, faChevronUp, faEye, faEyeSlash, faIdBadge, faUser, faEnvelope, faDice, faUserShield, faMoneyCheckDollar, } from '@fortawesome/free-solid-svg-icons';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';
import { useAuthStore } from '../hooks/useAuthStore';
import "./css/general.css";
import useTurnstile from '../hooks/useTurnstile';

const AuthPanel = forwardRef(({
    isPortraitPhoneScreen,
    setDisplayOverlayCallback
}, refLogin) => {
    const [showLogin, setShowLogin] = useState(false);
    const [isRegisterMode, setIsRegisterMode] = useState(false);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [repeatPassword, setRepeatPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const { token: turnstileToken, containerRef: captchaRef } = useTurnstile();

    const [isSubmitting, setIsSubmitting] = useState(false);


    const { messageApi } = useContext(GlobalNotificationContext);

    // auth store actions
    const loginAction = useAuthStore(state => state.login);
    const registerAction = useAuthStore(state => state.register);
    const initFromStorage = useAuthStore(state => state.initFromStorage);
    const token = useAuthStore(state => state.token);
    const profile = useAuthStore(state => state.profile);
    const isAuthenticated = useAuthStore(state => state.isAuthenticated);
    const initializing = useAuthStore(state => state.initializing);

    useEffect(() => {
        initFromStorage();
    }, []);

    const toggleLogin = () => {
        setShowLogin(prev => !prev);
        if (showLogin) {
            setDisplayOverlayCallback("none");
        } else {
            setDisplayOverlayCallback("authPanel");
        }
    };

    const switchToRegister = () => {
        setIsRegisterMode(true);
        setPassword('');
        setRepeatPassword('');
        setName('');
    };

    const switchToLogin = () => {
        setIsRegisterMode(false);
        setPassword('');
        setRepeatPassword('');
        setName('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (isSubmitting) return;
        setIsSubmitting(true);
        try {

            // basic client validation
            if (!email || !password) {
                messageApi('warning', 'Please supply email and password', 1);
                setIsSubmitting(false);

                return;
            }

            if (!turnstileToken) {
                messageApi('warning', 'Please complete the captcha', 2);
                return;
            }

            if (isRegisterMode) {
                if (!name) {
                    messageApi('warning', 'Please enter your name', 1);
                    setIsSubmitting(false);

                    return;
                }
                if (password !== repeatPassword) {
                    messageApi('warning', 'Passwords do not match', 1);
                    setIsSubmitting(false);

                    return;
                }
                // call register in store (inject messageApi)
                const res = await registerAction(name, email, password, messageApi, turnstileToken);
                if (res && res.success) {
                    // registerAction already auto-logged in; close panel
                    setDisplayOverlayCallback("none");
                } else {
                    if (window.turnstile && widgetIdRef.current !== null) {
                        try { window.turnstile.reset(widgetIdRef.current); setTurnstileToken(null); } catch (e) { }
                    }
                }
            } else {
                const res = await loginAction(email, password, messageApi, turnstileToken);
                if (res && res.success) {
                    setDisplayOverlayCallback("none");
                } else {
                    if (window.turnstile && widgetIdRef.current !== null) {
                        try { window.turnstile.reset(widgetIdRef.current); setTurnstileToken(null); } catch (e) { }
                    }
                }
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const containerStyle = {
        color: '#fff',
        padding: isPortraitPhoneScreen ? '12%' : '8%',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 999,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        transition: 'transform 0.5s ease',
        transform: showLogin ? 'translateY(0)' : 'translateY(-100%)',
        overflowY: 'auto',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxSizing: 'border-box'
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

    if (initializing) return null;

    return (
        <div style={{ fontFamily: 'Orbitron, sans-serif' }}>
            <button style={buttonStyle} onClick={toggleLogin} ref={refLogin} aria-label="Open login panel">
                <FontAwesomeIcon icon={showLogin ? faChevronUp : faUserCircle} size="2x" color="black" />
            </button>

            <div style={containerStyle} className="login-container">
                {profile ? (
                    <>
                        <h1 className="title">User Profile</h1>
                        <div
                            className="profile-card"
                            style={{
                                width: '100%',
                                maxWidth: 420,
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                padding: '20px',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faIdBadge} />
                                <span>User ID: {profile.userId}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faUser} />
                                <span>Name: {profile.name}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faEnvelope} />
                                <span>Email: {profile.email}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faMoneyCheckDollar} />
                                <span>Money: {profile.money.toLocaleString()}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faDice} />
                                <span>Total Bets: {profile.totalBets}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FontAwesomeIcon icon={faUserShield} />
                                <span>Role: {profile.role}</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <h1 className="title">{isRegisterMode ? 'Create Account' : 'Sign In'}</h1>
                        <form className="form" style={{ width: '100%', maxWidth: 420 }} onSubmit={handleSubmit}>
                            <label className="label" htmlFor="email">Email <span className="required">*</span></label>
                            <input
                                id="email"
                                className="input"
                                type="email"
                                placeholder="your@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                            <label className="label" htmlFor="password">Password <span className="required">*</span></label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    id="password"
                                    className="input"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Enter password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete={isRegisterMode ? "new-password" : "current-password"}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(s => !s)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    style={{ position: 'absolute', right: 10, top: 10, border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
                                >
                                    <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                                </button>
                            </div>

                            {isRegisterMode && (
                                <>
                                    <label className="label" htmlFor="repeatPassword">Repeat Password <span className="required">*</span></label>
                                    <input
                                        id="repeatPassword"
                                        className="input"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Repeat your password"
                                        value={repeatPassword}
                                        onChange={(e) => setRepeatPassword(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                    />
                                    <label className="label" htmlFor="name">Name <span className="required">*</span></label>
                                    <input
                                        id="name"
                                        className="input"
                                        type="text"
                                        placeholder="Enter your name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        autoComplete="name"
                                    />
                                </>
                            )}

                            <div style={{ paddingTop: "12px" }}></div>
                            <div className="captcha" aria-hidden="true">
                                <div ref={captchaRef} />
                            </div>
                            <div style={{ paddingTop: "18px" }}></div>

                            <div style={{ display: 'flex', gap: 8 }}>
                                <button type="submit" className={`button submit-button ${isSubmitting ? 'submit-button-submitting' : ''}`} style={{ flex: 1 }} disabled={isSubmitting}>{isSubmitting ? 'Connecting...' : (isRegisterMode ? 'Register' : 'Login')}</button>
                                <button type="button" className="button close-button" onClick={() => { setShowLogin(false); setDisplayOverlayCallback("none"); }} style={{ flex: 1 }}>Close</button>
                            </div>

                            <div style={{ height: 14 }}></div>
                            <div style={{ textAlign: 'center', marginTop: 10 }}>
                                {!isRegisterMode ? (
                                    <>
                                        <span>Don't have an account? </span>
                                        <button type="button" className="button" onClick={switchToRegister} style={{ textDecoration: 'underline', background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer' }}>Register</button>
                                    </>
                                ) : (
                                    <>
                                        <span>Already have an account? </span>
                                        <button type="button" className="button" onClick={switchToLogin} style={{ textDecoration: 'underline', background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer' }}>Back to Login</button>
                                    </>
                                )}
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div >
    );
});

export default AuthPanel;
