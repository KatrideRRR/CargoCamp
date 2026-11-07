const crypto = require("node:crypto");

const {
    sequelize,
    SmsCodeState,
} = require("../models");

const CODE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;
const PENDING_MS = 30 * 1000;

const PURPOSES = new Set([
    "register",
    "login",
    "password_reset",
]);

function smsError(message, status = 400, waitSec = null) {
    const error = new Error(message);
    error.status = status;

    if (waitSec !== null) {
        error.waitSec = waitSec;
    }

    return error;
}

function validateInput(phone, purpose) {
    if (!/^7\d{10}$/.test(String(phone))) {
        throw smsError("Некорректный номер телефона");
    }

    if (!PURPOSES.has(purpose)) {
        throw smsError("Недопустимое назначение SMS-кода");
    }
}

function getSecret() {
    const value = String(
        process.env.SMS_CODE_SECRET || ""
    );

    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error(
            "SMS_CODE_SECRET должен содержать 64 hex-символа"
        );
    }

    return Buffer.from(value, "hex");
}

function hashCode(phone, purpose, code) {
    return crypto
        .createHmac("sha256", getSecret())
        .update(`${phone}:${purpose}:${code}`)
        .digest("hex");
}

function compareHashes(left, right) {
    if (
        !/^[a-f0-9]{64}$/i.test(String(left || "")) ||
        !/^[a-f0-9]{64}$/i.test(String(right || ""))
    ) {
        return false;
    }

    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");

    return crypto.timingSafeEqual(a, b);
}

function timestamp(value) {
    if (!value) return null;

    const result = new Date(value).getTime();

    return Number.isFinite(result)
        ? result
        : null;
}

/**
 * Резервируем право отправить SMS.
 *
 * Никакой HTTP-запрос к SMS.ru здесь
 * не выполняется.
 *
 * Транзакция короткая:
 * только проверка и изменение записи.
 */
