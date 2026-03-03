import { io } from "socket.io-client";

const apiUrl = process.env.REACT_APP_API_URL; // например http://localhost:5001

export const socket = io(apiUrl, {
    transports: ["websocket"],
    withCredentials: true,
});