const { QueryTypes } = require("sequelize");
const { sequelize, User } = require("../models");
const { requestTBank } = require("../config/tbankClient");

function customerKey(userId) {
    return `cargocamp_${userId}`;
}

async function createTBankCardBinding(userId) {
    const user = await User.findByPk(userId);

    if (!user) {
        throw new Error("Пользователь не найден");
    }

    const payment = await requestTBank("AddCard", {
        CustomerKey: customerKey(user.id),
        CheckType: "3DSHOLD",
    });

    const paymentId = String(payment.PaymentId || "");

    if (
        !paymentId ||
        paymentId.length > 128 ||
        !payment.PaymentURL
    ) {
        throw new Error(
            "Т-Банк не вернул данные для привязки карты"
        );
    }

    await sequelize.query(
        `
        INSERT INTO tbank_card_bind_attempts
            (payment_id, user_id)
        VALUES
            (:paymentId, :userId)
        `,
        {
            replacements: {
                paymentId,
                userId: user.id,
            },
        }
    );

    return {
        success: true,
        paymentId,
        confirmationUrl: payment.PaymentURL,
    };
}

async function processTBankCardNotification(body) {
    if (body.NotificationType !== "LINKCARD") {
        return false;
    }

    const paymentId = String(body.PaymentId || "");
    const status = String(body.Status || "");

    if (!paymentId || paymentId.length > 128) {
        throw new Error("Некорректный PaymentId привязки");
    }

    return sequelize.transaction(async (transaction) => {
        const attempts = await sequelize.query(
            `
            SELECT
                payment_id,
                user_id,
                confirmed,
                created_at
            FROM tbank_card_bind_attempts
            WHERE payment_id = :paymentId
            FOR UPDATE
            `,
            {
                replacements: { paymentId },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        const attempt = attempts[0];

        if (!attempt) {
            throw new Error(
                "Запрос привязки карты не найден"
            );
        }

        const user = await User.findByPk(
            attempt.user_id,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (!user) {
            throw new Error("Пользователь не найден");
        }

        if (
            String(body.CustomerKey) !==
            customerKey(user.id)
        ) {
            throw new Error(
                "CustomerKey не соответствует пользователю"
            );
        }

        if (Number(attempt.confirmed) === 1) {
            return true;
        }

        if (status === "REJECTED") {
            return true;
        }

        if (
            status !== "COMPLETED" ||
            body.Success !== true
        ) {
            return true;
        }

        const rebillId = String(body.RebillId || "");
        const cardId = String(body.CardId || "");

        if (
            !rebillId ||
            !cardId ||
            rebillId.length > 128 ||
            cardId.length > 128
        ) {
            throw new Error(
                "Т-Банк не предоставил RebillId или CardId"
            );
        }

        const pan = String(body.Pan || "");
        const lastFour = pan.replace(/\D/g, "").slice(-4);
        const cardMask = lastFour
            ? `•••• ${lastFour}`
            : null;

        const previousBindAt = user.tbankCardBoundAt
            ? new Date(user.tbankCardBoundAt)
            : null;

        const isOlderAttempt =
            previousBindAt &&
            new Date(attempt.created_at) <= previousBindAt;

        if (!isOlderAttempt) {
            await user.update(
                {
                    tbankRebillId: rebillId,
                    tbankCardId: cardId,
                    tbankCardMask: cardMask,
                    tbankCardBoundAt: new Date(),
                },
                { transaction }
            );
        }

        await sequelize.query(
            `
            UPDATE tbank_card_bind_attempts
            SET
                rebill_id = :rebillId,
                card_id = :cardId,
                card_mask = :cardMask,
                confirmed = 1
            WHERE payment_id = :paymentId
            `,
            {
                replacements: {
                    rebillId,
                    cardId,
                    cardMask,
                    paymentId,
                },
                transaction,
            }
        );

        return true;
    });
}

module.exports = {
    createTBankCardBinding,
    processTBankCardNotification,
    customerKey,
};