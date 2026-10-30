import { io } from "socket.io-client";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "./utils/adminSession";

const apiUrl =
    process.env.REACT_APP_API_URL ||
    "http://localhost:3001";

export const socket = io(apiUrl, {
    transports: ["websocket"],

    autoConnect: false,

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,

    auth: (callback) => {
        const getToken = async () => {
            if (isAdminTokenValid(60 * 1000)) {
                return localStorage.getItem(
                    "authToken"
                );
            }

            return refreshAdminSession();
        };

        getToken()
            .then((token) => {
                callback({ token });
            })
            .catch((error) => {
                console.warn(
                    "Admin socket authentication unavailable:",
                    error.message
                );

                callback({ token: "" });
            });
    },
});

socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") {
        const token =
            localStorage.getItem("authToken");

        if (token) {
            socket.connect();
        }
    }
});

socket.on("connect_error", (error) => {
    console.warn(
        "Admin socket connection error:",
        error.message
    );
});