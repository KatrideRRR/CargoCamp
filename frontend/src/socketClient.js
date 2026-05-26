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

let currentSocketUserId = null;

function registerCurrentUser() {
    if (!currentSocketUserId) return;

    socket.emit("register", currentSocketUserId);
    socket.emit("subscribeToNotifications", currentSocketUserId);
}

export function connectSocket(userId) {
    if (!userId) return;

    currentSocketUserId = String(userId);

    if (!socket.connected) {
        socket.connect();
    } else {
        registerCurrentUser();
    }
}

socket.on("connect", registerCurrentUser);
socket.on("reconnect", registerCurrentUser);