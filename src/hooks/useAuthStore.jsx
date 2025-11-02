import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';

function parseJwt(token) {
    try {
        const payload = token.split('.')[1];
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
        try {
            return JSON.parse(decodeURIComponent(escape(decoded)));
        } catch (e) {
            return JSON.parse(decoded);
        }
    } catch (e) {
        return null;
    }
}

const LS_TOKEN_KEY = 'app_jwt_token';
const LS_TOKEN_EXP_KEY = 'app_jwt_token_exp';
const LS_PROFILE_KEY = 'app_profile';

export const useAuthStore = create((set, get) => ({
    token: null,
    tokenExp: null,
    profile: null,
    initializing: true,

    get isAuthenticated() {
        const token = get().token;
        const exp = get().tokenExp;
        if (!token) return false;
        if (!exp) return true;
        const nowSec = Math.floor(Date.now() / 1000);
        return exp > nowSec;
    },

    initFromStorage: async () => {
        const rawToken = localStorage.getItem(LS_TOKEN_KEY);
        const rawExp = localStorage.getItem(LS_TOKEN_EXP_KEY);
        const rawProfile = localStorage.getItem(LS_PROFILE_KEY);

        if (rawToken) {
            let tokenExp = rawExp ? parseInt(rawExp, 10) : null;
            if (!tokenExp) {
                const payload = parseJwt(rawToken);
                if (payload && payload.exp) tokenExp = payload.exp;
            }

            axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${rawToken}`;
            set({ token: rawToken, tokenExp, profile: rawProfile ? JSON.parse(rawProfile) : null });

            const nowSec = Math.floor(Date.now() / 1000);
            if (!tokenExp || tokenExp > nowSec) {
                try {
                    const resp = await axiosInstance.get('profile');
                    set({ profile: resp.data });
                    localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(resp.data));
                } catch (e) {
                    set({ profile: null });
                    localStorage.removeItem(LS_PROFILE_KEY);
                }
            } else {
                set({ token: null, tokenExp: null, profile: null });
                delete axiosInstance.defaults.headers.common['Authorization'];
                localStorage.removeItem(LS_TOKEN_KEY);
                localStorage.removeItem(LS_TOKEN_EXP_KEY);
                localStorage.removeItem(LS_PROFILE_KEY);
            }
        }

        set({ initializing: false });
    },

    register: async (name, email, password, notify, turnstileToken = null) => {
        try {
            const payload = { name, email, password };
            if (turnstileToken) payload.cf_turnstile_token = turnstileToken;

            const resp = await axiosInstance.post('register', payload);
            if (resp.status === 204 || resp.status === 200) {
                notify('success', 'Register success — signing you in...', 2);
                await get().login(email, password, notify, turnstileToken);
                return { success: true };
            } else {
                const errMsg = resp.data && resp.data.message ? resp.data.message : 'Registration failed';
                notify('warning', errMsg, 3);
                return { success: false, message: errMsg };
            }
        } catch (err) {
            let msg = 'Network error';
            if (err.response && err.response.data && err.response.data.message) {
                msg = err.response.data.message;
            } else if (err.message) {
                msg = err.message;
            }
            notify('warning', msg, 3);
            return { success: false, message: msg };
        }
    },

    login: async (email, password, notify, turnstileToken = null) => {
        try {
            const body = { email, password };
            if (turnstileToken) body.cf_turnstile_token = turnstileToken;

            const resp = await axiosInstance.post('login', body);
            if (resp.status === 200 && resp.data && resp.data.jwtToken) {
                const token = resp.data.jwtToken;
                const payload = parseJwt(token);
                let expSec = null;
                if (payload && payload.exp) {
                    expSec = payload.exp;
                } else {
                    expSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
                }
                localStorage.setItem(LS_TOKEN_KEY, token);
                localStorage.setItem(LS_TOKEN_EXP_KEY, expSec.toString());
                axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;

                set({ token, tokenExp: expSec });

                try {
                    const profileResp = await axiosInstance.get('profile');
                    set({ profile: profileResp.data });
                    localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(profileResp.data));
                } catch (e) {
                    set({ profile: null });
                    localStorage.removeItem(LS_PROFILE_KEY);
                    notify('warning', 'Logged in but failed to fetch profile.', 3);
                }

                notify('success', 'Login successful.', 2);
                return { success: true };
            } else {
                const msg = (resp.data && resp.data.message) ? resp.data.message : 'Login failed';
                notify('warning', msg, 3);
                return { success: false, message: msg };
            }
        } catch (err) {
            let msg = 'Network error';
            if (err.response && err.response.data && err.response.data.message) {
                msg = err.response.data.message;
            } else if (err.message) {
                msg = err.message;
            }
            notify('warning', msg, 3);
            return { success: false, message: msg };
        }
    },

    logout: () => {
        set({ token: null, tokenExp: null, profile: null });
        delete axiosInstance.defaults.headers.common['Authorization'];
        localStorage.removeItem(LS_TOKEN_KEY);
        localStorage.removeItem(LS_TOKEN_EXP_KEY);
        localStorage.removeItem(LS_PROFILE_KEY);
    },

}));
