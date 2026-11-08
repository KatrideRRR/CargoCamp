const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");

require("dotenv").config({
    path: path.join(
        root,
        fs.existsSync(path.join(root, ".env.local"))
            ? ".env.local"
            : ".env"
    ),
});

const { QueryTypes } = require("sequelize");

const {
    sequelize,
} = require("../models");

async function main() {
    console.log(
        "\n=== CARGOCAMP PAYMENT SAFETY AUDIT ==="
    );

    console.log(
        "База:",
        process.env.DB_NAME
    );

    /*
     * 1. Неопределённые операции продвижения.
     */
    const intents = await sequelize.query(
        `
        SELECT
            order_id,
            provider,
            payment_mode,
            payment_id,
            bank_order_id,
            state,
            created_at,
            updated_at
        FROM promotion_payment_intents
        WHERE
            state IN ('creating', 'failed')
            OR payment_id IS NULL
        ORDER BY updated_at ASC
        LIMIT 100
        `,
        {
            type: QueryTypes.SELECT,
        }
    );

    /*
     * 2. Платежи по задолженности,
     * которые применились не полностью.
     */
    const overpayments = await sequelize.query(
        `
        SELECT
            provider,
            payment_id,
            user_id,
            amount_kopecks,
            applied_kopecks,

            (
                amount_kopecks -
                applied_kopecks
            ) AS excess_kopecks

        FROM payment_receipts

        WHERE
            purpose = 'debt'
            AND amount_kopecks > applied_kopecks

        ORDER BY processed_at DESC
        LIMIT 100
        `,
        {
            type: QueryTypes.SELECT,
        }
    );

    /*
     * 3. Автосписания,
     * требующие дополнительной сверки.
     */
    const attempts = await sequelize.query(
        `
        SELECT
            id,
            source_type,
            source_id,
            user_id,
            provider,
            amount_kopecks,
            provider_payment_id,
            status,
            updated_at

        FROM commission_charge_attempts

        WHERE
            status IN (
                'initiated',
                'pending',
                'unknown'
            )
            AND updated_at <
                DATE_SUB(NOW(), INTERVAL 30 MINUTE)

        ORDER BY updated_at ASC
        LIMIT 100
        `,
        {
            type: QueryTypes.SELECT,
        }
    );

    console.log(
        "\n1. Неопределённые платежи продвижения:",
        intents.length
    );

    for (const item of intents) {
        console.warn({
            orderId: item.order_id,
            provider: item.provider,
            paymentId: item.payment_id,
            bankOrderId: item.bank_order_id,
            state: item.state,
        });
    }

    console.log(
        "\n2. Платежи с переплатой:",
        overpayments.length
    );

    for (const item of overpayments) {
        console.warn({
            provider: item.provider,
            paymentId: item.payment_id,
            userId: item.user_id,

            paidRubles:
                Number(item.amount_kopecks) / 100,

            appliedRubles:
                Number(item.applied_kopecks) / 100,

            excessRubles:
                Number(item.excess_kopecks) / 100,
        });
    }

    console.log(
        "\n3. Неопределённые автосписания:",
        attempts.length
    );

    for (const item of attempts) {
        console.warn({
            attemptId: item.id,
            provider: item.provider,
            paymentId: item.provider_payment_id,
            status: item.status,
            amountKopecks: item.amount_kopecks,
        });
    }

    console.log("\n=== ИТОГ ===");

    console.log({
        unresolvedPromotions: intents.length,
        possibleOverpayments: overpayments.length,
        unresolvedAutoCharges: attempts.length,
    });

    if (
        intents.length ||
        overpayments.length ||
        attempts.length
    ) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(
            "Payment safety audit failed:",
            error.message
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });