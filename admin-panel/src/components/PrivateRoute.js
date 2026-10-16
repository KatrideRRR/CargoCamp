import React, {
    useEffect,
    useState,
    useCallback,
} from "react";

import { Navigate } from "react-router-dom";

import {
    isAdminTokenValid,
    refreshAdminSession,
} from "../utils/adminSession";

const PrivateRoute = ({ children }) => {
    const [status, setStatus] = useState("checking");

    const verifySession = useCallback(async () => {
        // Токен должен действовать ещё хотя бы 2 минуты
        if (isAdminTokenValid(2 * 60 * 1000)) {
            setStatus("authenticated");
            return;
        }

        try {
            await refreshAdminSession();

            setStatus(
                isAdminTokenValid()
                    ? "authenticated"
                    : "unauthenticated"
            );
        } catch (error) {
            if (
                [401, 403].includes(
                    error.response?.status
                )
            ) {
                setStatus("unauthenticated");
            } else {
                // При сетевой ошибке не удаляем сессию
                setStatus("offline");
            }
        }
    }, []);

    useEffect(() => {
        verifySession();

        const interval = window.setInterval(
            verifySession,
            60 * 1000
        );

        const onVisibility = () => {
            if (!document.hidden) {
                verifySession();
            }
        };

        document.addEventListener(
            "visibilitychange",
            onVisibility
        );

        window.addEventListener(
            "focus",
            verifySession
        );

        return () => {
            window.clearInterval(interval);

            document.removeEventListener(
                "visibilitychange",
                onVisibility
            );

            window.removeEventListener(
                "focus",
                verifySession
            );
        };
    }, [verifySession]);

    if (status === "checking") {
        return <p>Проверяем сессию...</p>;
    }

    if (status === "offline") {
        return (
            <div style={{ padding: 30 }}>
                <h3>Не удалось связаться с сервером</h3>

                <p>
                    Проверьте подключение к интернету.
                    Ваша сессия не удалена.
                </p>

                <button onClick={verifySession}>
                    Повторить
                </button>
            </div>
        );
    }

    if (status === "unauthenticated") {
        return (
            <Navigate
                to="/login?reason=expired"
                replace
            />
        );
    }

    return children;
};

export default PrivateRoute;