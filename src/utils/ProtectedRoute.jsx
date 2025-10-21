import { useEffect, useContext } from "react";
import { useAuthStore } from "../hooks/useAuthStore";
import { GlobalNotificationContext } from "../sharedContexts/GlobalNotificationProvider";
import { useNavigate } from "react-router-dom";


export default function ProtectedRoute({ children }) {
    const token = useAuthStore(state => state.token);
    const tokenExp = useAuthStore(state => state.tokenExp);
    const initializing = useAuthStore(state => state.initializing);
    const navigate = useNavigate();
    const { messageApi } = useContext(GlobalNotificationContext);

    const nowSec = Math.floor(Date.now() / 1000);
    const isAuthenticated = Boolean(token && (tokenExp ? tokenExp > nowSec : true));

    useEffect(() => {
        if (initializing) return;

        if (!isAuthenticated) {
            messageApi && messageApi('warning', 'Please login to access this page, redirecting...', 1);
            navigate('/ship_quarter', { replace: true });
        }
    }, [initializing, isAuthenticated, navigate, messageApi]);

    if (initializing) return null;

    return isAuthenticated ? children : null;
}