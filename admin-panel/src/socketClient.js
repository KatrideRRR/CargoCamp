import { io } from "socket.io-client";

const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:3001";

export const socket = io(apiUrl, {
    transports: ["websocket"],
    autoConnect: true,
});