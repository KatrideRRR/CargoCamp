const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const {
    sequelize,
    User,
    AuthSession,
} = require("../models");

const DAY = 24 * 60 * 60 * 1000;

const SESSION_SETTINGS = {
    admin: {
        idleDays: 30,
        maximumDays: 90,
    },
    user: {
        idleDays: 90,
        maximumDays: 180,
    },
};

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function generateRefreshToken() {
    return crypto.randomBytes(48).toString("hex");
}

function createAccessToken(user, session) {
    return jwt.sign(
        {
            id: user.id,
            phone: user.phone,
            role: user.role,
            sid: String(session.id),
            scope: session.scope,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "30m",
        }
    );
}

function createSessionError(message, status = 401) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function createAuthSession(user, scope) {
    const settings = SESSION_SETTINGS[scope];

    if (!settings) {
        throw new Error("Неизвестный тип сессии");
    }

    if (
        (scope === "admin" && user.role !== "admin") ||
        user.role === "banned"
    ) {
        throw createSessionError("Доступ запрещён", 403);
    }

    const now = Date.now();
    const refreshToken = generateRefreshToken();

    const session = await AuthSession.create({
        userId: user.id,
        scope,
        tokenHash: hashToken(refreshToken),

        expiresAt: new Date(
            now + settings.idleDays * DAY
        ),

        absoluteExpiresAt: new Date(
            now + settings.maximumDays * DAY
        ),

        lastUsedAt: new Date(now),
    });

    return {
        token: createAccessToken(user, session),
        refreshToken,
        expiresAt: session.expiresAt,
    };
}

async function refreshAuthSession(refreshToken, scope) {
    const settings = SESSION_SETTINGS[scope];

    if (!settings || !refreshToken) {
        throw createSessionError("Сессия недействительна");
    }

    return sequelize.transaction(async (transaction) => {
        const session = await AuthSession.findOne({
            where: {
                tokenHash: hashToken(refreshToken),
                scope,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!session) {
            throw createSessionError("Сессия не найдена");
        }

        const now = new Date();

        if (
            session.revokedAt ||
            session.expiresAt <= now ||
            session.absoluteExpiresAt <= now
        ) {
            throw createSessionError(
                "Срок действия сессии закончился"
            );
        }

        const user = await User.findByPk(
            session.userId,
            { transaction }
        );

        if (
            !user ||
            user.role === "banned" ||
            (scope === "admin" && user.role !== "admin")
        ) {
            throw createSessionError(
                "Доступ к сессии запрещён",
                403
            );
        }

        // Ротация refresh-token:
        // предыдущий токен становится недействительным.
        const nextRefreshToken = generateRefreshToken();

        const nextExpiry = new Date(
            Math.min(
                Date.now() + settings.idleDays * DAY,
                session.absoluteExpiresAt.getTime()
            )
        );

        await session.update(
            {
                tokenHash: hashToken(nextRefreshToken),
                expiresAt: nextExpiry,
                lastUsedAt: now,
            },
            { transaction }
        );

        return {
            token: createAccessToken(user, session),
            refreshToken: nextRefreshToken,
            expiresAt: nextExpiry,
        };
    });
}

async function revokeAuthSession(refreshToken, scope) {
    if (!refreshToken) return;

    await AuthSession.update(
        {
            revokedAt: new Date(),
        },
        {
            where: {
                tokenHash: hashToken(refreshToken),
                scope,
                revokedAt: null,
            },
        }
    );
}

module.exports = {
    createAuthSession,
    refreshAuthSession,
    revokeAuthSession,
};