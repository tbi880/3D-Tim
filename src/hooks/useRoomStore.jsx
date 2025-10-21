// src/stores/useRoomStore.js
import { create } from 'zustand';
import axiosInstance from '../utils/axiosInstance';
import { roomURL } from '../Settings';

export const useRoomStore = create((set, get) => ({
    // state
    currentRoom: null,    // { roomName, roomId, gameType } 或 null
    joining: false,
    creating: false,

    // actions
    joinRoom: async (roomId, notify) => {
        if (get().joining) return;
        set({ joining: true });

        try {
            const token = axiosInstance.defaults.headers.common['Authorization'];
            if (!token) {
                notify('warning', 'No auth token found, please login.', 3);
                set({ joining: false });
                return { success: false };
            }

            const dto = { roomId: Number(roomId) };
            const resp = await axiosInstance.post(`${roomURL}enter`, dto);

            if (resp.status === 200 && resp.data) {
                set({ currentRoom: resp.data });
                notify('success', `Joined room: ${resp.data.roomName} (${resp.data.roomId})`, 2);
                return { success: true, data: resp.data };
            } else {
                const msg = resp.data?.message || 'Failed to join room';
                notify('warning', msg, 3);
                return { success: false, message: msg };
            }
        } catch (err) {
            let msg = 'Network error';
            if (err.response?.data?.message) msg = err.response.data.message;
            else if (err.message) msg = err.message;
            notify('warning', msg, 3);
            return { success: false, message: msg };
        } finally {
            set({ joining: false });
        }
    },

    createRoom: async (roomDto, notify) => {
        if (get().creating) return;
        set({ creating: true });

        try {
            const token = axiosInstance.defaults.headers.common['Authorization'];
            if (!token) {
                notify('warning', 'No auth token found, please login.', 3);
                set({ creating: false });
                return { success: false };
            }

            const resp = await axiosInstance.post(`${roomURL}create`, roomDto);

            if (resp.status === 200 && resp.data) {
                set({ currentRoom: resp.data });
                notify('success', `Created room: ${resp.data.roomName} (${resp.data.roomId})`, 2);
                return { success: true, data: resp.data };
            } else {
                const msg = resp.data?.message || 'Failed to create room';
                notify('warning', msg, 3);
                return { success: false, message: msg };
            }
        } catch (err) {
            let msg = 'Network error';
            if (err.response?.data?.message) msg = err.response.data.message;
            else if (err.message) msg = err.message;
            notify('warning', msg, 3);
            return { success: false, message: msg };
        } finally {
            set({ creating: false });
        }
    },

    leaveRoom: () => {
        set({ currentRoom: null });
    },
}));
