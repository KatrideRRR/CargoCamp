import { io } from "socket.io-client";

import {
    ensureUserAccessToken,
} from "./utils/userSession";

const socketUrl =
    process.env.REACT_APP_SOCKET_URL ||
    process.env.REACT_APP_API_URL;

let currentSocketUserId = null;

export const socket = io(socketUrl, {
    autoConnect: false,

    withCredentials: true,

    transports: [
        "websocket",
        "polling",
    ],

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,

    /*
     * На каждое новое соединение получаем
     * действующий access-token.
     *
     * Важно для iOS/Android после простоя,
     * когда предыдущий JWT мог истечь.
     */
    auth: (callback) => {
        ensureUserAccessToken()
            .then((token) => {
                callback({ token });
            })
            .catch((error) => {
                console.warn(
                    "Socket authentication unavailable:",
                    error.message
                );

                callback({ token: "" });
            });
    },
});

function registerCurrentUser() {
    if (!currentSocketUserId) return;

    socket.emit(
        "register",
        currentSocketUserId
    );

    socket.emit(
        "subscribeToNotifications",
        currentSocketUserId
    );
}

export function connectSocket(userId) {
    if (!userId) return;

    const nextUserId = String(userId);

    if (
        currentSocketUserId &&
        currentSocketUserId !== nextUserId
    ) {
        socket.disconnect();
    }

    currentSocketUserId = nextUserId;

    if (!socket.connected) {
        socket.connect();
    } else {
        registerCurrentUser();
    }
}

export function disconnectSocket() {
    currentSocketUserId = null;

    socket.disconnect();
}

socket.on("connect", registerCurrentUser);

/*
 * Если сервер отключил старое соединение,
 * повторно подключаемся с актуальным JWT.
 */
socket.on("disconnect", (reason) => {
    if (
        reason === "io server disconnect" &&
        currentSocketUserId
    ) {
        socket.connect();
    }
});

socket.on("connect_error", (error) => {
    console.warn(
        "CargoCamp socket connection error:",
        error.message
    );
});

/*
 * При обновлении пользовательского JWT
 * пересоздаём соединение с новым токеном.
 */
if (typeof window !== "undefined") {
    window.addEventListener(
        "cargocamp:auth-changed",
        () => {
            if (!currentSocketUserId) {
                return;
            }

            if (socket.connected) {
                socket.disconnect();
            }

            socket.connect();
        }
    );
}