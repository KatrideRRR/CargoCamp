import React, {createContext, useContext, useEffect, useState, useMemo, useCallback,} from "react";
import {getJwtUser, startUserSession, ensureUserAccessToken, clearUserSessionLocal, endUserSession,} from "./userSession";
import { disconnectSocket } from "../socketClient";
import {unregisterCurrentPushToken, resetPushRegistration,} from "./pushNotifications";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);

    const restore = useCallback(async () => {
        setLoading(true);
        setAuthError(null);

        try {
            const token =
                await ensureUserAccessToken();

            setUser(getJwtUser(token));
        } catch (error) {
            const status = error.response?.status;

            if (status === 401 || status === 403) {
                await clearUserSessionLocal();
                setUser(null);
            } else {
                // Сетевая ошибка — не удаляем сессию.
                setAuthError(
                    "Не удалось подключиться к серверу CargoCamp."
                );
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        restore();

        const syncFromStorage = () => {
            const token =
                localStorage.getItem("authToken");

            setUser(getJwtUser(token));
        };

        const onLogout = () => {
            setUser(null);
        };

        window.addEventListener(
            "cargocamp:auth-changed",
            syncFromStorage
        );

        window.addEventListener(
            "auth:logout",
            onLogout
        );

        window.addEventListener(
            "storage",
            syncFromStorage
        );

        return () => {
            window.removeEventListener(
                "cargocamp:auth-changed",
                syncFromStorage
            );

            window.removeEventListener(
                "auth:logout",
                onLogout
            );

            window.removeEventListener(
                "storage",
                syncFromStorage
            );
        };
    }, [restore]);

    const login = useCallback(async (sessionData) => {
        const token =
            await startUserSession(sessionData);

        setUser(getJwtUser(token));
        setAuthError(null);

        return token;
    }, []);

    const logout = useCallback(async () => {
        try {
            // Сначала отвязываем Firebase-токен,
            // пока действительна авторизация.
            try {
                await unregisterCurrentPushToken();
            } catch (error) {
                console.warn(
                    "Не удалось отвязать push:",
                    error.message
                );
            }

            await endUserSession();
        } catch (error) {
            console.warn(
                "Серверный выход не подтверждён:",
                error.message
            );
        } finally {
            resetPushRegistration();
            disconnectSocket();

            setUser(null);
            setAuthError(null);
        }
    }, []);

    const value = useMemo(() => ({
        isAuthenticated: Boolean(user),
        user: user || {},
        login,
        logout,
        loading,
        authError,
        restore,
    }), [
        user,
        login,
        logout,
        loading,
        authError,
        restore,
    ]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);