const express = require("express");

const { sequelize, User, UserBenefitVerification,
    BenefitVerificationDocument, ActionLog } = require("../models");

const {
    authMiddleware,
    adminMiddleware,
} = require("../middlewares/adminAuth");

const {
    readPrivateDocument,
} = require("../services/privateDocumentStorage");

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

function validId(value) {
    return /^\d+$/.test(String(value || ""));
}

/*
 * GET /api/admin/benefits/pending
 *
 * Очередь заявок.
 */
router.get("/pending", async (req, res) => {
    try {
        const applications =
            await UserBenefitVerification.findAll({
                where: {
                    status: "pending",
                },

                attributes: [
                    "id",
                    "userId",
                    "benefitCode",
                    "countryCode",
                    "submittedAt",
                    "createdAt",
                ],

                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: [
                            "id",
                            "username",
                            "phone",
                        ],
                    },
                    {
                        model: BenefitVerificationDocument,
                        as: "documents",
                        attributes: [
                            "id",
                            "documentType",
                            "mimeType",
                            "fileSize",
                            "createdAt",
                        ],
                    },
                ],

                order: [
                    ["submittedAt", "ASC"],
                ],

                limit: 50,
            });

        return res.json({
            success: true,
            applications,
        });

    } catch (error) {
        console.error(
            "Ошибка получения очереди льгот:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Не удалось получить заявки",
        });
    }
});

/*
 * GET /api/admin/benefits/:id/document/:documentId
 *
 * Документ может открыть только администратор.
 * Файл расшифровывается сервером.
 */
