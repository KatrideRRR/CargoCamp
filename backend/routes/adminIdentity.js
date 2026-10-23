const express = require("express");
const jwt = require("jsonwebtoken");
const { QueryTypes, Op } = require("sequelize");
const {
    sequelize,
    User,
    AuthSession,
    IdentityVerification,
    VerificationDocument,
    ActionLog,
    Order,
    Contract,
    ContractSignature,
    ContractEvent,
    SignatureChallenge,
    ElectronicSignatureAgreement,
} = require("../models");

const {
    assertVerifiedPdfIntegrity,
} = require("../services/verifiedPdfIntegrity");

const {
    buildContractEvidence,
} = require("../services/contractEvidenceService");

const {
    getCurrentIdentityVerification,
} = require("../services/identityStatusService");

const {
    authMiddleware,
    adminMiddleware,
} = require("../middlewares/adminAuth");

const {
    readPrivateDocument,
} = require("../services/privateDocumentStorage");

const router = express.Router();

/*
 * Базовая проверка авторизации
 * и роли администратора.
 */
router.use(
    authMiddleware,
    adminMiddleware
);

/*
 * Дополнительная проверка сессии.
 *
 * Для доступа к паспортным документам
 * обязательно требуем новый JWT:
 *
 * scope = admin
 * sid = действующая сессия
 *
 * Старые JWT без sid/scope не принимаем.
 */
