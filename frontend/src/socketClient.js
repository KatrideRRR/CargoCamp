import { io } from "socket.io-client";

const socketUrl = process.env.REACT_APP_SOCKET_URL || process.env.REACT_APP_API_URL;

export const socket = io(socketUrl, {
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
});

export function connectSocket(userId) {
    if (!userId) return;

    if (!socket.connected) {
        socket.connect();
    }

    const register = () => {
        socket.emit("register", userId);
        socket.emit("subscribeToNotifications", userId);
    };

    if (socket.connected) {
        register();
    } else {
        socket.once("connect", register);
    }
}