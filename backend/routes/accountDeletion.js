"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const { QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
    ActionLog,
} = require("../models");

const authenticateToken =
    require("../middlewares/userAuth");

const router = express.Router();

router.post(
    "/request",
    authenticateToken,
    async (req, res) => {
        try {
            const userId =
                Number(req.user.id);

            const password =
                req.body?.password;

            if (
                req.body?.confirmed !== true ||
                typeof password !== "string" ||
                password.length === 0 ||
                password.length > 256
            ) {
                return res.status(400).json({
                    success: false,

                    message:
                        "Подтвердите запрос и введите пароль.",
                });
            }

            const result =
                await sequelize.transaction(
                    async (transaction) => {
                        const user =
                            await User.findByPk(
                                userId,
                                {
                                    transaction,

                                    lock:
                                    transaction.LOCK.UPDATE,
                                }
                            );

                        if (
                            !user ||
                            user.role !== "user"
                        ) {
                            return {
                                status: 403,

                                message:
                                    "Операция недоступна",
                            };
                        }

                        const validPassword =
                            await bcrypt.compare(
                                password,
                                user.password
                            );

                        if (!validPassword) {
                            return {
                                status: 403,

                                message:
                                    "Неверный пароль",
                            };
                        }

                        const existing =
                            await sequelize.query(
                                `
                                SELECT id, status
                                FROM account_deletion_requests
                                WHERE user_id = :userId
                                  AND status IN (
                                    'requested',
                                    'processing'
                                  )
                                ORDER BY id DESC
                                LIMIT 1
                                `,
                                {
                                    replacements: {
                                        userId,
                                    },

                                    transaction,

                                    type:
                                    QueryTypes.SELECT,
                                }
                            );

                        if (existing.length) {
                            return {
                                status: 200,

                                alreadyRequested: true,
                            };
                        }

                        await sequelize.query(
                            `
                            INSERT INTO account_deletion_requests (
                                user_id,
                                status
                            )
                            VALUES (
                                :userId,
                                'requested'
                            )
                            `,
                            {
                                replacements: {
                                    userId,
                                },

                                transaction,
                            }
                        );

                        await ActionLog.create(
                            {
                                actorUserId:
                                userId,

                                actorRole:
                                    "user",

                                actionType:
                                    "account_deletion_requested",

                                entityType:
                                    "user",

                                entityId:
                                userId,

                                severity:
                                    "info",

                                success:
                                    true,
                            },
                            {
                                transaction,
                            }
                        );

                        return {
                            status: 201,

                            alreadyRequested: false,
                        };
                    }
                );

            if (result.status >= 400) {
                return res
                    .status(result.status)
                    .json({
                        success: false,

                        message:
                        result.message,
                    });
            }

            return res
                .status(result.status)
                .json({
                    success: true,

                    requested: true,

                    alreadyRequested:
                    result.alreadyRequested,

                    message:
                        "Запрос на удаление аккаунта зарегистрирован.",
                });
        } catch (error) {
            console.error(
                "Account deletion request:",
                error.name
            );

            return res.status(500).json({
                success: false,

                message:
                    "Не удалось зарегистрировать запрос",
            });
        }
    }
);

router.get(
    "/status",
    authenticateToken,
    async (req, res) => {
        try {
            const rows =
                await sequelize.query(
                    `
                    SELECT
                        status,
                        requested_at,
                        processed_at
                    FROM account_deletion_requests
                    WHERE user_id = :userId
                    ORDER BY id DESC
                    LIMIT 1
                    `,
                    {
                        replacements: {
                            userId: req.user.id,
                        },

                        type:
                        QueryTypes.SELECT,
                    }
                );

            return res.json({
                success: true,

                request:
                    rows[0] || null,
            });
        } catch (error) {
            return res.status(500).json({
                success: false,

                message:
                    "Не удалось получить статус запроса",
            });
        }
    }
);

module.exports = router;