async function reserveSmsCode({
                                  phone,
                                  purpose,
                              }) {
    validateInput(phone, purpose);

    // Проверяем секрет до обращения к БД.
    getSecret();

    // Уникальный ключ phone позволяет создать
    // не более одной записи на номер.
    await SmsCodeState.findOrCreate({
        where: { phone },
        defaults: { phone },
    });

    return sequelize.transaction(async (transaction) => {
        const state = await SmsCodeState.findByPk(
            phone,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (!state) {
            throw new Error(
                "Не удалось получить состояние SMS"
            );
        }

        const now = Date.now();

        const pendingUntil =
            timestamp(state.pendingUntil);

        if (
            state.status === "pending" &&
            pendingUntil !== null &&
            pendingUntil > now
        ) {
            throw smsError(
                "Отправка SMS уже выполняется",
                429,
                Math.ceil(
                    (pendingUntil - now) / 1000
                )
            );
        }

        const lastSentAt =
            timestamp(state.lastSentAt);

        if (
            lastSentAt !== null &&
            now - lastSentAt < COOLDOWN_MS
        ) {
            const waitSec = Math.ceil(
                (
                    COOLDOWN_MS -
                    (now - lastSentAt)
                ) / 1000
            );

            throw smsError(
                `Отправить код повторно можно через ${waitSec} сек.`,
                429,
                waitSec
            );
        }

        const previousWindow =
            timestamp(state.windowStartedAt);

        const isCurrentWindow =
            previousWindow !== null &&
            now >= previousWindow &&
            now - previousWindow < WINDOW_MS;

        const sendCount = isCurrentWindow
            ? Number(state.sendCount || 0)
            : 0;

        if (sendCount >= MAX_SENDS) {
            throw smsError(
                "Слишком много попыток отправки SMS. Попробуйте позже.",
                429,
                Math.ceil(
                    (
                        WINDOW_MS -
                        (now - previousWindow)
                    ) / 1000
                )
            );
        }

        const code = crypto
            .randomInt(100000, 1000000)
            .toString();

        const reservationId =
            crypto.randomUUID();

        await state.update(
            {
                purpose,
                codeHash: hashCode(
                    phone,
                    purpose,
                    code
                ),

                status: "pending",
                attempts: 0,

                reservationId,

                pendingUntil: new Date(
                    now + PENDING_MS
                ),

                expiresAt: new Date(
                    now + CODE_TTL_MS
                ),

                lastSentAt: new Date(now),

                windowStartedAt: isCurrentWindow
                    ? new Date(previousWindow)
                    : new Date(now),

                sendCount: sendCount + 1,
            },
            {
                transaction,
            }
        );

        return {
            code,
            reservationId,
            cooldownSec: COOLDOWN_MS / 1000,
            expiresInSec: CODE_TTL_MS / 1000,
        };
    });
}

/**
 * Вызывается после ответа SMS.ru.
 *
 * success=true — SMS принято провайдером.
 * success=false — код отменяется.
 *
 * Лимиты отправки сохраняются даже
 * при ошибке провайдера.
 */
async function completeSmsSend({
                                   phone,
                                   reservationId,
                                   success,
                               }) {
    return sequelize.transaction(async (transaction) => {
        const state = await SmsCodeState.findByPk(
            phone,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (
            !state ||
            state.status !== "pending" ||
            state.reservationId !== reservationId
        ) {
            return false;
        }

        const pendingUntil =
            timestamp(state.pendingUntil);

        if (
            pendingUntil === null ||
            pendingUntil <= Date.now()
        ) {
            return false;
        }

        await state.update(
            success
                ? {
                    status: "active",
                    reservationId: null,
                    pendingUntil: null,
                }
                : {
                    status: "idle",
                    purpose: null,
                    codeHash: null,
                    attempts: 0,
                    reservationId: null,
                    pendingUntil: null,
                    expiresAt: null,
                },
            {
                transaction,
            }
        );

        return true;
    });
}

/**
 * Атомарная проверка и использование кода.
 *
 * Важная особенность:
 * неправильная попытка возвращает результат,
 * а НЕ бросает исключение внутри транзакции.
 *
 * Иначе транзакция откатила бы
 * увеличение счётчика попыток.
 */
async function consumeSmsCode({
                                  phone,
                                  purpose,
                                  code,
                              }) {
    validateInput(phone, purpose);

    getSecret();

    return sequelize.transaction(async (transaction) => {
        const state = await SmsCodeState.findByPk(
            phone,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (
            !state ||
            state.status !== "active" ||
            state.purpose !== purpose
        ) {
            return {
                ok: false,
                reason: "not_found",
            };
        }

        const expiresAt =
            timestamp(state.expiresAt);

        if (
            expiresAt === null ||
            expiresAt <= Date.now()
        ) {
            await state.update(
                {
                    status: "idle",
                    purpose: null,
                    codeHash: null,
                    expiresAt: null,
                },
                {
                    transaction,
                }
            );

            return {
                ok: false,
                reason: "expired",
            };
        }

        const expectedHash = hashCode(
            phone,
            purpose,
            String(code || "")
        );

        const matches =
            compareHashes(
                state.codeHash,
                expectedHash
            );

        if (!matches) {
            const attempts =
                Number(state.attempts || 0) + 1;

            await state.update(
                attempts >= MAX_ATTEMPTS
                    ? {
                        attempts,
                        status: "idle",
                        purpose: null,
                        codeHash: null,
                        expiresAt: null,
                    }
                    : {
                        attempts,
                    },
                {
                    transaction,
                }
            );

            return {
                ok: false,
                reason:
                    attempts >= MAX_ATTEMPTS
                        ? "too_many_attempts"
                        : "incorrect",
            };
        }

        // Код используется ровно один раз.
        // Лимиты отправки НЕ очищаются.
        await state.update(
            {
                status: "idle",
                purpose: null,
                codeHash: null,
                expiresAt: null,
                attempts: 0,
            },
            {
                transaction,
            }
        );

        return {
            ok: true,
        };
    });
}

module.exports = {
    reserveSmsCode,
    completeSmsSend,
    consumeSmsCode,
};