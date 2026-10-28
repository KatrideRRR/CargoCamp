const path = require("path");
const fs = require("fs");

const backendRoot = path.resolve(__dirname, "..");

require("dotenv").config({
    path: path.join(
        backendRoot,
        fs.existsSync(
            path.join(backendRoot, ".env.local")
        )
            ? ".env.local"
            : ".env"
    ),
});

const { QueryTypes } = require("sequelize");

const { sequelize } = require("../models");

const yooKassa = require("../config/yookassaClient");

const {
    requestTBank,
} = require("../config/tbankClient");

const {
    applyConfirmedPayment,
} = require("../services/paymentReceiptService");

const {
    startCommissionAutoCharge,
} = require("../services/commissionAutoChargeService");

async function main() {
    const attempts = await sequelize.query(
        `
        SELECT *
        FROM commission_charge_attempts
        WHERE status IN (
            'prepared',
            'initiated',
            'pending',
            'unknown'
        )
        ORDER BY id ASC
        LIMIT 100
        `,
        {
            type: QueryTypes.SELECT,
        }
    );

    for (const attempt of attempts) {
        try {
            if (attempt.status === "prepared") {
                // Единственный случай, когда допустим
                // запуск ранее не отправленного платежа.
                const result =
                    await startCommissionAutoCharge(
                        attempt.id
                    );

                console.log(
                    "Prepared attempt:",
                    attempt.id,
                    result.autoPaymentStatus
                );

                continue;
            }

            if (!attempt.provider_payment_id) {
                console.warn(
                    "Требуется ручная сверка:",
                    attempt.id,
                    "PaymentId неизвестен"
                );

                continue;
            }

            const paymentId =
                String(attempt.provider_payment_id);

            let confirmed = false;
            let failed = false;

            if (attempt.provider === "yookassa") {
                const payment =
                    await yooKassa.getPayment(
                        paymentId
                    );

                if (
                    Number(
                        payment?.metadata?.autoAttemptId
                    ) !== Number(attempt.id) ||
                    Number(payment?.metadata?.userId) !==
                    Number(attempt.user_id) ||
                    Math.round(
                        Number(payment?.amount?.value) * 100
                    ) !== Number(attempt.amount_kopecks)
                ) {
                    throw new Error(
                        "Данные платежа ЮKassa не совпадают"
                    );
                }

                confirmed =
                    payment.status === "succeeded";

                failed =
                    payment.status === "canceled";
            } else if (attempt.provider === "tbank") {
                const payment =
                    await requestTBank("GetState", {
                        PaymentId: paymentId,
                    });

                const expectedOrderId =
                    `debt_${attempt.user_id}_auto${attempt.id}`;

                if (
                    String(payment.PaymentId) !== paymentId ||
                    String(payment.OrderId) !==
                    expectedOrderId ||
                    Number(payment.Amount) !==
                    Number(attempt.amount_kopecks)
                ) {
                    throw new Error(
                        "Данные платежа Т-Банка не совпадают"
                    );
                }

                confirmed =
                    payment.Status === "CONFIRMED";

                failed = [
                    "REJECTED",
                    "CANCELED",
                    "REVERSED",
                    "DEADLINE_EXPIRED",
                ].includes(payment.Status);
            }

            if (confirmed) {
                await applyConfirmedPayment({
                    provider: attempt.provider,
                    paymentId,
                    userId: attempt.user_id,
                    purpose: "debt",
                    amountKopecks:
                        Number(attempt.amount_kopecks),
                    commissionAttemptId: attempt.id,
                });

                console.log(
                    "Платёж подтверждён:",
                    attempt.id
                );
            } else if (failed) {
                await sequelize.query(
                    `
                    UPDATE commission_charge_attempts
                    SET status = 'failed'
                    WHERE id = :id
                      AND status <> 'succeeded'
                    `,
                    {
                        replacements: { id: attempt.id },
                    }
                );

                console.log(
                    "Платёж не прошёл:",
                    attempt.id
                );
            } else {
                console.log(
                    "Платёж ещё не завершён:",
                    attempt.id
                );
            }
        } catch (error) {
            console.error(
                "Ошибка сверки:",
                attempt.id,
                error.message
            );
        }
    }
}

main()
    .catch(console.error)
    .finally(async () => {
        await sequelize.close();
    });