const express = require("express");
const router = express.Router();

const authenticateToken =
    require("../middlewares/userAuth");

const { User, sequelize } =
    require("../models");

const { requestTBank } =
    require("../config/tbankClient");

const {
    createTBankCardBinding,
    customerKey,
} = require("../services/tbankCardBindingService");

// Привязка карты Т-Банка
router.post(
    "/tbank/bind/create",
    authenticateToken,
    async (req, res) => {
        try {
            const result =
                await createTBankCardBinding(
                    req.user.id
                );

            return res.json(result);
        } catch (error) {
            console.error(
                "TBank card binding:",
                error
            );

            return res.status(503).json({
                success: false,
                error: "Не удалось начать привязку карты",
            });
        }
    }
);

// Отвязка карты Т-Банка
router.post(
    "/tbank/unbind",
    authenticateToken,
    async (req, res) => {
        try {
            const user = await User.findByPk(
                req.user.id
            );

            if (!user) {
                return res.sendStatus(404);
            }

            // Немедленно отключаем дальнейшие
            // автоматические списания.
            if (
                user.autoCommissionProvider === "tbank"
            ) {
                await user.update({
                    autoCommissionProvider: "none",
                });
            }

            if (user.tbankCardId) {
                await requestTBank("RemoveCard", {
                    CustomerKey: customerKey(user.id),
                    CardId: user.tbankCardId,
                });
            }

            await sequelize.transaction(
                async (transaction) => {
                    await user.update(
                        {
                            tbankRebillId: null,
                            tbankCardId: null,
                            tbankCardMask: null,
                            tbankCardBoundAt: null,
                        },
                        { transaction }
                    );

                    // Старая незавершённая привязка
                    // не должна восстановить карту.
                    await sequelize.query(
                        `
                        UPDATE tbank_card_bind_attempts
                        SET confirmed = 1
                        WHERE user_id = :userId
                          AND confirmed = 0
                        `,
                        {
                            replacements: {
                                userId: user.id,
                            },
                            transaction,
                        }
                    );
                }
            );

            return res.json({
                success: true,
            });
        } catch (error) {
            console.error(
                "TBank card unbind:",
                error
            );

            return res.status(503).json({
                success: false,
                error:
                    "Автосписание отключено, но отвязку карты " +
                    "не удалось завершить. Повторите попытку.",
            });
        }
    }
);

// Выбор банка для автоматического списания
router.post(
    "/auto-provider",
    authenticateToken,
    async (req, res) => {
        try {
            const provider =
                String(req.body?.provider || "");

            if (
                !["none", "yookassa", "tbank"]
                    .includes(provider)
            ) {
                return res.status(400).json({
                    error: "Недопустимый провайдер",
                });
            }

            const user = await User.findByPk(
                req.user.id
            );

            if (!user) {
                return res.sendStatus(404);
            }

            if (
                provider === "yookassa" &&
                !user.yookassa_payment_method_id
            ) {
                return res.status(409).json({
                    error: "Сначала привяжите карту ЮKassa",
                });
            }

            if (
                provider === "tbank" &&
                (!user.tbankRebillId || !user.tbankCardId)
            ) {
                return res.status(409).json({
                    error: "Сначала привяжите карту Т-Банка",
                });
            }

            await user.update({
                autoCommissionProvider: provider,
            });

            return res.json({
                success: true,
                provider,
            });
        } catch (error) {
            console.error(
                "Auto commission provider:",
                error
            );

            return res.status(500).json({
                error: "Не удалось сохранить выбор банка",
            });
        }
    }
);

module.exports = router;