router.use(async (req, res, next) => {
    try {
        const authorization =
            req.headers.authorization || "";

        const token =
            authorization.startsWith("Bearer ")
                ? authorization.slice(7)
                : null;

        if (!token) {
            return res.status(401).json({
                message:
                    "Требуется административная авторизация",
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        if (
            decoded.scope !== "admin" ||
            !decoded.sid ||
            Number(decoded.id) !== Number(req.user.id)
        ) {
            return res.status(401).json({
                message:
                    "Требуется действующая административная сессия",
            });
        }

        const session =
            await AuthSession.findByPk(
                decoded.sid
            );

        const now = Date.now();

        const expiresAt =
            new Date(
                session?.expiresAt
            ).getTime();

        const absoluteExpiresAt =
            new Date(
                session?.absoluteExpiresAt
            ).getTime();

        if (
            !session ||
            session.scope !== "admin" ||
            Number(session.userId) !==
            Number(req.user.id) ||
            session.revokedAt ||
            !Number.isFinite(expiresAt) ||
            !Number.isFinite(absoluteExpiresAt) ||
            expiresAt <= now ||
            absoluteExpiresAt <= now
        ) {
            return res.status(401).json({
                message:
                    "Административная сессия недействительна",
            });
        }

        next();

    } catch (error) {
        return res.status(401).json({
            message:
                "Не удалось проверить административную сессию",
        });
    }
});

function validId(value) {
    return /^[1-9]\d*$/.test(
        String(value || "")
    );
}

function httpError(status, message) {
    const error = new Error(message);

    error.httpStatus = status;

    return error;
}

/*
 * GET /api/admin/identity/pending
 *
 * Очередь заявок на проверку личности.
 *
 * Возвращаем метаданные документов,
 * но не пути и не содержимое файлов.
 */
router.get(
    "/pending",
    async (req, res) => {
        try {
            const applications =
                await IdentityVerification.findAll({
                    where: {
                        status: "pending",
                        countryCode: "RU",
                    },

                    attributes: [
                        "id",
                        "userId",
                        "status",
                        "countryCode",
                        "verificationMethod",
                        "assuranceLevel",
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
                            model: VerificationDocument,
                            as: "documents",

                            where: {
                                deletedAt: null,
                            },

                            required: false,

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
                        ["createdAt", "ASC"],
                    ],

                    limit: 50,
                });

            return res.json({
                success: true,
                applications,
            });

        } catch (error) {
            console.error(
                "Ошибка получения заявок на проверку личности:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить заявки на проверку личности",
            });
        }
    }
);


/*
 * GET /api/admin/identity/verified
 *
 * Параметры:
 *   page=1
 *   q=79781234567
 *   q=123
 *
 * Без q возвращаем последние 20 действующих
 * проверок. Поиск по телефону или ID.
 *
 * Важное условие: берём только ПОСЛЕДНЮЮ
 * заявку пользователя, а не любую старую
 * запись со статусом verified.
 */
router.get("/verified", async (req, res) => {
    try {
        const rawPage = Number(
            req.query.page || 1
        );

        if (
            !Number.isSafeInteger(rawPage) ||
            rawPage < 1 ||
            rawPage > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "Некорректная страница",
            });
        }

        const page = rawPage;
        const limit = 20;
        const offset = (page - 1) * limit;

        const q = String(
            req.query.q || ""
        ).trim();

        if (q.length > 30) {
            return res.status(400).json({
                success: false,
                message: "Слишком длинный запрос",
            });
        }

        let searchSql = "";
        const replacements = {
            limit,
            offset,
        };

        if (q) {
            const digits = q.replace(/\D/g, "");

            if (
                /^[1-9]\d{0,9}$/.test(q)
            ) {
                replacements.userId = Number(q);

                if (digits.length >= 4) {
                    replacements.phone =
                        `%${digits}%`;

                    searchSql = `
                        AND (
                            u.id = :userId
                            OR u.phone LIKE :phone
                        )
                    `;
                } else {
                    searchSql =
                        "AND u.id = :userId";
                }

            } else if (
                digits.length >= 4 &&
                digits.length <= 11 &&
                /^[+\d\s()\-]+$/.test(q)
            ) {
                replacements.phone =
                    `%${digits}%`;

                searchSql = `
                    AND REPLACE(
                        REPLACE(
                            REPLACE(
                                REPLACE(
                                    REPLACE(
                                        u.phone,
                                        '+', ''
                                    ),
                                    ' ', ''
                                ),
                                '-', ''
                            ),
                            '(', ''
                        ),
                        ')', ''
                    ) LIKE :phone
                `;

            } else {
                return res.status(400).json({
                    success: false,
                    message:
                        "Введите ID пользователя или минимум 4 цифры телефона",
                });
            }
        }

        /*
         * SQL-фрагмент searchSql выбирается
         * только из констант выше.
         * Значения пользователя передаются
         * отдельно через replacements.
         */
        const whereSql = `
            iv.country_code = 'RU'
            AND iv.status = 'verified'
            AND iv.verified_at IS NOT NULL
            AND iv.verified_at <= UTC_TIMESTAMP(3)
            AND iv.expires_at IS NOT NULL
            AND iv.expires_at > UTC_TIMESTAMP(3)

            AND iv.id = (
                SELECT iv2.id
                FROM identity_verifications iv2
                WHERE iv2.user_id = iv.user_id
                  AND iv2.country_code = 'RU'
                ORDER BY
                    iv2.created_at DESC,
                    iv2.id DESC
                LIMIT 1
            )

            ${searchSql}
        `;

        const fromSql = `
            FROM identity_verifications iv
            INNER JOIN users u
                ON u.id = iv.user_id
            WHERE ${whereSql}
        `;

        const [countRows, rows] =
            await Promise.all([
                sequelize.query(
                    `SELECT COUNT(*) AS total ${fromSql}`,
                    {
                        replacements,
                        type: QueryTypes.SELECT,
                    }
                ),

                sequelize.query(
                    `
                    SELECT
                        iv.id AS verificationId,
                        iv.user_id AS userId,
                        iv.status AS status,
                        iv.assurance_level AS assuranceLevel,
                        iv.verification_method AS verificationMethod,
                        iv.verified_at AS verifiedAt,
                        iv.expires_at AS expiresAt,
                        iv.reviewed_by AS reviewedBy,
                        u.username AS username,
                        u.phone AS phone
                    ${fromSql}
                    ORDER BY
                        iv.verified_at DESC,
                        iv.id DESC
                    LIMIT :limit OFFSET :offset
                    `,
                    {
                        replacements,
                        type: QueryTypes.SELECT,
                    }
                ),
            ]);

        return res.json({
            success: true,
            users: rows,
            page,
            pageSize: limit,
            total: Number(
                countRows[0]?.total || 0
            ),
        });

    } catch (error) {
        console.error(
            "Verified identities list error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Не удалось загрузить подтверждённых пользователей",
        });
    }
});


/*
 * GET /api/admin/identity/users/:userId/history
 *
 * История проверок + административных
 * решений. Не возвращает содержимое
 * паспортных документов.
 */
