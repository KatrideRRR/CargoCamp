import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";

import {
    isAdminSessionValid,
    clearAdminSession,
    redirectToAdminLogin,
} from "../utils/adminSession";

const PrivateRoute = ({ children }) => {
    const isAuthenticated = isAdminSessionValid();

    useEffect(() => {
        if (!isAuthenticated) {
            clearAdminSession();
            return;
        }

        const checkSession = () => {
            if (!isAdminSessionValid()) {
                redirectToAdminLogin("expired");
            }
        };

        // Проверяем авторизацию каждые 30 секунд
        const interval = window.setInterval(
            checkSession,
            30000
        );

        // Проверяем, когда пользователь возвращается на вкладку
        window.addEventListener("focus", checkSession);

        // Проверяем после выхода браузера из фонового режима
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                checkSession();
            }
        };

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        // Проверяем изменения авторизации в другой вкладке
        window.addEventListener("storage", checkSession);

        return () => {
            window.clearInterval(interval);

            window.removeEventListener(
                "focus",
                checkSession
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );

            window.removeEventListener(
                "storage",
                checkSession
            );
        };
    }, [isAuthenticated]);

    if (!isAuthenticated) {
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