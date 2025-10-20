import { useEffect, useContext } from "react";
import { useAuthStore } from "../hooks/useAuthStore";
import { useLocation } from "wouter";
import { GlobalNotificationContext } from "../sharedContexts/GlobalNotificationProvider";


export default function ProtectedRoute({ children }) {
    const isAuthenticated = useAuthStore(state => state.isAuthenticated);
    const [, setLocation] = useLocation();
    const { messageApi } = useContext(GlobalNotificationContext);

    useEffect(() => {
        if (!isAuthenticated) {
            try {
                messageApi('warning', 'Please login to access this page', 2);
            } catch (e) {
            }
            setLocation('/ship_quarter', { replace: true });
        }
    }, [isAuthenticated, setLocation, messageApi]);

    return isAuthenticated ? children : null;
}
