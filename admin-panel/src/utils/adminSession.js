import { jwtDecode } from "jwt-decode";

const AUTH_KEYS = [
    "authToken",
    "adminToken",
    "token",
    "userRole",
];

export function clearAdminSession() {
    AUTH_KEYS.forEach((key) => {
        localStorage.removeItem(key);
    });
}

export function isAdminSessionValid() {
    const token = localStorage.getItem("authToken");
    const role = localStorage.getItem("userRole");

    if (!token || role !== "admin") {
        return false;
    }

    try {
        const decoded = jwtDecode(token);

        // У административного JWT обязательно должен быть срок действия.
        if (
            typeof decoded.exp !== "number" ||
            decoded.exp * 1000 <= Date.now()
        ) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

export function redirectToAdminLogin(reason = "expired") {
    clearAdminSession();

    if (window.location.pathname === "/login") {
        return;
    }

    const query = new URLSearchParams({
        reason,
    });

    window.location.replace(`/login?${query.toString()}`);
}