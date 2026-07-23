import axios from "axios";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const apiUrl = process.env.REACT_APP_API_URL;
const baseURL = `${apiUrl}/api`;

const isNativeIOS =
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

const axiosInstance = axios.create({
    baseURL,
    timeout: 30000,
    adapter: "xhr",
    headers: {
        Accept: "application/json",
    },
});

function buildFullUrl(config = {}) {
    const url = String(config.url || "");

    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }

    const cleanBase = String(config.baseURL || baseURL).replace(/\/$/, "");
    const cleanUrl = url.startsWith("/") ? url : `/${url}`;

    return `${cleanBase}${cleanUrl}`;
}

function getToken() {
    return localStorage.getItem("authToken");
}

function isPublicGetRequest(config = {}) {
    const publicGetRoutes = [
        "/category",
        "/orders/all",
        "/express/express-orders/available",
    ];

    const method = String(config.method || "get").toLowerCase();
    const url = String(config.url || "");

    if (method !== "get") return false;

    return publicGetRoutes.some((route) => {
        return url === route || url.startsWith(`${route}?`) || url.startsWith(`${route}/`);
    });
}

async function nativeIOSRequest(config = {}) {
    const method = String(config.method || "get").toUpperCase();
    const fullUrl = buildFullUrl(config);
    const token = getToken();
    const publicGet = isPublicGetRequest(config);

    const headers = {
        Accept: "application/json",
        ...(config.headers || {}),
    };

    delete headers.common;
    delete headers.get;
    delete headers.post;
    delete headers.put;
    delete headers.patch;
    delete headers.delete;

    if (token && !publicGet) {
        headers.Authorization = `Bearer ${token}`;
    }

    if (["POST", "PUT", "PATCH"].includes(method)) {
        headers["Content-Type"] = "application/json";
    }

    console.log("NATIVE IOS API REQUEST:", {
        method,
        url: fullUrl,
        hasToken: Boolean(token && !publicGet),
        publicGet,
    });

    const response = await CapacitorHttp.request({
        method,
        url: fullUrl,
        headers,
        data: config.data,
        params: config.params,
        connectTimeout: 30000,
        readTimeout: 30000,
    });

    console.log("NATIVE IOS API RESPONSE:", {
        status: response.status,
        url: fullUrl,
    });

    const axiosLikeResponse = {
        data: response.data,
        status: response.status,
        statusText: String(response.status),
        headers: response.headers || {},
        config,
        request: null,
    };

    if (response.status >= 200 && response.status < 300) {
        return axiosLikeResponse;
    }

    const error = new Error(`Request failed with status code ${response.status}`);
    error.response = axiosLikeResponse;
    error.config = config;
    throw error;
}

axiosInstance.interceptors.request.use(
    async (config) => {
        if (isNativeIOS) {
            config.adapter = async () => nativeIOSRequest(config);
            return config;
        }

        const token = getToken();
        const publicGet = isPublicGetRequest(config);

        if (token && !publicGet) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
    (response) => {
        console.log("API RESPONSE:", {
            status: response.status,
            url: response.config?.url,
            method: response.config?.method,
        });

        return response;
    },
    async (error) => {
        console.error("API ERROR:", {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
            baseURL: error.config?.baseURL,
            url: error.config?.url,
            method: error.config?.method,
        });

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

                const refreshResponse = isNativeIOS
                    ? await CapacitorHttp.post({
                        url: `${baseURL}/token`,
                        headers: {
                            Accept: "application/json",
                            "Content-Type": "application/json",
                        },
                        data: {
                            token: refreshToken,
                        },
                        connectTimeout: 30000,
                        readTimeout: 30000,
                    })
                    : await axios.post(`${baseURL}/token`, {
                        token: refreshToken,
                    });

                const newAccessToken =
                    refreshResponse.data?.accessToken;

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

const refreshAccessToken = async () => {
    try {
        const refreshToken = localStorage.getItem("refreshToken");

        if (!refreshToken) return;

        const response = isNativeIOS
            ? await CapacitorHttp.post({
                url: `${baseURL}/token`,
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                data: {
                    token: refreshToken,
                },
                connectTimeout: 30000,
                readTimeout: 30000,
            })
            : await axios.post(`${baseURL}/token`, {
                token: refreshToken,
            });

        const newAccessToken = response.data?.accessToken;

        if (!newAccessToken) return;

        localStorage.setItem("authToken", newAccessToken);
        axiosInstance.defaults.headers.Authorization = `Bearer ${newAccessToken}`;

    } catch (error) {
        console.error("⚠️ Ошибка обновления токена в фоне:", error);
    }
};

setInterval(refreshAccessToken, 10 * 60 * 1000);

export default axiosInstance;