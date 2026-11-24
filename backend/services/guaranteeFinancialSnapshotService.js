"use strict";

const {
    sequelize,
    Order,
    GuaranteeFinancialSnapshot,
} = require("../models");

const {
    buildGuaranteePreview,
} = require("./guaranteeQuoteService");

const {
    expectedPromotionKopecks,
} = require("./promotionPaymentService");

function fail(message, httpStatus = 409) {
    return Object.assign(new Error(message), {
        httpStatus,
    });
}

function validId(value) {
    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

function viewSnapshot(row, created) {
    return {
        created,
        id: row.id,
        orderId: row.orderId,
        status: row.status,
        pricingVersion: row.pricingVersion,
        previewOnly: true,
        availableForPayment: false,
        customerTotalKopecks:
            Number(row.customerTotalKopecks),
        executorPayoutKopecks:
            Number(row.executorPayoutKopecks),
        platformFeeKopecks:
            Number(row.platformFeeKopecks),
        promotionKopecks:
            Number(row.promotionKopecks),
    };
}

/**
 * Создаёт только предварительный финансовый снимок.
 *
 * НЕ создаёт банковский платёж.
 * НЕ подтверждает получение денег.
 * НЕ создаёт обязательство перед исполнителем.
 *
 * Пока тарифы банков не согласованы, статус
 * может быть только quoted.
 *
 * Этот сервис пока не подключаем к HTTP-маршрутам.
 */
async function createGuaranteePreviewSnapshot({
                                                  orderId,
                                                  actorUserId,
                                                  provider,
                                              }) {
    const id = validId(orderId);
    const actorId = validId(actorUserId);

    if (
        !id ||
        !actorId ||
        !["yookassa", "tbank"].includes(provider)
    ) {
        throw fail(
            "Некорректные параметры гарантийного расчёта",
            400
        );
    }

    return sequelize.transaction(async (transaction) => {
        // Блокируем заказ на время проверки и создания.
        const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail("Заказ не найден", 404);
        }

        if (Number(order.creatorId) !== actorId) {
            throw fail("Нет доступа к заказу", 403);
        }

        if (order.paymentType !== "guarantee") {
            throw fail(
                "Финансовый снимок запрещён для обычной оплаты"
            );
        }

        if (
            !["pending", "pending_payment"].includes(
                order.status
            ) ||
            order.executorId
        ) {
            throw fail(
                "Заказ не находится на этапе предварительного расчёта"
            );
        }

        // Берём цену из базы, не из параметров браузера.
        const workPriceKopecks =
            Number(order.proposedSum) * 100;

        if (
            !Number.isSafeInteger(workPriceKopecks) ||
            workPriceKopecks <= 0
        ) {
            throw fail("Некорректная цена заказа");
        }

        const preview =
            buildGuaranteePreview(workPriceKopecks);

        if (
            preview.previewOnly !== true ||
            preview.availableForPayment !== false ||
            preview.bankTariffsConfirmed !== false
        ) {
            throw fail(
                "Предварительный расчёт не подтверждён"
            );
        }

        // Продвижение тоже рассчитываем по данным заказа.
        const promotionKopecks =
            expectedPromotionKopecks(order);

        if (
            !Number.isSafeInteger(promotionKopecks) ||
            promotionKopecks < 0
        ) {
            throw fail("Некорректная цена продвижения");
        }

        const quote = preview.quote;

        const values = {
            orderId: id,
            creatorId: actorId,
            executorId: null,
            pricingVersion: preview.pricingVersion,
            pricingParameters: {
                assumptions: preview.assumptions,
                previewOnly: true,
                bankTariffsConfirmed: false,
                availableForPayment: false,
            },
            lockedAt: null,

            workPriceKopecks,
            buyerFeeKopecks: quote.buyerFeeKopecks,
            executorFeeKopecks:
            quote.executorFeeKopecks,
            platformFeeKopecks: quote.feeKopecks,
            promotionKopecks,

            customerTotalKopecks:
                quote.customerTotalKopecks +
                promotionKopecks,

            executorPayoutKopecks:
            quote.executorPayoutKopecks,

            provider,
            status: "quoted",
        };

        const existing =
            await GuaranteeFinancialSnapshot.findOne({
                where: { orderId: id },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

        if (existing) {
            // Повторный запрос не должен менять деньги.
            const unchanged =
                existing.status === "quoted" &&
                !existing.lockedAt &&
                existing.executorId == null &&
                Number(existing.creatorId) === actorId &&
                existing.provider === provider &&
                existing.pricingVersion ===
                values.pricingVersion &&
                Number(existing.workPriceKopecks) ===
                values.workPriceKopecks &&
                Number(existing.platformFeeKopecks) ===
                values.platformFeeKopecks &&
                Number(existing.promotionKopecks) ===
                values.promotionKopecks &&
                Number(existing.customerTotalKopecks) ===
                values.customerTotalKopecks &&
                Number(existing.executorPayoutKopecks) ===
                values.executorPayoutKopecks;

            if (!unchanged) {
                throw fail(
                    "Для заказа уже существует другой финансовый расчёт"
                );
            }

            return viewSnapshot(existing, false);
        }

        const created =
            await GuaranteeFinancialSnapshot.create(
                values,
                { transaction }
            );

        return viewSnapshot(created, true);
    });
}

module.exports = {
    createGuaranteePreviewSnapshot,
};