router.get(
    "/:id/document/:documentId",
    async (req, res) => {
        try {
            if (
                !validId(req.params.id) ||
                !validId(req.params.documentId)
            ) {
                return res.sendStatus(400);
            }

            const verification =
                await UserBenefitVerification.findByPk(
                    req.params.id
                );

            if (!verification) {
                return res.sendStatus(404);
            }

            const document =
                await BenefitVerificationDocument.findOne({
                    where: {
                        id: req.params.documentId,
                        benefitVerificationId: verification.id,
                        deletedAt: null,
                    },
                });

            if (!document) {
                return res.sendStatus(404);
            }

            if (!document.isEncrypted) {
                return res.status(409).json({
                    message:
                        "Документ не находится в защищённом формате",
                });
            }

            const decrypted =
                await readPrivateDocument(
                    document.storageKey
                );

            /*
             * Сверяем фактический SHA-256
             * с сохранённым при загрузке.
             */
            if (
                decrypted.fileHash !==
                document.fileHash
            ) {
                console.error(
                    "Document integrity mismatch:",
                    document.id
                );

                return res.status(409).json({
                    message:
                        "Нарушена целостность документа",
                });
            }

            /*
             * Просмотр чувствительного документа
             * обязательно фиксируем.
             *
             * При ошибке аудита файл не выдаём.
             */
            await ActionLog.create({
                actorUserId: req.user.id,
                actorRole: "admin",

                actionType: "benefit_document_accessed",
                entityType: "user",
                entityId: verification.userId,

                meta: {
                    verificationId: String(
                        verification.id
                    ),
                    documentId: String(
                        document.id
                    ),
                    benefitCode:
                    verification.benefitCode,
                },
            });

            res.setHeader(
                "Cache-Control",
                "private, no-store, max-age=0"
            );

            res.setHeader(
                "Pragma",
                "no-cache"
            );

            res.setHeader(
                "X-Content-Type-Options",
                "nosniff"
            );

            res.setHeader(
                "Content-Type",
                decrypted.mimeType
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="benefit-document-${document.id}${decrypted.extension}"`
            );

            return res.end(decrypted.buffer);

        } catch (error) {
            console.error(
                "Ошибка чтения закрытого документа:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить документ",
            });
        }
    }
);

/*
 * POST /api/admin/benefits/:id/decision
 *
 * body:
 * {
 *   action: "approve" | "reject" | "revoke",
 *   reason: "...",
 *   validUntil: "2027-10-17"
 * }
 */
router.post("/:id/decision", async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                message: "Некорректный ID заявки",
            });
        }

        const action = String(
            req.body.action || ""
        );

        if (
            !["approve", "reject", "revoke"]
                .includes(action)
        ) {
            return res.status(400).json({
                message: "Недопустимое решение",
            });
        }

        const reason = String(
            req.body.reason || ""
        ).trim();

        if (
            ["reject", "revoke"].includes(action) &&
            reason.length < 5
        ) {
            return res.status(400).json({
                message:
                    "Укажите причину отказа или отзыва",
            });
        }

        if (reason.length > 500) {
            return res.status(400).json({
                message: "Причина слишком длинная",
            });
        }

        const now = new Date();

        let validUntil = null;

        if (action === "approve") {
            if (!req.body.validUntil) {
                return res.status(400).json({
                    message:
                        "Укажите дату следующей проверки",
                });
            }

            validUntil = new Date(
                req.body.validUntil
            );

            const maxDate = new Date(
                now.getTime() +
                366 * 24 * 60 * 60 * 1000
            );

            if (
                !Number.isFinite(validUntil.getTime()) ||
                validUntil <= now ||
                validUntil > maxDate
            ) {
                return res.status(400).json({
                    message:
                        "Дата проверки должна быть в пределах следующего года",
                });
            }
        }

        const updated = await sequelize.transaction(
            async (transaction) => {
                const verification =
                    await UserBenefitVerification.findByPk(
                        req.params.id,
                        {
                            transaction,
                            lock: transaction.LOCK.UPDATE,
                        }
                    );

                if (!verification) {
                    const error = new Error(
                        "Заявка не найдена"
                    );
                    error.httpStatus = 404;
                    throw error;
                }

                if (
                    ["approve", "reject"].includes(action) &&
                    verification.status !== "pending"
                ) {
                    const error = new Error(
                        "Заявка уже рассмотрена"
                    );
                    error.httpStatus = 409;
                    throw error;
                }

                if (
                    action === "revoke" &&
                    (
                        verification.status !== "verified" ||
                        verification.revokedAt
                    )
                ) {
                    const error = new Error(
                        "Отозвать можно только действующее подтверждение"
                    );
                    error.httpStatus = 409;
                    throw error;
                }

                if (action === "approve") {
                    const documentCount =
                        await BenefitVerificationDocument.count({
                            where: {
                                benefitVerificationId:
                                verification.id,
                                deletedAt: null,
                            },
                            transaction,
                        });

                    if (documentCount === 0) {
                        const error = new Error(
                            "К заявке не приложен документ"
                        );
                        error.httpStatus = 409;
                        throw error;
                    }

                    verification.status = "verified";
                    verification.verifiedAt = now;
                    verification.expiresAt = validUntil;
                    verification.revokedAt = null;
                }

                if (action === "reject") {
                    verification.status = "rejected";
                    verification.verifiedAt = null;
                    verification.expiresAt = null;
                }

                if (action === "revoke") {
                    verification.status = "revoked";
                    verification.revokedAt = now;
                }

                verification.reviewedBy =
                    req.user.id;

                verification.reviewedAt = now;

                verification.decisionReason =
                    reason || null;

                await verification.save({
                    transaction,
                });

                await ActionLog.create(
                    {
                        actorUserId: req.user.id,
                        actorRole: "admin",
                        actionType:
                            `benefit_application_${action}`,

                        entityType: "user",
                        entityId: verification.userId,

                        meta: {
                            verificationId:
                                String(verification.id),

                            benefitCode:
                            verification.benefitCode,

                            decision: action,
                            expiresAt:
                            verification.expiresAt,
                        },
                    },
                    {
                        transaction,
                    }
                );

                return {
                    id: verification.id,
                    userId: verification.userId,
                    benefitCode:
                    verification.benefitCode,

                    status: verification.status,
                    expiresAt:
                    verification.expiresAt,
                };
            }
        );

        return res.json({
            success: true,
            verification: updated,
        });

    } catch (error) {
        if (error.httpStatus) {
            return res.status(error.httpStatus).json({
                success: false,
                message: error.message,
            });
        }

        console.error(
            "Ошибка проверки льготы:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Не удалось сохранить решение",
        });
    }
});

module.exports = router;