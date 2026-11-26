const {
    User,
} = require("../models");

const {
    notifyMany,
} = require("./notificationService");

function canPublishOrder(order) {
    if (
        !order?.id ||
        order.status !== "pending" ||
        order.paymentType === "guarantee" ||
        order.creatorHidden ||
        order.adminDeleted
    ) {
        return false;
    }

    const promotionCost =
        Number(order.promotionCost || 0);

    const promotionRequested =
        order.promotionRequested || {};

    const hasPromotion =
        promotionCost > 0 ||
        promotionRequested.highlight === true ||
        promotionRequested.recommended === true ||
        promotionRequested.push === true;

    if (
        hasPromotion &&
        !order.promotionPaidAt
    ) {
        return false;
    }

    return true;
}

async function notifyAdminsAboutNewOrder({
                                             order,
                                             category,
                                             subcategory,
                                             creatorId,
                                         }) {
    try {
        if (!canPublishOrder(order)) {
            return false;
        }

        const admins = await User.findAll({
            where: {
                role: "admin",
            },
            attributes: ["id"],
        });

        const adminIds = admins
            .map((admin) => Number(admin.id))
            .filter(
                (id) =>
                    Number.isSafeInteger(id) &&
                    id > 0
            );

        if (!adminIds.length) {
            return false;
        }

        const categoryName =
            category?.name || "Без категории";

        const subcategoryName =
            subcategory?.name || null;

        const proposedSum =
            Number(order.proposedSum || 0);

        const body = [
            categoryName,
            subcategoryName,
            `${proposedSum.toLocaleString("ru-RU")} ₽`,
            order.address,
        ].filter(Boolean).join(" • ");

        const data = {
            orderId: order.id,
            orderType: "regular",
            creatorId:
                creatorId || order.creatorId,
            categoryId: order.categoryId,
            categoryName,
            subcategoryId:
                order.subcategoryId || null,
            subcategoryName,
            proposedSum,
            address: order.address,
            coordinates: order.coordinates,
            status: order.status,
            isAsap: Boolean(order.isAsap),
            workTime: order.workTime || null,
            adminUnfiltered: true,
            paidPromotionPush: Boolean(
                order.promotionPaidAt &&
                order.is_push_notified
            ),
        };

        await notifyMany(adminIds, {
            type: "admin_new_order",
            title: `Новый заказ №${order.id}`,
            body,
            orderId: order.id,
            orderType: "regular",
            data,
            socketEvent: "adminNewOrder",
            socketPayload: data,
        });

        return true;
    } catch (error) {
        console.error(
            "Ошибка уведомления администраторов:",
            error
        );

        return false;
    }
}

async function publishPaidOrder({
                                    db,
                                    io,
                                    orderId,
                                }) {
    try {
        const order = await db.Order.findByPk(
            orderId,
            {
                include: [
                    {
                        model: db.Category,
                        as: "category",
                        attributes: ["id", "name"],
                    },
                    {
                        model: db.Subcategory,
                        as: "subcategory",
                        attributes: ["id", "name"],
                    },
                ],
            }
        );

        if (
            !canPublishOrder(order) ||
            !order.promotionPaidAt
        ) {
            return false;
        }
        io?.emit("orderUpdated");

        await notifyAdminsAboutNewOrder({
            order,
            category: order.category,
            subcategory: order.subcategory,
            creatorId: order.creatorId,
        });

        return true;
    } catch (error) {
        console.error(
            "Ошибка публикации оплаченного заказа:",
            error
        );

        return false;
    }
}

module.exports = {
    canPublishOrder,
    notifyAdminsAboutNewOrder,
    publishPaidOrder,
};