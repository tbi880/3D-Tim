import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { signalRConnectionURL } from '../Settings';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalNotificationContext } from '../sharedContexts/GlobalNotificationProvider';

function useRoomHub(token, casinoSheet, card2Sheet, chipSheet, showComponents, toggleComponentDisplay, setShowPlaceBets, roomId) {
    const connectionRef = useRef(null);
    const { messageApi } = useContext(GlobalNotificationContext);
    const [connectionState, setConnectionState] = useState('disconnected');
    // 值可能 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

    useEffect(() => {
        if (roomId == null) return;
        const conn = new HubConnectionBuilder()
            .withUrl(signalRConnectionURL, { accessTokenFactory: () => token })
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Information)
            .build();

        connectionRef.current = conn;

        conn.onreconnecting(error => {
            messageApi(
                'warning',
                'Connection lost due to error: ' + error?.message + '. Reconnecting...',
                3,
            );
            setConnectionState('reconnecting');
        });

        conn.onreconnected(() => {
            messageApi(
                'success',
                'Reconnected to the server.',
                2,
            ); setConnectionState('connected');
        });

        conn.onclose(error => {
            messageApi(
                'error',
                'Connection closed due to error: ' + error?.message,
                5,
            );
            setConnectionState('disconnected');
        });

        conn.start()
            .then(() => {
                messageApi(
                    'success',
                    'Connected to the server.',
                    2,
                );
                setConnectionState('connected');
            })
            .catch(err => {
                messageApi(
                    'error',
                    'Connection failed: ' + err,
                    5,
                );
                setConnectionState('disconnected');
            });

        return () => {
            conn.stop();
        };
    }, [token, roomId]);

    return { connectionRef, connectionState };
}

export default useRoomHub;