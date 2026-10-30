const jwt = require("jsonwebtoken");

const {
    User,
    AuthSession,
} = require("../models");

async function validateSocketSession(data) {
    const now = Date.now();

    if (
        !data?.userId ||
        !data?.sessionId ||
        !["user", "admin"].includes(data.scope) ||
        !Number.isFinite(data.tokenExpiresAt) ||
        data.tokenExpiresAt <= now
    ) {
        return false;
    }

    const [user, session] = await Promise.all([
        User.findByPk(data.userId),
        AuthSession.findByPk(data.sessionId),
    ]);

    if (
        !user ||
        !session ||
        user.role === "banned" ||
        Number(session.userId) !== Number(user.id) ||
        session.scope !== data.scope ||
        session.revokedAt ||
        new Date(session.expiresAt).getTime() <= now ||
        new Date(session.absoluteExpiresAt).getTime() <= now
    ) {
        return false;
    }

    if (
        data.scope === "admin" &&
        user.role !== "admin"
    ) {
        return false;
    }

    return true;
}

async function authenticateSocket(socket, next) {
    try {
        const token = socket.handshake.auth?.token;

        if (
            typeof token !== "string" ||
            !token ||
            token.length > 4096
        ) {
            return next(
                new Error("SOCKET_UNAUTHORIZED")
            );
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET,
            {
                algorithms: ["HS256"],
            }
        );

        if (
            !decoded?.id ||
            !decoded?.sid ||
            !["user", "admin"].includes(decoded.scope)
        ) {
            return next(
                new Error("SOCKET_UNAUTHORIZED")
            );
        }

        const sessionData = {
            userId: String(decoded.id),
            sessionId: String(decoded.sid),
            scope: decoded.scope,
            tokenExpiresAt: decoded.exp * 1000,
        };

        if (
            !(await validateSocketSession(sessionData))
        ) {
            return next(
                new Error("SOCKET_UNAUTHORIZED")
            );
        }

        socket.data.userId = sessionData.userId;
        socket.data.sessionId = sessionData.sessionId;
        socket.data.scope = sessionData.scope;
        socket.data.tokenExpiresAt =
            sessionData.tokenExpiresAt;

        return next();
    } catch (error) {
        return next(
            new Error("SOCKET_UNAUTHORIZED")
        );
    }
}

module.exports = {
    authenticateSocket,
    validateSocketSession,
};