router.get(
    "/users/:userId/history",
    async (req, res) => {
        try {
            if (!validId(req.params.userId)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный ID пользователя",
                });
            }

            const userId =
                Number(req.params.userId);

            const user = await User.findByPk(
                userId,
                {
                    attributes: [
                        "id",
                        "username",
                        "phone",
                    ],
                }
            );

            if (!user) {
                return res.sendStatus(404);
            }

            const [
                current,
                verifications,
                actions,
            ] = await Promise.all([
                getCurrentIdentityVerification(
                    userId
                ),

                IdentityVerification.findAll({
                    where: {
                        userId,
                        countryCode: "RU",
                    },

                    attributes: [
                        "id",
                        "status",
                        "assuranceLevel",
                        "verificationMethod",
                        "verifiedAt",
                        "expiresAt",
                        "reviewedBy",
                        "rejectionReason",
                        "createdAt",
                        "updatedAt",
                    ],

                    order: [
                        ["createdAt", "DESC"],
                        ["id", "DESC"],
                    ],

                    limit: 30,
                }),

                ActionLog.findAll({
                    where: {
                        entityType: "user",
                        entityId: userId,

                        actionType: {
                            [Op.in]: [
                                "identity_application_approved",
                                "identity_application_rejected",
                                "identity_verification_revoked",
                            ],
                        },
                    },

                    attributes: [
                        "id",
                        "ts",
                        "actorUserId",
                        "actionType",
                        "meta",
                    ],

                    order: [
                        ["ts", "DESC"],
                        ["id", "DESC"],
                    ],

                    limit: 50,
                }),
            ]);

            /*
             * Аудируем просмотр истории,
             * поскольку она содержит
             * чувствительные сведения.
             */
            await ActionLog.create({
                actorUserId: req.user.id,
                actorRole: "admin",

                actionType:
                    "identity_history_viewed",

                entityType: "user",
                entityId: userId,

                meta: {
                    viewedAt:
                        new Date().toISOString(),
                },
            });

            return res.json({
                success: true,

                user,

                current: {
                    verificationId:
                        current.record?.id || null,

                    status: current.status,
                    verified: current.verified,
                },

                verifications,
                actions: actions.map(
                    (action) => ({
                        id: action.id,
                        ts: action.ts,
                        actorUserId:
                        action.actorUserId,

                        actionType:
                        action.actionType,

                        verificationId:
                            action.meta
                                ?.verificationId || null,

                        reason:
                            action.meta?.reason || null,
                    })
                ),
            });

        } catch (error) {
            console.error(
                "Identity history error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось получить историю проверки личности",
            });
        }
    }
);


/*
 * GET /api/admin/identity/:id/document/:documentId
 *
 * Получение зашифрованного документа.
 *
 * Порядок:
 * 1. Проверка административной сессии.
 * 2. Поиск заявки.
 * 3. Проверка принадлежности документа.
 * 4. Расшифровка.
 * 5. Проверка SHA-256.
 * 6. Запись события аудита.
 * 7. Отправка документа.
 */
