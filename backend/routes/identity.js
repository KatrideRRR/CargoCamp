const express = require("express");
const multer = require("multer");
const { Op } = require("sequelize");

const authenticateToken =
    require("../middlewares/userAuth");
const {
    getCurrentIdentityVerification,
} = require("../services/identityStatusService");
const {
    sequelize,
    User,
    IdentityVerification,
    VerificationDocument,
    ActionLog,
} = require("../models");

const {
    savePrivateDocument,
    deletePrivateDocument,
} = require("../services/privateDocumentStorage");

const router = express.Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 3;

// Документы хранятся в памяти только во время запроса.
// Постоянное хранение выполняет privateDocumentStorage.
const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
        fields: 2,
        parts: MAX_FILES + 2,
    },
});

function httpError(status, message) {
    const error = new Error(message);
    error.httpStatus = status;
    return error;
}

/*
 * GET /api/identity/me
 *
 * Возвращает статус проверки личности
 * только текущего пользователя.
 *
 * Не возвращаем:
 * - файлы;
 * - пути хранения;
 * - хеши документов;
 * - персональные данные из документов.
 */
router.get(
    "/me",
    authenticateToken,
    async (req, res) => {
        try {
            const userId = Number(req.user.id);

            const result =
                await getCurrentIdentityVerification(
                    userId
                );

            const verification = result.record;
            const status = result.status;

            if (!verification) {
                return res.json({
                    success: true,
                    verification: {
                        status: "not_requested",
                        verified: false,
                    },
                });
            }

            return res.json({
                success: true,

                verification: {
                    id: verification.id,

                    status,
                    verified: result.verified,

                    assuranceLevel:
                    verification.assuranceLevel,

                    verifiedAt:
                    verification.verifiedAt,

                    expiresAt:
                    verification.expiresAt,

                    createdAt:
                    verification.createdAt,

                    rejectionReason:
                        ["rejected", "revoked"].includes(status)
                            ? verification.rejectionReason
                            : null,
                },
            });

        } catch (error) {
            console.error(
                "Ошибка получения статуса личности:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить статус проверки личности",
            });
        }
    }
);

/*
 * POST /api/identity/me/apply
 *
 * Content-Type: multipart/form-data
 *
 * Поля:
 *
 * documents: File[] — 1–3 документа
 *
 * documentType:
 *   passport_rf
 *   other_identity_document
 *
 * Файлы:
 * PDF, JPG, PNG
 * до 5 МБ каждый.
 */
