import axios from "axios";
import axiosInstance from "./axiosInstance";
import { redirectToAdminLogin } from "./adminSession";

function isAdminApiRequest(config) {
    const requestUrl =
        `${config?.baseURL || ""}${config?.url || ""}`;

    const isAdminEndpoint =
        /\/(?:api\/)?admin(?:\/|$)/.test(requestUrl);

    const isLoginEndpoint =
        /\/admin\/login(?:[?#]|$)/.test(requestUrl);

    return isAdminEndpoint && !isLoginEndpoint;
}

function handleAdminAuthError(error) {
    const status = error.response?.status;
    const message = error.response?.data?.message;

    if (!isAdminApiRequest(error.config)) {
        return Promise.reject(error);
    }

    const sessionExpired = status === 401;

    const accessRevoked =
        status === 403 &&
        message === "Доступ запрещен";

    if (sessionExpired || accessRevoked) {
        redirectToAdminLogin(
            accessRevoked ? "access_revoked" : "expired"
        );
    }

    return Promise.reject(error);
}

// Для обычного axios, который используют большинство страниц
axios.interceptors.response.use(
    (response) => response,
    handleAdminAuthError
);

// Для отдельного экземпляра, который используется в поддержке
axiosInstance.interceptors.response.use(
    (response) => response,
    handleAdminAuthError
);