router.get(
    "/:id/document/:documentId",
    async (req, res) => {
        try {
            const {
                id,
                documentId,
            } = req.params;

            if (
                !validId(id) ||
                !validId(documentId)
            ) {
                return res.status(400).json({
                    message:
                        "Некорректный ID заявки или документа",
                });
            }

            const verification =
                await IdentityVerification.findByPk(
                    id
                );

            if (!verification) {
                return res.sendStatus(404);
            }

            const document =
                await VerificationDocument.findOne({
                    where: {
                        id: documentId,

                        verificationId:
                        verification.id,

                        userId:
                        verification.userId,

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

            /*
             * Файл читается только из закрытого
             * PRIVATE_DOCUMENTS_DIR.
             */
            const decrypted =
                await readPrivateDocument(
                    document.storageKey
                );

            /*
             * Сверяем исходный SHA-256.
             */
            if (
                decrypted.fileHash !==
                document.fileHash
            ) {
                console.error(
                    "Identity document integrity mismatch:",
                    document.id
                );

                return res.status(409).json({
                    message:
                        "Нарушена целостность документа",
                });
            }

            /*
             * Сверяем MIME-тип документа.
             */
            if (
                decrypted.mimeType !==
                document.mimeType
            ) {
                return res.status(409).json({
                    message:
                        "Формат документа не соответствует сохранённым данным",
                });
            }

            /*
             * Доступ к документу обязательно
             * журналируем до отправки файла.
             *
             * Если аудит не работает,
             * документ не выдаём.
             */
            await ActionLog.create({
                actorUserId:
                req.user.id,

                actorRole: "admin",

                actionType:
                    "identity_document_accessed",

                entityType: "user",

                entityId:
                verification.userId,

                meta: {
                    verificationId:
                        String(
                            verification.id
                        ),

                    documentId:
                        String(
                            document.id
                        ),
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

            /*
             * attachment — скачивание файла,
             * а не автоматическое отображение
             * паспорта внутри браузера.
             */
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="identity-document-${document.id}${decrypted.extension}"`
            );

            return res.end(
                decrypted.buffer
            );

        } catch (error) {
            console.error(
                "Ошибка получения документа личности:",
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
 * POST /api/admin/identity/:id/decision
 *
 * body:
 *
 * {
 *   action: "approve" | "reject",
 *   reason: "...",
 *   validUntil: "2027-10-19"
 * }
 *
 * validUntil обязателен для approve.
 * reason обязателен для reject.
 */
router.post(
    "/:id/decision",
    async (req, res) => {
        try {
            if (!validId(req.params.id)) {
                return res.status(400).json({
                    message:
                        "Некорректный ID заявки",
                });
            }

            const action =
                String(
                    req.body.action || ""
                ).trim();

            if (
                ![
                    "approve",
                    "reject",
                ].includes(action)
            ) {
                return res.status(400).json({
                    message:
                        "Недопустимое решение",
                });
            }

            const reason =
                String(
                    req.body.reason || ""
                ).trim();

            if (
                action === "reject" &&
                reason.length < 5
            ) {
                return res.status(400).json({
                    message:
                        "Укажите причину отказа — минимум 5 символов",
                });
            }

            if (reason.length > 500) {
                return res.status(400).json({
                    message:
                        "Комментарий слишком длинный",
                });
            }

            const now = new Date();

            let validUntil = null;

            /*
             * При подтверждении личности
             * устанавливаем срок действия проверки.
             *
             * В текущем MVP — не более пяти лет.
             */
            if (action === "approve") {
                const rawDate = String(
                    req.body.validUntil || ""
                ).trim();

                if (
                    !/^\d{4}-\d{2}-\d{2}$/.test(
                        rawDate
                    )
                ) {
                    return res.status(400).json({
                        message:
                            "Укажите дату следующей проверки в формате ГГГГ-ММ-ДД",
                    });
                }

                validUntil = new Date(
                    `${rawDate}T23:59:59.999Z`
                );

                const maxDate = new Date(
                    now.getTime() +
                    5 * 366 * 24 * 60 * 60 * 1000
                );

                if (
                    !Number.isFinite(
                        validUntil.getTime()
                    ) ||
                    validUntil.toISOString()
                        .slice(0, 10) !== rawDate ||
                    validUntil <= now ||
                    validUntil > maxDate
                ) {
                    return res.status(400).json({
                        message:
                            "Дата следующей проверки должна быть в пределах пяти лет",
                    });
                }
            }

            /*
             * Решение принимаем в транзакции.
             */
            const updated =
                await sequelize.transaction(
                    async (transaction) => {
                        const verification =
                            await IdentityVerification.findByPk(
                                req.params.id,
                                {
                                    transaction,

                                    lock:
                                    transaction.LOCK.UPDATE,
                                }
                            );

                        if (!verification) {
                            throw httpError(
                                404,
                                "Заявка не найдена"
                            );
                        }

                        /*
                         * Нельзя повторно подтвердить
                         * или отклонить уже рассмотренную
                         * заявку.
                         */
                        if (
                            verification.status !==
                            "pending"
                        ) {
                            throw httpError(
                                409,
                                "Заявка уже рассмотрена"
                            );
                        }

                        if (action === "approve") {
                            /*
                             * Проверяем наличие документов.
                             */
                            const documentCount =
                                await VerificationDocument.count({
                                    where: {
                                        verificationId:
                                        verification.id,

                                        deletedAt: null,

                                        isEncrypted: true,
                                    },

                                    transaction,
                                });

                            if (
                                documentCount === 0
                            ) {
                                throw httpError(
                                    409,
                                    "К заявке не приложены защищённые документы"
                                );
                            }

                            verification.status =
                                "verified";

                            verification.verifiedAt =
                                now;

                            verification.expiresAt =
                                validUntil;

                            verification.rejectionReason =
                                null;
                        }

                        if (action === "reject") {
                            verification.status =
                                "rejected";

                            verification.verifiedAt =
                                null;

                            verification.expiresAt =
                                null;

                            verification.rejectionReason =
                                reason;
                        }

                        verification.reviewedBy =
                            req.user.id;

                        const previousMetadata =
                            verification.metadata &&
                            typeof verification.metadata ===
                            "object" &&
                            !Array.isArray(
                                verification.metadata
                            )
                                ? verification.metadata
                                : {};

                        verification.metadata = {
                            ...previousMetadata,

                            reviewedAt:
                                now.toISOString(),
                        };

                        await verification.save({
                            transaction,
                        });

                        /*
                         * Решение фиксируется
                         * в ActionLog.
                         */
                        await ActionLog.create(
                            {
                                actorUserId:
                                req.user.id,

                                actorRole: "admin",

                                actionType:
                                    action === "approve"
                                        ? "identity_application_approved"
                                        : "identity_application_rejected",

                                entityType: "user",

                                entityId:
                                verification.userId,

                                meta: {
                                    verificationId:
                                        String(
                                            verification.id
                                        ),

                                    status:
                                    verification.status,
                                },
                            },
                            {
                                transaction,
                            }
                        );

                        /*
                         * ВАЖНО:
                         *
                         * Не изменяем здесь
                         * User.userStatus.
                         *
                         * Новый статус личности
                         * хранится отдельно.
                         */
                        return {
                            id:
                            verification.id,

                            userId:
                            verification.userId,

                            status:
                            verification.status,

                            verifiedAt:
                            verification.verifiedAt,

                            expiresAt:
                            verification.expiresAt,
                        };
                    }
                );

            return res.json({
                success: true,

                message:
                    action === "approve"
                        ? "Личность пользователя подтверждена"
                        : "Заявка отклонена",

                verification: updated,
            });

        } catch (error) {
            if (error.httpStatus) {
                return res
                    .status(error.httpStatus)
                    .json({
                        success: false,
                        message: error.message,
                    });
            }

            console.error(
                "Ошибка принятия решения по личности:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось сохранить решение",
            });
        }
    }
);


/*
 * POST /api/admin/identity/:id/revoke
 *
 * body: { reason: "..." }
 *
 * Все общие проверки прав администратора
 * и действующей admin-сессии
 * уже применяются через router.use().
 */
router.post(
    "/:id/revoke",
    async (req, res) => {
        try {
            if (!validId(req.params.id)) {
                throw httpError(
                    400,
                    "Некорректный ID проверки"
                );
            }

            if (
                typeof req.body?.reason !== "string"
            ) {
                throw httpError(
                    400,
                    "Укажите причину отзыва"
                );
            }

            const reason =
                req.body.reason.trim();

            if (
                reason.length < 10 ||
                reason.length > 500
            ) {
                throw httpError(
                    400,
                    "Причина должна содержать от 10 до 500 символов"
                );
            }

            const result =
                await sequelize.transaction(
                    async (transaction) => {
                        const candidate =
                            await IdentityVerification.findByPk(
                                req.params.id,
                                { transaction }
                            );

                        if (!candidate) {
                            throw httpError(
                                404,
                                "Проверка не найдена"
                            );
                        }

                        /*
                         * Блокируем пользователя, как
                         * в маршруте подачи заявки.
                         * Это сериализует конкурирующие
                         * изменения проверки личности.
                         */
                        const user =
                            await User.findByPk(
                                candidate.userId,
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

                        const current =
                            await getCurrentIdentityVerification(
                                candidate.userId,
                                { transaction }
                            );

                        if (
                            !current.verified ||
                            String(current.record.id) !==
                            String(candidate.id)
                        ) {
                            throw httpError(
                                409,
                                "Эта проверка уже не является действующей"
                            );
                        }

                        const verification =
                            await IdentityVerification.findByPk(
                                candidate.id,
                                {
                                    transaction,
                                    lock:
                                    transaction.LOCK.UPDATE,
                                }
                            );

                        if (
                            verification.status !==
                            "verified"
                        ) {
                            throw httpError(
                                409,
                                "Проверка уже отозвана или изменена"
                            );
                        }

                        const revokedAt =
                            new Date();

                        const previousMetadata =
                            verification.metadata &&
                            typeof verification.metadata === "object" &&
                            !Array.isArray(
                                verification.metadata
                            )
                                ? verification.metadata
                                : {};

                        verification.status =
                            "revoked";

                        verification.rejectionReason =
                            reason;

                        verification.metadata = {
                            ...previousMetadata,

                            revocation: {
                                revokedAt:
                                    revokedAt.toISOString(),

                                revokedBy:
                                    Number(req.user.id),

                                reason,
                            },
                        };

                        /*
                         * verifiedAt и expiresAt
                         * не стираем: это история
                         * изначально выданного
                         * подтверждения личности.
                         */
                        await verification.save({
                            transaction,
                        });

                        await ActionLog.create(
                            {
                                actorUserId:
                                req.user.id,

                                actorRole: "admin",

                                actionType:
                                    "identity_verification_revoked",

                                entityType: "user",

                                entityId:
                                verification.userId,

                                meta: {
                                    verificationId:
                                        String(
                                            verification.id
                                        ),

                                    revokedAt:
                                        revokedAt.toISOString(),

                                    reason,
                                },
                            },
                            { transaction }
                        );

                        return {
                            id: verification.id,
                            userId:
                            verification.userId,

                            status:
                            verification.status,

                            revokedAt,
                        };
                    }
                );

            return res.json({
                success: true,

                message:
                    "Подтверждение личности отозвано",

                verification: result,
            });

        } catch (error) {
            if (error.httpStatus) {
                return res
                    .status(error.httpStatus)
                    .json({
                        success: false,
                        message: error.message,
                    });
            }

            console.error(
                "Identity revocation error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось отозвать проверку",
            });
        }
    }
);


/*
 * GET /api/admin/identity/orders/:orderId/contracts
 *
 * Административный список документов заказа.
 * PDF и паспортные файлы здесь не передаются.
 */
router.get(
    "/orders/:orderId/contracts",
    async (req, res) => {
        try {
            if (!validId(req.params.orderId)) {
                return res.status(400).json({
                    success: false,
                    message: "Некорректный ID заказа",
                });
            }

            const order = await Order.findByPk(
                req.params.orderId,
                {
                    attributes: [
                        "id",
                        "creatorId",
                        "executorId",
                        "status",
                    ],
                }
            );

            if (!order) {
                return res.sendStatus(404);
            }

            const documents = await Contract.findAll({
                where: {
                    orderId: order.id,
                    type: {
                        [Op.in]: [
                            "verified_assignment",
                            "verified_completion_act",
                        ],
                    },
                },

                attributes: [
                    "id",
                    "orderId",
                    "parentContractId",
                    "type",
                    "version",
                    "status",
                    "documentNumber",
                    "documentHash",
                    "createdAt",
                    "fullySignedAt",
                    "supersededAt",
                ],

                order: [
                    ["createdAt", "ASC"],
                    ["id", "ASC"],
                ],

                limit: 100,
            });

            return res.json({
                success: true,
                order,
                documents,
            });

        } catch (error) {
            console.error(
                "Admin contract list error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось загрузить документы заказа",
            });
        }
    }
);


/*
 * GET /api/admin/identity/contracts/:contractId/evidence
 *
 * Защищённая выгрузка JSON.
 * Все проверки административной сессии
 * выполняются выше через router.use().
 */
router.get(
    "/contracts/:contractId/evidence",
    async (req, res) => {
        try {
            if (!validId(req.params.contractId)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный ID документа",
                });
            }

            const result =
                await buildContractEvidence(
                    req.params.contractId
                );

            /*
             * Журналируем факт выгрузки
             * ДО передачи файла пользователю.
             */
            await ActionLog.create({
                actorUserId: req.user.id,
                actorRole: "admin",

                actionType:
                    "verified_contract_evidence_exported",

                entityType: "order",
                entityId: result.order.id,
                orderId: result.order.id,

                severity: "info",

                meta: {
                    contractId:
                        String(result.contract.id),

                    documentHash:
                    result.contract.documentHash,

                    exportedAt:
                    result.evidence.generatedAt,

                    format: "json",
                },
            });

            const filename =
                `cargocamp-evidence-` +
                `order-${result.order.id}-` +
                `document-${result.contract.id}.json`;

            res.setHeader(
                "Cache-Control",
                "private, no-store"
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
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );

            return res
                .status(200)
                .type("application/json")
                .send(
                    JSON.stringify(
                        result.evidence,
                        null,
                        2
                    )
                );

        } catch (error) {
            if (error.httpStatus) {
                return res.status(
                    error.httpStatus
                ).json({
                    success: false,
                    message: error.message,
                });
            }

            console.error(
                "Contract evidence export error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось сформировать отчёт",
            });
        }
    }
);


module.exports = router;