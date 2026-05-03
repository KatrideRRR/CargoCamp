import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { jwtDecode } from "jwt-decode";

export const AuthContext = createContext();

function getUserFromToken(token) {
    try {
        if (!token) return null;

        const decoded = jwtDecode(token);

        if (!decoded?.exp || decoded.exp * 1000 <= Date.now()) {
            localStorage.removeItem("authToken");
            return null;
        }

        return {
            id: decoded.id || "",
            role: decoded.role || "",
            name: decoded.name || "",
        };
    } catch {
        localStorage.removeItem("authToken");
        return null;
    }
}

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        const tokenUser = getUserFromToken(token);

        setUser(tokenUser);
        setLoading(false);
    }, []);

    const login = (token) => {
        localStorage.setItem("authToken", token);

        const tokenUser = getUserFromToken(token);
        setUser(tokenUser);
    };

    const logout = () => {
        localStorage.removeItem("authToken");
        localStorage.removeItem("currentUser");
        setUser(null);
    };

    const value = useMemo(() => {
        return {
            isAuthenticated: Boolean(user),
            user: user || {},
            login,
            logout,
            loading,
        };
    }, [user, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);