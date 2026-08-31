import React from "react";
import { Navigate } from "react-router-dom";

const PrivateRoute = ({ children }) => {
    const token = localStorage.getItem("authToken");
    const role = localStorage.getItem("userRole");

    const hasValidLocalAuth =
        token &&
        token !== "null" &&
        token !== "undefined" &&
        role === "admin";

    if (!hasValidLocalAuth) {
        localStorage.removeItem("authToken");
        localStorage.removeItem("userRole");

        return <Navigate to="/login" replace />;
    }

    return children;
};

export default PrivateRoute;