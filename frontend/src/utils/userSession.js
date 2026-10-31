import axios from "axios";
import { CapacitorHttp } from "@capacitor/core";
import { jwtDecode } from "jwt-decode";

import {
    isNativeCargoCamp,
    saveNativeRefreshToken,
    getNativeRefreshToken,
    removeNativeRefreshToken,
} from "./userRefreshStorage";

import {
    clearAllChatOffline,
} from "./chatOfflineCache";

const API_URL = process.env.REACT_APP_API_URL;

const http = axios.create({
    baseURL: `${API_URL}/api`,
    timeout: 30000,
});

let refreshPromise = null;

export const getSessionClient = () =>
    isNativeCargoCamp() ? "native" : "web";

export function getJwtUser(token) {
    if (!token) return null;

    try {
        const payload = jwtDecode(token);

        if (
            !payload?.id ||
            !Number.isFinite(payload.exp) ||
            payload.exp * 1000 <= Date.now()
        ) {
            return null;
        }

        return {
            id: payload.id,
            role: payload.role || "user",
            name: payload.name || "",
        };
    } catch {
        return null;
    }
}

export function isAccessTokenValid(
    token,
    minimumRemainingMs = 0
) {
    try {
        if (!token) return false;

        const payload = jwtDecode(token);

        return (
            Number.isFinite(payload.exp) &&
            payload.exp * 1000 >
            Date.now() + minimumRemainingMs
        );
    } catch {
        return false;
    }
}

function notifyAuthChanged() {
    window.dispatchEvent(
        new Event("cargocamp:auth-changed")
    );
}

function createNativeHttpError(response) {
    const error = new Error(
        response.data?.message ||
        `HTTP ${response.status}`
    );

    error.response = {
        status: response.status,
        data: response.data,
    };

    return error;
}

async function sessionRequest(path, data) {
    if (isNativeCargoCamp()) {
        const response = await CapacitorHttp.post({
            url: `${API_URL}/api/auth/${path}`,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            data,
            connectTimeout: 30000,
            readTimeout: 30000,
        });

        if (
            response.status < 200 ||
            response.status >= 300
        ) {
            throw createNativeHttpError(response);
        }

        return response.data;
    }

    const response = await http.post(
        `/auth/${path}`,
        data,
        { withCredentials: true }
    );

    return response.data;
}

// Используем для входа по паролю, SMS и регистрации.
export async function postUserAuth(path, data) {
    return sessionRequest(path, {
        ...data,
        sessionClient: getSessionClient(),
    });
}

async function storeSessionResponse(data) {
    if (!data?.token) {
        throw new Error(
            "Сервер не вернул токен доступа"
        );
    }

    if (!getJwtUser(data.token)) {
        throw new Error(
            "Сервер вернул некорректный JWT"
        );
    }

    if (isNativeCargoCamp()) {
        if (!data.refreshToken) {
            throw new Error(
                "Сервер не вернул refresh-token"
            );
        }

        // Сначала безопасно сохраняем refresh-token.
        await saveNativeRefreshToken(
            data.refreshToken
        );
    }

    localStorage.setItem(
        "authToken",
        data.token
    );

    // Убираем остатки старой системы.
    localStorage.removeItem("refreshToken");

    notifyAuthChanged();

    return data.token;
}

export async function startUserSession(data) {
    return storeSessionResponse(data);
}

// Сервис вызывает это внутри единственного refresh-потока.
async function performRefresh() {
    const client = getSessionClient();

    let refreshToken = null;

    if (client === "native") {
        refreshToken =
            await getNativeRefreshToken();

        if (!refreshToken) {
            const error = new Error(
                "Сохранённая сессия отсутствует"
            );

            error.response = { status: 401 };

            throw error;
        }
    }

    const response = await sessionRequest(
        "session/refresh",
        {
            sessionClient: client,
            ...(client === "native"
                ? { refreshToken }
                : {}),
        }
    );

    return storeSessionResponse(response);
}

export async function refreshUserSession(
    staleToken = null
) {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        const oldToken =
            staleToken ??
            localStorage.getItem("authToken");

        const refresh = async () => {
            const currentToken =
                localStorage.getItem("authToken");

            // Другая вкладка могла уже обновить JWT.
            if (
                currentToken !== oldToken &&
                isAccessTokenValid(
                    currentToken,
                    30 * 1000
                )
            ) {
                return currentToken;
            }

            return performRefresh();
        };

        // Синхронизация вкладок на браузерах,
        // поддерживающих Web Locks API.
        if (
            !isNativeCargoCamp() &&
            navigator.locks?.request
        ) {
            return navigator.locks.request(
                "cargocamp-user-session-refresh",
                refresh
            );
        }

        // Для одной вкладки и нативного приложения
        // достаточно общего refreshPromise.
        return refresh();
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

export async function ensureUserAccessToken(
    minimumRemainingMs = 60 * 1000
) {
    const currentToken =
        localStorage.getItem("authToken");

    if (
        isAccessTokenValid(
            currentToken,
            minimumRemainingMs
        )
    ) {
        return currentToken;
    }

    try {
        return await refreshUserSession(
            currentToken
        );
    } catch (error) {
        // Совместимость со старым JWT на 7 дней.
        // Пока он ещё действителен, разрешаем
        // использовать его без новой сессии.
        let isLegacyToken = false;

        try {
            if (currentToken) {
                const payload = jwtDecode(currentToken);

                isLegacyToken =
                    !payload.sid &&
                    !payload.scope;
            }
        } catch {
            // Некорректный JWT.
        }

        if (
            isLegacyToken &&
            isAccessTokenValid(currentToken, 0)
        ) {
            return currentToken;
        }

        throw error;
    }
}

export async function clearUserSessionLocal() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    localStorage.removeItem("currentUser");

    try {
        const prefixes = [
            "cc:chat:pending:v1:",
            "cc:chat:draft:v1:",
            "cc:chat:reply:v1:",
        ];

        for (const storage of [
            window.localStorage,
            window.sessionStorage,
        ]) {
            const keys = Object.keys(storage);

            keys.forEach((key) => {
                if (
                    prefixes.some((prefix) =>
                        key.startsWith(prefix)
                    )
                ) {
                    storage.removeItem(key);
                }
            });
        }
    } catch (error) {
        console.warn(
            "Не удалось очистить черновики:",
            error
        );
    }

    try {
        await clearAllChatOffline();
    } catch (error) {
        console.warn(
            "Не удалось очистить локальную историю:",
            error
        );
    }

    try {
        await removeNativeRefreshToken();
    } catch (error) {
        console.error(
            "Не удалось очистить защищённое хранилище:",
            error
        );
    }

    window.dispatchEvent(
        new Event("auth:logout")
    );

    notifyAuthChanged();
}

export async function endUserSession() {
    const client = getSessionClient();

    try {
        let refreshToken = null;

        if (client === "native") {
            refreshToken =
                await getNativeRefreshToken();
        }

        if (client === "web" || refreshToken) {
            await sessionRequest(
                "session/logout",
                {
                    sessionClient: client,
                    ...(client === "native"
                        ? { refreshToken }
                        : {}),
                }
            );
        }
    } finally {
        await clearUserSessionLocal();
    }
}