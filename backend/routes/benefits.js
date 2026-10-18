const express = require("express");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    getMyBenefitOverview,
} = require("../services/benefitService");

const multer = require("multer");
const { Op } = require("sequelize");

const {
    sequelize,
    User,
    UserBenefitVerification,
    BenefitVerificationDocument,
    ActionLog,
} = require("../models");

const {
    getBenefitProgram,
} = require("../config/benefitPrograms");

const {
    savePrivateDocument,
    deletePrivateDocument,
} = require("../services/privateDocumentStorage");

const router = express.Router();

/*
 * Возвращает пользователю только
 * его собственные льготные статусы.
 *
 * Не возвращаем:
 * - медицинские документы;
 * - персональные данные членов семьи;
 * - внутренние заметки администратора;
 * - содержимое проверочных документов.
 */

router.get(
    "/me",
    authenticateToken,
    async (req, res) => {
        try {
            const benefits =
                await getMyBenefitOverview(
                    req.user.id
                );

            return res.json({
                success: true,
                benefits,
            });

        } catch (error) {
            console.error(
                "Ошибка получения льгот:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить сведения о льготах",
            });
        }
    }
);

const benefitUpload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 5,
    },
});

function benefitHttpError(status, message) {
    const error = new Error(message);
    error.httpStatus = status;
    return error;
}

/*
 * POST /api/benefits/me/:benefitCode/apply
 *
 * Multipart:
 *   document: PDF / JPG / PNG
 *
 * Поддерживаемые коды:
 *   pension_recipient
 *   disability_status
 *   large_family_parent
 */

router.post(
    "/me/:benefitCode/apply",
    authenticateToken,
    benefitUpload.single("document"),

    async (req, res) => {
        let savedStorageKey = null;

        try {
            const userId = Number(req.user.id);

            const benefitCode = String(
                req.params.benefitCode || ""
            );

            const program =
                getBenefitProgram(benefitCode);

            if (!program || program.countryCode !== "RU") {
                return res.status(400).json({
                    success: false,
                    message: "Неизвестная льготная программа",
                });
            }

            if (!req.file?.buffer) {
                return res.status(400).json({
                    success: false,
                    message: "Приложите подтверждающий документ",
                });
            }

            const result = await sequelize.transaction(
                async (transaction) => {
                    /*
                     * Блокируем запись пользователя,
                     * чтобы две параллельные заявки
                     * не создавались одновременно.
                     */
                    const user = await User.findByPk(
                        userId,
                        {
                            transaction,
                            lock: transaction.LOCK.UPDATE,
                        }
                    );

                    if (!user) {
                        throw benefitHttpError(
                            404,
                            "Пользователь не найден"
                        );
                    }

                    const pending =
                        await UserBenefitVerification.findOne({
                            where: {
                                userId,
                                benefitCode,
                                countryCode: "RU",
                                status: "pending",
                            },
                            transaction,
                        });

                    if (pending) {
                        throw benefitHttpError(
                            409,
                            "Заявка уже находится на проверке"
                        );
                    }

                    const now = new Date();

                    const active =
                        await UserBenefitVerification.findOne({
                            where: {
                                userId,
                                benefitCode,
                                countryCode: "RU",
                                status: "verified",
                                revokedAt: null,
                                verifiedAt: {
                                    [Op.lte]: now,
                                },
                                [Op.or]: [
                                    { expiresAt: null },
                                    {
                                        expiresAt: {
                                            [Op.gt]: now,
                                        },
                                    },
                                ],
                            },
                            transaction,
                        });

                    if (active) {
                        throw benefitHttpError(
                            409,
                            "Льгота уже подтверждена"
                        );
                    }

                    /*
                     * Ограничиваем количество повторных
                     * заявок одного типа.
                     */
                    const recentCount =
                        await UserBenefitVerification.count({
                            where: {
                                userId,
                                benefitCode,
                                createdAt: {
                                    [Op.gte]: new Date(
                                        Date.now() - 24 * 60 * 60 * 1000
                                    ),
                                },
                            },
                            transaction,
                        });

                    if (recentCount >= 3) {
                        throw benefitHttpError(
                            429,
                            "Слишком много заявок. Повторите попытку позже."
                        );
                    }

                    const stored =
                        await savePrivateDocument(
                            req.file.buffer
                        );

                    savedStorageKey = stored.storageKey;

                    const verification =
                        await UserBenefitVerification.create(
                            {
                                userId,
                                benefitCode,
                                countryCode: "RU",
                                status: "pending",
                                provider: "manual",
                                verificationMethod: "document_review",
                                submittedAt: now,
                            },
                            {
                                transaction,
                            }
                        );

                    await BenefitVerificationDocument.create(
                        {
                            benefitVerificationId:
                            verification.id,

                            userId,
                            documentType: "eligibility_proof",

                            storageKey: stored.storageKey,
                            mimeType: stored.mimeType,
                            fileSize: stored.fileSize,
                            fileHash: stored.fileHash,

                            isEncrypted: true,
                        },
                        {
                            transaction,
                        }
                    );

                    /*
                     * Пишем событие в существующий
                     * ActionLog в той же транзакции.
                     *
                     * Не включаем содержимое документа.
                     */
                    await ActionLog.create(
                        {
                            actorUserId: userId,
                            actorRole: "user",
                            actionType: "benefit_application_submitted",
                            entityType: "user",
                            entityId: userId,

                            meta: {
                                verificationId: String(
                                    verification.id
                                ),
                                benefitCode,
                                countryCode: "RU",
                            },
                        },
                        {
                            transaction,
                        }
                    );

                    return {
                        id: verification.id,
                        benefitCode,
                    };
                }
            );

            return res.status(201).json({
                success: true,

                message:
                    "Документ получен. Заявка отправлена на проверку.",

                application: {
                    id: result.id,
                    benefitCode: result.benefitCode,
                    status: "pending",
                },
            });

        } catch (error) {
            /*
             * Если транзакция завершилась ошибкой,
             * удаляем уже записанный частный файл.
             */
            if (savedStorageKey) {
                try {
                    await deletePrivateDocument(
                        savedStorageKey
                    );
                } catch (cleanupError) {
                    console.error(
                        "Ошибка очистки частного документа:",
                        cleanupError
                    );
                }
            }

            if (error.httpStatus) {
                return res.status(error.httpStatus).json({
                    success: false,
                    message: error.message,
                });
            }

            if (
                String(error.message).includes(
                    "Поддерживаются только"
                ) ||
                String(error.message).includes(
                    "Недопустимый размер"
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message: error.message,
                });
            }

            console.error(
                "Ошибка подачи заявки на льготу:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось отправить заявку",
            });
        }
    }
);

router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(413).json({
            success: false,
            message:
                "Не удалось загрузить документ. Максимальный размер — 5 МБ.",
        });
    }

    return next(error);
});

module.exports = router;