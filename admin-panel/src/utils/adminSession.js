import axios from "axios";
import { jwtDecode } from "jwt-decode";

const apiUrl =
    process.env.REACT_APP_API_URL ||
    "http://localhost:3001";

let refreshPromise = null;

export function clearAdminSession() {
    [
        "authToken",
        "adminToken",
        "token",
        "userRole",
    ].forEach((key) => {
        localStorage.removeItem(key);
    });

    try {
        const keys = Object.keys(
            localStorage
        );

        keys.forEach((key) => {
            if (
                key.startsWith(
                    "cc:support:admin:"
                )
            ) {
                localStorage.removeItem(key);
            }
        });
    } catch (error) {
        console.warn(
            "Не удалось очистить черновики поддержки:",
            error
        );
    }
}

export function isAdminTokenValid(
    minimumRemainingMs = 0
) {
    const token = localStorage.getItem("authToken");

    if (!token) return false;

    try {
        const payload = jwtDecode(token);

        return (
            payload.role === "admin" &&
            typeof payload.exp === "number" &&
            payload.exp * 1000 >
            Date.now() + minimumRemainingMs
        );
    } catch {
        return false;
    }
}

export async function refreshAdminSession() {
    // Несколько параллельных запросов используют
    // одно обновление сессии.
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = axios
        .post(
            `${apiUrl}/api/admin/session/refresh`,
            {},
            {
                withCredentials: true,
            }
        )
        .then(({ data }) => {
            if (!data?.token) {
                throw new Error(
                    "Сервер не вернул токен доступа"
                );
            }

            localStorage.setItem(
                "authToken",
                data.token
            );

            localStorage.setItem(
                "userRole",
                "admin"
            );

            localStorage.removeItem("adminToken");
            localStorage.removeItem("token");

            return data.token;
        })
        .finally(() => {
            refreshPromise = null;
        });

    return refreshPromise;
}

export function redirectToAdminLogin() {
    clearAdminSession();

    if (window.location.pathname !== "/login") {
        window.location.replace(
            "/login?reason=expired"
        );
    }
}

export async function logoutAdminSession() {
    try {
        await axios.post(
            `${apiUrl}/api/admin/session/logout`,
            {},
            {
                withCredentials: true,
            }
        );
    } finally {
        clearAdminSession();
        window.location.replace("/login");
    }
}