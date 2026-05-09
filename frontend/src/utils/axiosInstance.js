import axios from "axios";

const apiUrl = process.env.REACT_APP_API_URL;

const axiosInstance = axios.create({
    baseURL: `${apiUrl}/api`,
    timeout: 10000,
    headers: {
        "Content-Type": "application/json",
    },
});

const clearAuthAndRedirect = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");

    window.dispatchEvent(new Event("auth:logout"));

    const currentPath = window.location.pathname;

    if (currentPath !== "/login" && currentPath !== "/register") {
        window.location.href = "/login";
    }
};

axiosInstance.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("authToken");

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const status = error?.response?.status;

        if (!originalRequest) {
            return Promise.reject(error);
        }

        if (status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const refreshToken = localStorage.getItem("refreshToken");

                if (!refreshToken) {
                    clearAuthAndRedirect();
                    return Promise.reject(error);
                }

                const refreshResponse = await axios.post(`${apiUrl}/api/token`, {
                    token: refreshToken,
                });

                const newAccessToken = refreshResponse.data?.accessToken;

                if (!newAccessToken) {
                    clearAuthAndRedirect();
                    return Promise.reject(error);
                }

                localStorage.setItem("authToken", newAccessToken);

                axiosInstance.defaults.headers.Authorization = `Bearer ${newAccessToken}`;
                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

                return axiosInstance(originalRequest);
            } catch (refreshError) {
                console.error("❌ Ошибка обновления токена:", refreshError);
                clearAuthAndRedirect();
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

const refreshAccessToken = async () => {
    try {
        const refreshToken = localStorage.getItem("refreshToken");

        if (!refreshToken) return;

        const response = await axios.post(`${apiUrl}/api/token`, {
            token: refreshToken,
        });

        const newAccessToken = response.data?.accessToken;

        if (!newAccessToken) return;

        localStorage.setItem("authToken", newAccessToken);
        axiosInstance.defaults.headers.Authorization = `Bearer ${newAccessToken}`;

        console.log("🔄 Токен обновлён в фоне");
    } catch (error) {
        console.error("⚠️ Ошибка обновления токена в фоне:", error);
    }
};

setInterval(refreshAccessToken, 10 * 60 * 1000);

export default axiosInstance;