import axios from "axios";

import {
    Capacitor,
    CapacitorHttp,
} from "@capacitor/core";

import {
    ensureUserAccessToken,
    refreshUserSession,
    clearUserSessionLocal,
    isAccessTokenValid,
} from "./userSession";

const apiUrl = process.env.REACT_APP_API_URL;
const baseURL = `${apiUrl}/api`;

const isNativeIOS =
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios";

const axiosInstance = axios.create({
    baseURL,
    timeout: 30000,
    adapter: "xhr",
    headers: {
        Accept: "application/json",
    },
});

function resolveRequestUrl(config = {}) {
    const url = String(config.url || "");

    const base = String(
        config.baseURL || ""
    ).replace(/\/$/, "");

    const fullUrl = /^https?:\/\//i.test(url)
        ? url
        : base
            ? `${base}/${url.replace(/^\//, "")}`
            : url;

    return new URL(
        fullUrl,
        window.location.href
    );
}

function isProtectedApiRequest(config = {}) {
    let url;

    try {
        url = resolveRequestUrl(config);
    } catch {
        return false;
    }

    const expectedOrigin =
        new URL(apiUrl).origin;

    if (url.origin !== expectedOrigin) {
        return false;
    }

    const path = url.pathname;
    const method = String(
        config.method || "get"
    ).toLowerCase();

    if (!path.startsWith("/api/")) {
        return false;
    }

    // Публичные запросы не требуют JWT.
    if (
        method === "get" &&
        (
            path.startsWith("/api/category") ||
            path === "/api/orders/all" ||
            path === "/api/express/express-orders/available"
        )
    ) {
        return false;
    }

    // Не перехватываем вход, регистрацию,
    // SMS и сам механизм обновления сессии.
    if (
        /^\/api\/auth\/(login|login-sms|register|send-sms|recover-password)(\/|$)/.test(path) ||
        path.startsWith("/api/auth/password-reset/") ||
        path.startsWith("/api/auth/session/")
    ) {
        return false;
    }

    return true;
}

function setAuthorization(config, token) {
    config.headers = config.headers || {};

    if (typeof config.headers.set === "function") {
        config.headers.set(
            "Authorization",
            `Bearer ${token}`
        );
    } else {
        config.headers.Authorization =
            `Bearer ${token}`;
    }
}

// ----------------------------------------
// Сохраняем существующий нативный HTTP для iOS
// ----------------------------------------

async function nativeIOSRequest(config = {}) {
    const method = String(
        config.method || "get"
    ).toUpperCase();

    const fullUrl =
        resolveRequestUrl(config).toString();

    const rawHeaders =
        typeof config.headers?.toJSON === "function"
            ? config.headers.toJSON()
            : { ...(config.headers || {}) };

    const headers = {
        Accept: "application/json",
        ...rawHeaders,
    };

    if (
        ["POST", "PUT", "PATCH"].includes(method) &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    const response = await CapacitorHttp.request({
        method,
        url: fullUrl,
        headers,
        data: config.data,
        params: config.params,
        connectTimeout: 30000,
        readTimeout: 30000,
    });

    const axiosLikeResponse = {
        data: response.data,
        status: response.status,
        statusText: String(response.status),
        headers: response.headers || {},
        config,
        request: null,
    };

    if (
        response.status >= 200 &&
        response.status < 300
    ) {
        return axiosLikeResponse;
    }

    const error = new Error(
        `Request failed with status ${response.status}`
    );

    error.response = axiosLikeResponse;
    error.config = config;

    throw error;
}

// ----------------------------------------
// Общие перехватчики авторизации
// ----------------------------------------

function attachUserAuthInterceptors(client) {
    client.interceptors.request.use(
        async (config) => {
            if (!isProtectedApiRequest(config)) {
                return config;
            }

            try {
                const token =
                    await ensureUserAccessToken();

                if (token) {
                    setAuthorization(config, token);
                }

                return config;
            } catch (error) {
                const status =
                    error.response?.status;

                if (
                    status === 401 ||
                    status === 403
                ) {
                    await clearUserSessionLocal();
                }

                return Promise.reject(error);
            }
        }
    );

    client.interceptors.response.use(
        (response) => response,

        async (error) => {
            const config = error.config;

            if (
                error.response?.status !== 401 ||
                !config ||
                config._cargoAuthRetry ||
                !isProtectedApiRequest(config)
            ) {
                return Promise.reject(error);
            }

            config._cargoAuthRetry = true;

            const authorization =
                typeof config.headers?.get === "function"
                    ? config.headers.get("Authorization")
                    : config.headers?.Authorization;

            const staleToken =
                String(authorization || "")
                    .replace(/^Bearer\s+/i, "");

            try {
                const newToken =
                    await refreshUserSession(
                        staleToken
                    );

                setAuthorization(
                    config,
                    newToken
                );

                return client.request(config);
            } catch (refreshError) {
                const status =
                    refreshError.response?.status;

                if (
                    status === 401 ||
                    status === 403
                ) {
                    const latestToken =
                        localStorage.getItem(
                            "authToken"
                        );

                    // Если другая вкладка успела
                    // обновить JWT, не удаляем его.
                    if (
                        latestToken &&
                        latestToken !== staleToken &&
                        isAccessTokenValid(latestToken)
                    ) {
                        setAuthorization(
                            config,
                            latestToken
                        );

                        return client.request(config);
                    }

                    await clearUserSessionLocal();
                }

                return Promise.reject(
                    refreshError
                );
            }
        }
    );
}

// Важно: регистрируем нативный адаптер до
// общего auth-interceptor.
axiosInstance.interceptors.request.use(
    (config) => {
        if (isNativeIOS) {
            config.adapter = () =>
                nativeIOSRequest(config);
        }

        return config;
    }
);

// Наш axiosInstance
attachUserAuthInterceptors(axiosInstance);

// Обычный axios, используемый другими страницами
attachUserAuthInterceptors(axios);

export default axiosInstance;