router.post(
    "/me/apply",

    authenticateToken,

    upload.array(
        "documents",
        MAX_FILES
    ),

    async (req, res) => {
        const savedStorageKeys = [];

        try {
            const userId = Number(req.user.id);

            const files = Array.isArray(req.files)
                ? req.files
                : [];

            if (
                files.length === 0 ||
                files.length > MAX_FILES
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Приложите от 1 до 3 документов",
                });
            }

            const documentType = String(
                req.body.documentType ||
                "passport_rf"
            ).trim();

            if (
                ![
                    "passport_rf",
                    "other_identity_document",
                ].includes(documentType)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Недопустимый тип документа",
                });
            }

            /*
             * Все проверки и создание заявки
             * выполняем в одной транзакции.
             *
             * Блокируем запись пользователя,
             * чтобы параллельные запросы
             * не создавали две заявки.
             */
            const application =
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

                        if (!user) {
                            throw httpError(
                                404,
                                "Пользователь не найден"
                            );
                        }


                        const now = new Date();

                        const current =
                            await getCurrentIdentityVerification(
                                userId,
                                {
                                    transaction,
                                    now,
                                }
                            );

                        if (current.status === "pending") {
                            throw httpError(
                                409,
                                "Заявка уже находится на проверке"
                            );
                        }

                        if (current.verified) {
                            throw httpError(
                                409,
                                "Личность уже подтверждена"
                            );
                        }

                        /*
                         * Защита от многократных заявок:
                         * не более трёх за 24 часа.
                         */
                        const dayAgo = new Date(
                            Date.now() -
                            24 * 60 * 60 * 1000
                        );

                        const recentCount =
                            await IdentityVerification.count({
                                where: {
                                    userId,
                                    countryCode: "RU",

                                    createdAt: {
                                        [Op.gte]: dayAgo,
                                    },
                                },
                                transaction,
                            });

                        if (recentCount >= 3) {
                            throw httpError(
                                429,
                                "Слишком много заявок. Повторите попытку позже."
                            );
                        }

                        /*
                         * Создаём заявку.
                         *
                         * Здесь намеренно
                         * НЕ меняем user.userStatus.
                         */
                        const verification =
                            await IdentityVerification.create(
                                {
                                    userId,

                                    status: "pending",

                                    provider: "manual",

                                    countryCode: "RU",

                                    assuranceLevel: "basic",

                                    verificationMethod:
                                        "document_review",

                                    verifiedAt: null,
                                    expiresAt: null,
                                    reviewedBy: null,
                                    rejectionReason: null,

                                    metadata: {
                                        documentType,
                                        submittedAt:
                                            now.toISOString(),
                                    },
                                },
                                {
                                    transaction,
                                }
                            );

                        /*
                         * Шифруем документы.
                         *
                         * Сервис сам:
                         * - определяет формат по содержимому;
                         * - проверяет размер;
                         * - шифрует AES-256-GCM;
                         * - вычисляет SHA-256;
                         * - сохраняет вне /uploads.
                         */
                        for (
                            let index = 0;
                            index < files.length;
                            index++
                        ) {
                            const file = files[index];

                            const stored =
                                await savePrivateDocument(
                                    file.buffer
                                );

                            savedStorageKeys.push(
                                stored.storageKey
                            );

                            await VerificationDocument.create(
                                {
                                    verificationId:
                                    verification.id,

                                    userId,

                                    documentType:
                                        documentType ===
                                        "passport_rf"
                                            ? "passport_page"
                                            : "other_identity_document",

                                    storageKey:
                                    stored.storageKey,

                                    mimeType:
                                    stored.mimeType,

                                    fileSize:
                                    stored.fileSize,

                                    fileHash:
                                    stored.fileHash,

                                    isEncrypted: true,

                                    encryptionVersion:
                                        "CCDOC1",

                                    metadata: {
                                        documentType,
                                        pageNumber:
                                            index + 1,
                                    },
                                },
                                {
                                    transaction,
                                }
                            );
                        }

                        /*
                         * Аудит без содержимого файлов
                         * и паспортных данных.
                         */
                        await ActionLog.create(
                            {
                                actorUserId: userId,
                                actorRole: "user",

                                actionType:
                                    "identity_application_submitted",

                                entityType: "user",
                                entityId: userId,

                                meta: {
                                    verificationId:
                                        String(
                                            verification.id
                                        ),

                                    documentsCount:
                                    files.length,
                                },
                            },
                            {
                                transaction,
                            }
                        );

                        return {
                            id: verification.id,
                            status: verification.status,
                        };
                    }
                );

            return res.status(201).json({
                success: true,

                message:
                    "Документы получены. Заявка отправлена на проверку.",

                verification: application,
            });

        } catch (error) {
            /*
             * Если транзакция не завершилась,
             * удаляем уже созданные файлы.
             *
             * Ошибки очистки логируем отдельно,
             * чтобы не скрывать исходную ошибку.
             */
            for (const storageKey of savedStorageKeys) {
                try {
                    await deletePrivateDocument(
                        storageKey
                    );
                } catch (cleanupError) {
                    console.error(
                        "Ошибка очистки документа:",
                        cleanupError
                    );
                }
            }

            if (error.httpStatus) {
                return res
                    .status(error.httpStatus)
                    .json({
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
                "Ошибка подачи заявки на проверку личности:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось отправить заявку на проверку",
            });
        }
    }
);

/*
 * Ошибки загрузки обрабатываем отдельно,
 * чтобы пользователь получал понятный ответ.
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(413).json({
            success: false,

            message:
                "Ошибка загрузки. Максимум 3 файла по 5 МБ.",
        });
    }

    return next(error);
});

module.exports = router;