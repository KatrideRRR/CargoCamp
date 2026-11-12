const { QueryTypes } = require("sequelize");

const { sequelize, Order } = require("../models");
const yooKassa = require("../config/yookassaClient");
const { requestTBank } = require("../config/tbankClient");

const {
    expectedPromotionKopecks,
} = require("./promotionPaymentService");

function fail(message, httpStatus = 409) {
    return Object.assign(new Error(message), { httpStatus });
}

function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function preparePromotionPaymentRetry({ orderId, userId }) {
    const id = validId(orderId);
    const actorId = validId(userId);

    if (!id || !actorId) {
        throw fail("Некорректные параметры оплаты", 400);
    }

    const order = await Order.findByPk(id);

    if (!order) {
        throw fail("Заказ не найден", 404);
    }

    if (Number(order.creatorId) !== actorId) {
        throw fail("Нет доступа к заказу", 403);
    }

    if (order.status !== "pending_payment" || order.promotionPaidAt) {
        throw fail("Заказ больше не ожидает оплату продвижения");
    }

    const amountKopecks = expectedPromotionKopecks(order);

    if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
        throw fail("Некорректная стоимость продвижения");
    }

    const rows = await sequelize.query(
        `SELECT *
         FROM promotion_payment_intents
         WHERE order_id = :orderId`,
        {
            replacements: { orderId: id },
            type: QueryTypes.SELECT,
        }
    );

    const intent = rows[0];

    if (!intent) {
        if (order.promotionPaymentId) {
            throw fail(
                "Найден старый платёж без записи попытки. Требуется ручная сверка."
            );
        }

        return { ready: true, restarted: false };
    }

    if (
        Number(intent.user_id) !== actorId ||
        Number(intent.amount_kopecks) !== amountKopecks ||
        String(order.promotionPaymentId || "") !==
        String(intent.payment_id || "") ||
        order.promotionPaymentProvider !== intent.provider
    ) {
        throw fail("Данные банковской операции не совпадают");
    }

    if (!intent.payment_id) {
        throw fail(
            "Создание предыдущего платежа ещё не завершено. " +
            "Новая операция заблокирована."
        );
    }

    const paymentId = String(intent.payment_id);
    let bankStatus;
    let terminalFailure = false;

    if (intent.provider === "yookassa") {
        const payment = await yooKassa.getPayment(paymentId);

        const actualKopecks =
            Math.round(Number(payment?.amount?.value) * 100);

        if (
            String(payment?.id) !== paymentId ||
            payment?.amount?.currency !== "RUB" ||
            !Number.isSafeInteger(actualKopecks) ||
            actualKopecks !== amountKopecks ||
            payment?.metadata?.type !== "order_promotion" ||
            String(payment?.metadata?.orderId) !== String(id) ||
            String(payment?.metadata?.userId) !== String(actorId)
        ) {
            throw fail("ЮKassa вернула несоответствующий платёж");
        }

        bankStatus = payment.status;
        terminalFailure = bankStatus === "canceled";
    } else if (intent.provider === "tbank") {
        const payment = await requestTBank("GetState", {
            PaymentId: paymentId,
        });

        if (
            String(payment?.PaymentId) !== paymentId ||
            String(payment?.OrderId) !== String(intent.bank_order_id) ||
            String(payment?.TerminalKey) !==
            String(process.env.TBANK_TERMINAL_KEY) ||
            !Number.isSafeInteger(Number(payment?.Amount)) ||
            Number(payment.Amount) !== amountKopecks
        ) {
            throw fail("Т-Банк вернул несоответствующий платёж");
        }

        bankStatus = payment.Status;

        terminalFailure =
            bankStatus === "REJECTED" ||
            bankStatus === "CANCELED";
    } else {
        throw fail("Неизвестный платёжный провайдер");
    }

    if (!terminalFailure) {
        return {
            ready: false,
            restarted: false,
            provider: intent.provider,
            mode: intent.payment_mode,
            paymentId,
            status: bankStatus,
            confirmationUrl:
                intent.payment_mode === "redirect"
                    ? intent.confirmation_url || null
                    : null,
        };
    }

    // Банк подтвердил окончательный отказ.
    // Архивирование и освобождение заказа — одна транзакция.
    return sequelize.transaction(async (transaction) => {
        const lockedOrder = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (
            !lockedOrder ||
            Number(lockedOrder.creatorId) !== actorId ||
            lockedOrder.status !== "pending_payment" ||
            lockedOrder.promotionPaidAt ||
            String(lockedOrder.promotionPaymentId || "") !== paymentId ||
            lockedOrder.promotionPaymentProvider !== intent.provider
        ) {
            throw fail("Состояние заказа изменилось. Обновите страницу.");
        }

        const lockedRows = await sequelize.query(
            `SELECT *
             FROM promotion_payment_intents
             WHERE order_id = :orderId
             FOR UPDATE`,
            {
                replacements: { orderId: id },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        const current = lockedRows[0];

        if (
            !current ||
            String(current.idempotency_key) !==
            String(intent.idempotency_key) ||
            String(current.payment_id) !== paymentId ||
            current.provider !== intent.provider ||
            Number(current.amount_kopecks) !== amountKopecks
        ) {
            throw fail("Платёжная попытка уже изменилась");
        }

        await sequelize.query(
            `INSERT INTO promotion_payment_retry_history (
                order_id, user_id, provider, payment_mode,
                amount_kopecks, idempotency_key, bank_order_id,
                payment_id, previous_state, previous_status,
                verified_terminal_status
            ) VALUES (
                :orderId, :userId, :provider, :mode,
                :amount, :key, :bankOrderId,
                :paymentId, :state, :previousStatus,
                :terminalStatus
            )`,
            {
                replacements: {
                    orderId: id,
                    userId: actorId,
                    provider: current.provider,
                    mode: current.payment_mode,
                    amount: amountKopecks,
                    key: current.idempotency_key,
                    bankOrderId: current.bank_order_id,
                    paymentId,
                    state: current.state,
                    previousStatus: current.payment_status || null,
                    terminalStatus: bankStatus,
                },
                transaction,
            }
        );

        await sequelize.query(
            `DELETE FROM promotion_payment_intents
             WHERE order_id = :orderId`,
            {
                replacements: { orderId: id },
                transaction,
            }
        );

        await lockedOrder.update(
            {
                promotionPaymentId: null,
                promotionPaymentProvider: null,
            },
            { transaction }
        );

        return {
            ready: true,
            restarted: true,
            previousPaymentId: paymentId,
            previousProvider: intent.provider,
        };
    });
}

module.exports = {
    preparePromotionPaymentRetry,
};