const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");

require("dotenv").config({
    path: path.join(
        root,
        fs.existsSync(
            path.join(root, ".env.local")
        )
            ? ".env.local"
            : ".env"
    ),
});

const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    ExpressOrder,
    Contract,
} = require("../models");

async function audit() {
    console.log(
        "Проверяем базу:",
        process.env.DB_NAME
    );

    const orders = await Order.findAll({
        where: {
            status: {
                [Op.in]: ["active", "reserved"],
            },
        },
    });

    const expressOrders = await ExpressOrder.findAll({
        where: {
            status: {
                [Op.notIn]: [
                    "created",
                    "completed",
                    "cancelled",
                ],
            },
        },
    });

    const byExecutor = new Map();
    const errors = [];
    const warnings = [];
    const information = [];

    function addAssignment(executorId, record) {
        const id = Number(executorId);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return;
        }

        if (!byExecutor.has(id)) {
            byExecutor.set(id, []);
        }

        byExecutor.get(id).push(record);
    }

    for (const order of orders) {
        addAssignment(order.executorId, {
            type: "regular",
            id: order.id,
            status: order.status,
        });
    }

    for (const order of expressOrders) {
        addAssignment(order.executorId, {
            type: "express",
            id: order.id,
            status: order.status,
        });
    }

    // Проверяем ограничения на исполнителя.
    for (const [executorId, assignments] of byExecutor) {
        const activeRegular = assignments.filter(
            (item) =>
                item.type === "regular" &&
                item.status === "active"
        );

        const reserved = assignments.filter(
            (item) =>
                item.type === "regular" &&
                item.status === "reserved"
        );

        const activeExpress = assignments.filter(
            (item) => item.type === "express"
        );

        if (activeRegular.length > 1) {
            errors.push(
                `Исполнитель ${executorId}: ` +
                `${activeRegular.length} активных обычных заказов`
            );
        }

        if (reserved.length > 1) {
            errors.push(
                `Исполнитель ${executorId}: ` +
                `${reserved.length} забронированных заказов`
            );
        }

        if (
            activeExpress.length > 0 &&
            (activeRegular.length || reserved.length)
        ) {
            errors.push(
                `Исполнитель ${executorId}: ` +
                "одновременно обычный и экспресс-заказ"
            );
        }

        if (
            reserved.length > 0 &&
            activeRegular.length === 0
        ) {
            warnings.push(
                `Исполнитель ${executorId}: ` +
                "есть бронь, но нет активного обычного заказа"
            );
        }
    }

    for (const order of orders) {
        if (
            order.status === "active" &&
            order.paymentType === "cash" &&
            !order.commissionAccruedAt
        ) {
            warnings.push(
                `Заказ #${order.id}: активен, ` +
                "но нет отметки о начислении комиссии"
            );
        }

        if (order.status === "reserved") {
            const sourceId = Number(
                order.reservationSourceOrderId
            );

            if (
                !Number.isSafeInteger(sourceId) ||
                sourceId <= 0
            ) {
                errors.push(
                    `Бронь #${order.id}: отсутствует предыдущий заказ`
                );

                continue;
            }

            const source = await Order.findByPk(sourceId);

            if (
                !source ||
                Number(source.executorId) !==
                Number(order.executorId)
            ) {
                errors.push(
                    `Бронь #${order.id}: предыдущий заказ ` +
                    "не принадлежит исполнителю"
                );

                continue;
            }

            if (source.status === "completed") {
                information.push(
                    `Бронь #${order.id}: ` +
                    "предыдущий заказ завершён, " +
                    "можно проверить возможность активации"
                );
            }

            if (
                !Number.isFinite(
                    new Date(
                        order.reservationAvailableAt
                    ).getTime()
                ) ||
                !order.reservationAvailableAt
            ) {
                warnings.push(
                    `Бронь #${order.id}: ` +
                    "некорректное время готовности"
                );
            }
        }

        // После активации брони должен быть
        // подготовлен договор-задание.
        if (
            order.status === "active" &&
            order.reservationSourceOrderId
        ) {
            const verified = await Contract.findOne({
                where: {
                    orderId: order.id,
                    type: "verified_assignment",
                },
                attributes: ["id"],
            });

            if (
                !verified &&
                !order.contractPath
            ) {
                warnings.push(
                    `Заказ #${order.id}: ` +
                    "активирован после брони, " +
                    "но договор-задание не найдено"
                );
            }
        }
    }

    console.log("\n=== ОШИБКИ ===");
    errors.forEach((item) => console.error(item));

    console.log("\n=== ПРЕДУПРЕЖДЕНИЯ ===");
    warnings.forEach((item) => console.warn(item));

    console.log("\n=== ИНФОРМАЦИЯ ===");
    information.forEach((item) => console.log(item));

    console.log("\n=== ИТОГ ===");
    console.log("Ошибок:", errors.length);
    console.log("Предупреждений:", warnings.length);

    if (errors.length) {
        process.exitCode = 1;
    }
}

audit()
    .catch((error) => {
        console.error("Ошибка аудита:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });