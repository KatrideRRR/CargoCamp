import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const UserContext = createContext();

function getSavedUser() {
    try {
        const saved = localStorage.getItem("currentUser");
        return saved ? JSON.parse(saved) : null;
    } catch {
        localStorage.removeItem("currentUser");
        return null;
    }
}

export const UserProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(getSavedUser);

    useEffect(() => {
        if (currentUser) {
            localStorage.setItem("currentUser", JSON.stringify(currentUser));
        } else {
            localStorage.removeItem("currentUser");
        }
    }, [currentUser]);

    const value = useMemo(() => {
        return {
            currentUser,
            setCurrentUser,
        };
    }, [currentUser]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => useContext(UserContext);