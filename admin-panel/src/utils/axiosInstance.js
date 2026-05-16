import axios from "axios";

const apiUrl = process.env.REACT_APP_API_URL || "http://localhost:3001";

const axiosInstance = axios.create({
    baseURL: `${apiUrl}/api`,
});

axiosInstance.interceptors.request.use((config) => {
    const token =
        localStorage.getItem("adminToken") ||
        localStorage.getItem("token") ||
        localStorage.getItem("authToken");

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

export default axiosInstance;